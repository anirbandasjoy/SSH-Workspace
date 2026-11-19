use serde_json::{json, Value};
use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

type Result<T> = std::result::Result<T, String>;
const FAST: u64 = 5;

fn field<'a>(data: &'a Value, key: &str) -> Result<&'a str> {
    data.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .ok_or_else(|| format!("A valid {key} is required."))
}

fn home() -> Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| "Your home folder could not be located.".into())
}

fn expand(s: &str) -> Result<PathBuf> {
    if s == "~" {
        return home();
    }
    if let Some(rest) = s.strip_prefix("~/") {
        return Ok(home()?.join(rest));
    }
    let path = PathBuf::from(s);
    if !path.is_absolute() {
        return Err("Choose an absolute folder or file path.".into());
    }
    Ok(path)
}

struct Output {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

fn message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

// Disk-backed output avoids a full pipe when native clients produce diagnostics.
// Sessions also isolate passphrase prompts from a terminal that launched the app.
fn run(mut command: Command, seconds: u64, input: Option<&[u8]>) -> Result<Output> {
    let mut stdout = tempfile::tempfile().map_err(message)?;
    let mut stderr = tempfile::tempfile().map_err(message)?;
    command
        .stdout(stdout.try_clone().map_err(message)?)
        .stderr(stderr.try_clone().map_err(message)?);
    command.stdin(if input.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command
        .env("LC_ALL", "C")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and requires no Rust shared state.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let label = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start {label}: {e}"))?;
    if let Some(bytes) = input {
        if let Err(e) = child
            .stdin
            .take()
            .ok_or("Could not open input.")?
            .write_all(bytes)
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Could not supply input to {label}: {e}"));
        }
    }
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(message)? {
            break s;
        }
        if start.elapsed() > Duration::from_secs(seconds) {
            #[cfg(unix)]
            // SAFETY: the child created its own session and process group above.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{label} timed out after {seconds} seconds."));
        }
        std::thread::sleep(Duration::from_millis(12));
    };
    fn read(file: &mut File) -> Result<String> {
        file.seek(SeekFrom::Start(0)).map_err(message)?;
        let mut bytes = Vec::new();
        file.take(1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(message)?;
        Ok(String::from_utf8_lossy(&bytes)
            .trim_end_matches(['\r', '\n'])
            .to_owned())
    }
    Ok(Output {
        status,
        stdout: read(&mut stdout)?,
        stderr: read(&mut stderr)?,
    })
}

fn command(program: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd
}
fn git(path: &Path, args: &[&str]) -> Result<Output> {
    let mut cmd = command("git", &["--no-pager"]);
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
    ] {
        cmd.env_remove(key);
    }
    cmd.current_dir(path).args(args);
    run(cmd, FAST, None)
}

fn git_value(path: &Path, args: &[&str]) -> Result<String> {
    let out = git(path, args)?;
    if !out.status.success() {
        return Err(if out.stderr.is_empty() {
            "Git could not read this repository.".into()
        } else {
            out.stderr
        });
    }
    Ok(out.stdout)
}

fn effective(path: &Path, key: &str) -> Result<(String, String)> {
    let out = git(path, &["config", "--null", "--show-origin", "--get", key])?;
    if out.status.code() == Some(1) {
        return Ok((String::new(), String::new()));
    }
    if !out.status.success() {
        return Err(out.stderr);
    }
    let mut fields = out.stdout.trim_end_matches('\0').splitn(2, '\0');
    let source = fields.next().unwrap_or("").to_string();
    Ok((fields.next().unwrap_or("").to_string(), source))
}

fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 255
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn ssh_alias(url: &str) -> Option<&str> {
    if url
        .as_bytes()
        .get(1..3)
        .is_some_and(|s| s == b":/" || s == b":\\")
    {
        return None;
    }
    if let Some(rest) = url.strip_prefix("ssh://") {
        let authority = rest.split('/').next()?;
        let host = authority.rsplit('@').next()?.split(':').next()?;
        return identifier(host).then_some(host);
    }
    if url.contains("://") {
        return None;
    }
    let (authority, _) = url.split_once(':')?;
    let host = authority.rsplit('@').next()?;
    identifier(host).then_some(host)
}

fn test_limitation(url: &str, multiple: bool) -> Option<&'static str> {
    if multiple {
        return Some("This remote has several push URLs. Check each destination separately.");
    }
    if ssh_alias(url).is_none() {
        return Some("This remote does not use an SSH host alias.");
    }
    let authority = if let Some(rest) = url.strip_prefix("ssh://") {
        let authority = rest.split('/').next().unwrap_or("");
        if authority.rsplit('@').next().unwrap_or("").contains(':') {
            return Some(
                "This remote specifies its own SSH port. Test its exact URL in a terminal.",
            );
        }
        authority
    } else {
        url.split_once(':').map(|(host, _)| host).unwrap_or("")
    };
    if authority
        .rsplit_once('@')
        .is_some_and(|(name, _)| name != "git")
    {
        return Some(
            "This remote specifies a different SSH login. Test its exact URL in a terminal.",
        );
    }
    None
}
fn safe_url(url: &str) -> String {
    let url = url.split(['?', '#']).next().unwrap_or(url);
    if let Some((scheme, rest)) = url.split_once("://") {
        if !["ssh", "https", "http", "git", "file"].contains(&scheme) {
            return "Custom remote transport".into();
        }
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        let authority = authority.rsplit('@').next().unwrap_or(authority);
        let user = if scheme == "ssh" && rest.starts_with("git@") {
            "git@"
        } else {
            ""
        };
        return format!("{scheme}://{user}{authority}/{path}");
    }
    if url.contains("::") {
        return "Custom remote transport".into();
    }
    url.to_owned()
}

fn author_setting(path: &Path, attribute: &str, env_key: &str) -> Result<(String, String)> {
    if let Ok(value) = std::env::var(env_key) {
        return Ok((value, env_key.into()));
    }
    let setting = effective(path, &format!("author.{attribute}"))?;
    if !setting.1.is_empty() {
        return Ok(setting);
    }
    effective(path, &format!("user.{attribute}"))
}

pub fn inspect(payload: Value) -> Result<Value> {
    let selected = expand(field(&payload, "path")?)?;
    let path = PathBuf::from(git_value(&selected, &["rev-parse", "--show-toplevel"])?);
    let (mut git_name, mut name_source) = author_setting(&path, "name", "GIT_AUTHOR_NAME")?;
    let (mut email, mut email_source) = author_setting(&path, "email", "GIT_AUTHOR_EMAIL")?;
    let identity = git(&path, &["var", "GIT_AUTHOR_IDENT"])?;
    if identity.status.success() {
        if let Some((name, rest)) = identity.stdout.rsplit_once(" <") {
            if let Some((address, _)) = rest.split_once("> ") {
                git_name = name.into();
                email = address.into();
                if name_source.is_empty() {
                    name_source = "Git default".into();
                }
                if email_source.is_empty() {
                    email_source = if std::env::var_os("EMAIL").is_some() {
                        "EMAIL environment"
                    } else {
                        "Git default"
                    }
                    .into();
                }
            }
        }
    }
    let (_, override_source) = effective(&path, "core.sshCommand")?;
    let ssh_override = if std::env::var_os("GIT_SSH_COMMAND").is_some() {
        "GIT_SSH_COMMAND environment override".into()
    } else if !override_source.is_empty() {
        format!("core.sshCommand in {override_source}")
    } else if std::env::var_os("GIT_SSH").is_some() {
        "GIT_SSH environment override".into()
    } else {
        String::new()
    };
    let branch_out = git(&path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = if branch_out.status.success() {
        branch_out.stdout
    } else {
        format!(
            "Detached at {}",
            git_value(&path, &["rev-parse", "--short", "HEAD"])?
        )
    };
    let mut remotes = Vec::new();
    for name in git_value(&path, &["remote"])?.lines() {
        let fetch = git_value(&path, &["remote", "get-url", "--", name])?;
        let push_urls = git_value(&path, &["remote", "get-url", "--push", "--all", "--", name])?;
        let mut destinations = push_urls.lines();
        let push = destinations.next().unwrap_or("");
        let reason = test_limitation(push, destinations.next().is_some());
        let login = if push.starts_with("git@") || push.starts_with("ssh://git@") {
            "git"
        } else {
            ""
        };
        remotes.push(json!({"name":name,"url":safe_url(&fetch),"pushUrl":safe_url(push),"alias":ssh_alias(push).unwrap_or(""),"testable":reason.is_none(),"testReason":reason.unwrap_or(""),"login":login}));
    }
    Ok(
        json!({"path":path,"name":path.file_name().unwrap_or_default().to_string_lossy(),"gitName":git_name,"email":email,"nameSource":name_source,"emailSource":email_source,"branch":branch,"remotes":remotes,"sshOverride":ssh_override}),
    )
}

fn agent_list() -> Result<Output> {
    run(command("ssh-add", &["-l", "-E", "sha256"]), FAST, None)
}
fn version(program: &str, arg: &str) -> String {
    run(command(program, &[arg]), FAST, None)
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            if o.stdout.is_empty() {
                o.stderr
            } else {
                o.stdout
            }
        })
        .unwrap_or_else(|| "Unavailable".into())
}
pub fn env_info() -> Result<Value> {
    let status = match agent_list() {
        Ok(out) if out.status.success() => format!("{} loaded", out.stdout.lines().count()),
        Ok(out) if out.status.code() == Some(1) => "No keys loaded".into(),
        _ => "Unavailable".into(),
    };
    Ok(
        json!({"git":version("git","--version"),"ssh":version("ssh","-V"),"agent":status,"home":home()?}),
    )
}

fn validated_pub(path: &Path) -> Result<(String, String, String)> {
    if path.extension().and_then(|s| s.to_str()) != Some("pub") {
        return Err("Choose an OpenSSH .pub file.".into());
    }
    let meta = fs::metadata(path).map_err(message)?;
    if !meta.is_file() || meta.len() > 65536 {
        return Err("Invalid public key file.".into());
    }
    let content = fs::read_to_string(path).map_err(message)?;
    let line = content.trim();
    let mut parts = line.split_ascii_whitespace();
    let algo = parts.next().unwrap_or("");
    let blob = parts.next().unwrap_or("");
    if line.contains(['\n', '\r'])
        || !(algo.starts_with("ssh-") || algo.starts_with("ecdsa-") || algo.starts_with("sk-"))
        || blob.is_empty()
        || !blob
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
    {
        return Err("This file is not an OpenSSH public key.".into());
    }
    // Fingerprint the exact bytes already checked, so a concurrent rename cannot swap the file.
    let out = run(
        command("ssh-keygen", &["-l", "-E", "sha256", "-f", "-"]),
        FAST,
        Some(line.as_bytes()),
    )?;
    let fingerprint = out
        .stdout
        .split_whitespace()
        .nth(1)
        .filter(|s| s.starts_with("SHA256:"))
        .filter(|_| out.status.success())
        .ok_or("Invalid public key.")?;
    Ok((line.into(), algo.into(), fingerprint.into()))
}
fn public_path(private: &Path) -> PathBuf {
    let mut s = private.as_os_str().to_os_string();
    s.push(".pub");
    PathBuf::from(s)
}
fn describe_key(path: &Path, loaded: &HashSet<String>) -> Result<Value> {
    let (_, algorithm, fingerprint) = validated_pub(path)?;
    let private = path.with_extension("");
    Ok(
        json!({"path":private,"publicPath":path,"name":private.file_name().unwrap_or_default().to_string_lossy(),"fingerprint":fingerprint,"type":algorithm,"loaded":loaded.contains(&fingerprint),"hasPrivate":private.symlink_metadata().is_ok()}),
    )
}
pub fn keys() -> Result<Value> {
    let dir = home()?.join(".ssh");
    if !dir.is_dir() {
        return Ok(json!([]));
    }
    let loaded = agent_list()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            o.stdout
                .lines()
                .filter_map(|l| l.split_whitespace().nth(1).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let paths: BTreeSet<_> = fs::read_dir(dir)
        .map_err(message)?
        .filter_map(|item| item.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("pub"))
        .collect();
    let entries: Vec<_> = paths
        .iter()
        .filter_map(|p| describe_key(p, &loaded).ok())
        .collect();
    Ok(Value::Array(entries))
}
pub fn public_key(payload: Value) -> Result<Value> {
    let path = expand(field(&payload, "path")?)?;
    let path = if path.extension().and_then(|s| s.to_str()) == Some("pub") {
        path
    } else {
        public_path(&path)
    };
    Ok(json!(validated_pub(&path)?.0))
}
pub fn generate_key(payload: Value) -> Result<Value> {
    let name = field(&payload, "name")?;
    if !identifier(name) || name.ends_with(".pub") || name.len() > 120 {
        return Err(
            "Use a key filename containing letters, numbers, dots, hyphens or underscores.".into(),
        );
    }
    let phrase = field(&payload, "passphrase")?;
    if phrase.len() > 512 || phrase.contains(['\r', '\n']) {
        return Err("Use a passphrase on one line, up to 512 bytes.".into());
    }
    let dir = home()?.join(".ssh");
    if !dir.exists() {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.recursive(true).create(&dir).map_err(message)?;
    }
    let private = dir.join(name);
    let public = public_path(&private);
    if private.symlink_metadata().is_ok() || public.symlink_metadata().is_ok() {
        return Err("A key with that filename already exists.".into());
    }
    let tmp = tempfile::tempdir_in(&dir).map_err(message)?;
    let generated = tmp.path().join("key");
    let mut cmd = command("ssh-keygen", &["-q", "-t", "ed25519", "-C", name, "-f"]);
    cmd.arg(&generated);
    let mut input = format!("{phrase}\n{phrase}\n").into_bytes();
    let result = run(cmd, 30, Some(&input));
    input.fill(0);
    if !result?.status.success() {
        return Err(
            "OpenSSH could not generate this key. Check the filename and passphrase.".into(),
        );
    }
    let pub_tmp = public_path(&generated);
    validated_pub(&pub_tmp)?;
    fs::hard_link(&pub_tmp, &public)
        .map_err(|e| format!("Could not create the public key: {e}"))?;
    if let Err(e) = fs::hard_link(&generated, &private) {
        let _ = fs::remove_file(&public);
        return Err(format!("Could not create the private key: {e}"));
    }
    describe_key(&public, &HashSet::new())
}

pub fn agent_key(payload: Value) -> Result<Value> {
    let requested = expand(field(&payload, "path")?)?;
    let private = if requested.extension().and_then(|e| e.to_str()) == Some("pub") {
        requested.with_extension("")
    } else {
        requested
    };
    let public = public_path(&private);
    validated_pub(&public)?;
    let out = match field(&payload, "action")? {
        "load" => {
            let phrase = payload
                .get("passphrase")
                .and_then(Value::as_str)
                .unwrap_or("");
            if phrase.len() > 512 || phrase.contains(['\0', '\r', '\n']) {
                return Err("Enter a passphrase on one line.".into());
            }
            let mut input = format!("{phrase}\n").into_bytes();
            let mut cmd = command("ssh-add", &[]);
            cmd.arg(private);
            let result = run(cmd, 30, Some(&input));
            input.fill(0);
            result?
        }
        "unload" => {
            let mut cmd = command("ssh-add", &["-d"]);
            cmd.arg(public);
            run(cmd, FAST, None)?
        }
        _ => return Err("Choose load or unload.".into()),
    };
    if !out.status.success() {
        return Err(match out.status.code(){
        Some(2)=>"The SSH agent is unavailable. Start an agent for your desktop session and reopen the app.",
        _=>"The SSH agent could not update this key. Check the passphrase and agent status.",
    }.into());
    }
    Ok(json!(true))
}

pub fn delete_key(payload: Value) -> Result<Value> {
    let dir = home()?.join(".ssh");
    let agent_socket = std::env::var_os("SSH_AUTH_SOCK");
    remove_key_files(
        &dir,
        &payload,
        &crate::config::state()?,
        agent_socket.as_deref(),
    )?;
    Ok(json!(true))
}

fn unload_deleted_key(
    public: &Path,
    fingerprint: &str,
    socket: Option<&std::ffi::OsStr>,
) -> Result<()> {
    let Some(socket) = socket else {
        return Ok(());
    };
    let is_loaded = || {
        let mut cmd = command("ssh-add", &["-l", "-E", "sha256"]);
        cmd.env("SSH_AUTH_SOCK", socket);
        let out = run(cmd, FAST, None)?;
        Ok::<_, String>(match out.status.code() {
            Some(0) => Some(
                out.stdout
                    .lines()
                    .any(|line| line.split_whitespace().nth(1) == Some(fingerprint)),
            ),
            Some(1) => Some(false),
            _ => None,
        })
    };
    if is_loaded()? != Some(true) {
        return Ok(());
    }
    let mut cmd = command("ssh-add", &["-d"]);
    cmd.env("SSH_AUTH_SOCK", socket).arg(public);
    let result = run(cmd, FAST, None);
    if is_loaded()? == Some(false) {
        return Ok(());
    }
    let detail = result.ok().map(|out| out.stderr).unwrap_or_default();
    Err(if detail.is_empty() {
        "The SSH agent could not confirm that it unloaded this key.".into()
    } else {
        format!("The SSH agent could not unload this key: {detail}")
    })
}

fn remove_key_files(
    dir: &Path,
    payload: &Value,
    state: &Value,
    agent_socket: Option<&std::ffi::OsStr>,
) -> Result<()> {
    let private = expand(field(payload, "path")?)?;
    if private.parent() != Some(dir) || private.file_name().is_none() {
        return Err("Choose a key listed directly in your SSH folder.".into());
    }
    let public = public_path(&private);
    if !public.symlink_metadata().map_err(message)?.is_file() {
        return Err(
            "Choose a regular public key file. Linked keys must be managed at their source.".into(),
        );
    }
    let (_, _, fingerprint) = validated_pub(&public)?;
    if field(payload, "fingerprint")? != fingerprint {
        return Err("The selected key changed. Refresh the keys list and review it again.".into());
    }
    let has_private = match private.symlink_metadata() {
        Ok(meta) if meta.is_file() => true,
        Ok(_) => {
            return Err(
                "The private key is a link or special file. Manage it at its source.".into(),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(message(e)),
    };
    if payload["hasPrivate"].as_bool() != Some(has_private) {
        return Err("The key files changed. Refresh the keys list and review them again.".into());
    }
    let selected_path = private.canonicalize().ok();
    let public_path = public.canonicalize().map_err(message)?;
    for reference in ["profiles", "hosts"]
        .into_iter()
        .flat_map(|kind| state[kind].as_array().into_iter().flatten())
    {
        let Some(path) = reference["keyPath"].as_str().and_then(|s| expand(s).ok()) else {
            continue;
        };
        let resolved = path.canonicalize().ok();
        if path == private
            || path == public
            || resolved.as_ref() == Some(&public_path)
            || (selected_path.is_some() && resolved == selected_path)
        {
            let name = reference["name"]
                .as_str()
                .or_else(|| reference["alias"].as_str())
                .unwrap_or("a workspace profile or host");
            return Err(format!(
                "Reassign the SSH key in {name} before deleting it."
            ));
        }
    }
    if has_private {
        let mut header = [0; 64];
        let bytes = File::open(&private)
            .and_then(|mut file| file.read(&mut header))
            .map_err(message)?;
        let first_line = header[..bytes]
            .split(|b| *b == b'\n')
            .next()
            .unwrap_or_default();
        let first_line = first_line.strip_suffix(b"\r").unwrap_or(first_line);
        if !matches!(
            first_line,
            b"-----BEGIN OPENSSH PRIVATE KEY-----"
                | b"-----BEGIN RSA PRIVATE KEY-----"
                | b"-----BEGIN EC PRIVATE KEY-----"
                | b"-----BEGIN DSA PRIVATE KEY-----"
                | b"-----BEGIN PRIVATE KEY-----"
                | b"-----BEGIN ENCRYPTED PRIVATE KEY-----"
        ) {
            return Err(
                "The matching private filename does not contain a recognized SSH private key."
                    .into(),
            );
        }
    }
    // Stage both files together before deleting so a failed move can restore the public file.
    let staging = tempfile::Builder::new()
        .prefix(".ssh-workspace-delete-")
        .tempdir_in(dir)
        .map_err(message)?
        .keep();
    let mut moved = Vec::new();
    let attempt = (|| {
        for original in [&public, &private]
            .into_iter()
            .take(if has_private { 2 } else { 1 })
        {
            let staged = staging.join(original.file_name().ok_or("Invalid key filename.")?);
            fs::rename(original, &staged)
                .map_err(|error| format!("Could not move the key files for deletion: {error}"))?;
            moved.push((original, staged));
        }
        // Hide files from agents that discover keys by looking in ~/.ssh.
        unload_deleted_key(&moved[0].1, &fingerprint, agent_socket)
    })();
    if let Err(error) = attempt {
        // Attempt to restore both files and keep the staging directory if either
        // destination became occupied while the operation was running.
        let mut restored = true;
        for (original, staged) in moved.iter().rev() {
            restored &= fs::hard_link(staged, original).is_ok();
        }
        if restored {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        return Err(format!(
            "{error} Recover the staged key files from {}.",
            staging.display()
        ));
    }
    fs::remove_dir_all(&staging).map_err(|error| {
        format!(
            "The key is out of the SSH keys list. Check the remaining files in {}: {error}",
            staging.display()
        )
    })
}

fn tokens(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for c in line.chars() {
        if escaped {
            word.push(c);
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else {
                word.push(c);
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            continue;
        }
        if c == '#' && word.is_empty() {
            break;
        }
        if c.is_whitespace()
            || (c == '=' && (fields.is_empty() || (fields.len() == 1 && word.is_empty())))
        {
            if !word.is_empty() {
                fields.push(std::mem::take(&mut word));
            }
        } else {
            word.push(c);
        }
    }
    if !word.is_empty() {
        fields.push(word);
    }
    fields
}

#[derive(Default)]
struct SshConfig {
    lines: Vec<Vec<String>>,
    aliases: BTreeSet<String>,
    file_count: usize,
}

fn read_config(path: &Path, base: &Path, depth: usize, parsed: &mut SshConfig) {
    if depth >= 12 || parsed.file_count >= 128 || parsed.lines.len() >= 40_000 {
        return;
    }
    let Ok(meta) = fs::metadata(path) else { return };
    if !meta.is_file() || meta.len() > 1_048_576 {
        return;
    }
    let Ok(contents) = fs::read_to_string(path) else {
        return;
    };
    parsed.file_count += 1;
    for line in contents.lines() {
        if parsed.lines.len() >= 40_000 {
            break;
        }
        let mut words = tokens(line);
        if words.len() < 2 {
            continue;
        }
        words[0].make_ascii_lowercase();
        match words[0].as_str() {
            "include" => {
                for pat in &words[1..] {
                    let file = if let Some(relative) = pat.strip_prefix("~/") {
                        base.parent().map(|home| home.join(relative))
                    } else {
                        Some(base.join(pat))
                    };
                    if let Some(files) = file.and_then(|p| glob::glob(p.to_str()?).ok()) {
                        for f in files.flatten().take(128) {
                            read_config(&f, base, depth + 1, parsed);
                        }
                    }
                }
            }
            "host" => {
                parsed
                    .aliases
                    .extend(words[1..].iter().filter(|s| identifier(s)).cloned());
                parsed.lines.push(words);
            }
            "match" | "hostname" | "user" | "port" | "identityfile" => parsed.lines.push(words),
            _ => {}
        }
    }
}
fn host_matches(patterns: &[String], alias: &str) -> bool {
    let mut positive = false;
    for pat in patterns {
        let (neg, p) = pat
            .strip_prefix('!')
            .map(|s| (true, s))
            .unwrap_or((false, pat.as_str()));
        if glob::Pattern::new(&p.to_ascii_lowercase())
            .is_ok_and(|s| s.matches(&alias.to_ascii_lowercase()))
        {
            if neg {
                return false;
            }
            positive = true;
        }
    }
    positive
}
pub(crate) fn declared_aliases(base: &Path) -> BTreeSet<String> {
    let mut parsed = SshConfig::default();
    read_config(&base.join("config"), base, 0, &mut parsed);
    parsed.aliases
}

pub fn hosts() -> Result<Value> {
    let base = home()?.join(".ssh");
    let mut parsed = SshConfig::default();
    read_config(&base.join("config"), &base, 0, &mut parsed);
    let mut listing = Vec::new();
    for alias in &parsed.aliases {
        let (mut hostname, mut user, mut port, mut key) = (None, None, None, None);
        let mut active = true;
        for words in &parsed.lines {
            match words[0].as_str() {
                "host" => active = host_matches(&words[1..], alias),
                "match" => active = words.len() == 2 && words[1].eq_ignore_ascii_case("all"),
                "hostname" if active && hostname.is_none() => hostname = Some(words[1].as_str()),
                "user" if active && user.is_none() => user = Some(words[1].as_str()),
                "port" if active && port.is_none() => port = words[1].parse::<u16>().ok(),
                "identityfile" if active && key.is_none() => key = Some(words[1].as_str()),
                _ => {}
            }
        }
        listing.push(json!({"alias":alias,"hostname":hostname.unwrap_or(alias),"user":user.unwrap_or(""),"port":port.unwrap_or(22),"keyPath":key.unwrap_or("")}));
    }
    Ok(Value::Array(listing))
}

fn greeting(stderr: &str) -> Option<&str> {
    const MSG: &str =
        "! You've successfully authenticated, but GitHub does not provide shell access.";
    stderr.lines().find_map(|line| {
        let username = line.trim().strip_prefix("Hi ")?.strip_suffix(MSG)?;
        if !identifier(username) {
            return None;
        }
        Some(username)
    })
}

const SSH_OPTIONS: &[&str] = &[
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ControlPath=none",
    "-o",
    "RemoteCommand=none",
];
fn connection_error(stderr: &str, github: bool) -> String {
    if stderr.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return "The saved host fingerprint changed. Confirm the new fingerprint with the host administrator and update known_hosts before retrying.".into();
    }
    if stderr.contains("Host key verification failed") || stderr.contains("strict checking") {
        return if github {"The host key is unknown. For github.com on port 22, open Preferences and choose Trust GitHub host key. If you use a custom known_hosts file, HostKeyAlias, or port, verify GitHub’s published fingerprint in a terminal and trust it for that destination."}
        else {"The host key is unknown. Verify the fingerprint with the host administrator and trust it in OpenSSH before testing again."}.into();
    }
    if stderr.contains("Permission denied (publickey") {
        return "Public key authentication failed. Load the selected key into the SSH agent and register its public key with the account.".into();
    }
    if stderr.trim().is_empty() {
        "The host did not confirm authentication.".into()
    } else {
        stderr.chars().take(1000).collect()
    }
}
pub fn test_connection(payload: Value) -> Result<Value> {
    let alias = field(&payload, "alias")?;
    if !identifier(alias) {
        return Err("Select a valid SSH host alias.".into());
    }
    let mut settings = command("ssh", &["-G"]);
    let repo = payload["fromRepo"].as_bool().unwrap_or(false);
    let login = payload["login"].as_str().unwrap_or("");
    if repo && !login.is_empty() {
        if login != "git" {
            return Err("Test this remote’s explicit SSH login in a terminal.".into());
        }
        settings.args(["-l", login]);
    }
    settings.args(["--", alias]);
    let cfg = run(settings, FAST, None)?;
    if !cfg.status.success() {
        return Err(cfg.stderr);
    }
    let host = cfg
        .stdout
        .lines()
        .find_map(|l| l.strip_prefix("hostname "))
        .unwrap_or(alias);
    let github =
        host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("ssh.github.com");
    let mut cmd = command("ssh", SSH_OPTIONS);
    if (repo && login == "git") || (!repo && github) {
        cmd.args(["-l", "git"]);
    }
    cmd.args(["-T", "--", alias]);
    if !github {
        cmd.arg("exit");
    }
    let out = run(cmd, 15, None)?;
    let response = format!("{}\n{}", out.stdout, out.stderr);
    if github {
        if let Some(user) = greeting(&response).filter(|_| matches!(out.status.code(), Some(0 | 1)))
        {
            return Ok(
                json!({"ok":true,"username":user,"message":format!("GitHub authenticated @{user}.")}),
            );
        }
    } else if out.status.success() {
        let user = cfg
            .stdout
            .lines()
            .find_map(|l| l.strip_prefix("user "))
            .unwrap_or("");
        return Ok(
            json!({"ok":true,"username":"","message":format!("Connected to {user}@{host}.")}),
        );
    }
    Ok(json!({"ok":false,"username":"","message":connection_error(&response,github)}))
}

fn repo_parts(source: &str) -> Result<(&str, &str, &str)> {
    let invalid = "Enter a GitHub URL or an owner/repository pair.";
    let (host, path) = if let Some(s) = source.strip_prefix("https://") {
        s.split_once('/').ok_or(invalid)?
    } else if let Some(s) = source.strip_prefix("ssh://git@") {
        s.split_once('/').ok_or(invalid)?
    } else if let Some(s) = source.strip_prefix("git@") {
        s.split_once(':').ok_or(invalid)?
    } else {
        ("github.com", source)
    };
    let (owner, name) = path.trim_end_matches('/').split_once('/').ok_or(invalid)?;
    let name = name.strip_suffix(".git").unwrap_or(name);
    if !identifier(host) || !identifier(owner) || !identifier(name) {
        return Err(invalid.into());
    }
    Ok((host, owner, name))
}
fn profile_for<'a>(
    state: &'a Value,
    folder: &Path,
    requested: Option<&str>,
) -> Result<Option<&'a Value>> {
    let rules = state["rules"].as_array().into_iter().flatten();
    let inferred = rules
        .filter_map(|rule| {
            let path = expand(rule["folder"].as_str()?).ok()?.canonicalize().ok()?;
            folder
                .starts_with(&path)
                .then(|| (path.components().count(), rule["profileId"].as_str()))
                .and_then(|(n, id)| id.map(|s| (n, s)))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, id)| id);
    let Some(id) = requested.filter(|s| !s.is_empty()).or(inferred) else {
        return Ok(None);
    };
    state["profiles"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|p| p["id"].as_str() == Some(id))
        .map(Some)
        .ok_or_else(|| "This profile no longer exists.".into())
}

pub fn clone_repo(payload: Value) -> Result<Value> {
    let source = field(&payload, "source")?.trim();
    let (source_host, owner, name) = repo_parts(source)?;
    let folder = expand(field(&payload, "folder")?)?
        .canonicalize()
        .map_err(message)?;
    if !folder.is_dir() {
        return Err("Choose an existing destination folder.".into());
    }
    let state = crate::config::state()?;
    let profile = profile_for(&state, &folder, payload["profileId"].as_str())?;
    let known_source = source_host.eq_ignore_ascii_case("github.com")
        || state["profiles"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|p| p["alias"].as_str() == Some(source_host));
    if !known_source {
        return Err("Use github.com or a GitHub alias from your profiles.".into());
    }
    let alias = profile
        .and_then(|p| p["alias"].as_str())
        .unwrap_or(source_host);
    if !identifier(alias) {
        return Err("Invalid SSH host alias in this profile.".into());
    }
    let remote = format!("git@{alias}:{owner}/{name}.git");
    let dest = folder.join(name);
    fs::create_dir(&dest).map_err(|e| format!("Could not create {name}: {e}"))?;
    let mut cmd = command(
        "git",
        &[
            "-c",
            "core.hooksPath=/dev/null",
            "clone",
            "--quiet",
            "--no-recurse-submodules",
            "--",
        ],
    );
    cmd.env("GIT_ALLOW_PROTOCOL", "ssh")
        .env("GIT_SSH_VARIANT", "ssh")
        .env("GIT_SSH_COMMAND", format!("ssh {}", SSH_OPTIONS.join(" ")))
        .arg(remote)
        .arg(&dest);
    for k in [
        "GIT_DIR",
        "GIT_COMMON_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
    ] {
        cmd.env_remove(k);
    }
    let out = match run(cmd, 180, None) {
        Ok(out) => out,
        Err(e) => {
            let _ = fs::remove_dir(&dest);
            return Err(e);
        }
    };
    if !out.status.success() {
        let _ = fs::remove_dir(&dest);
        return Err(connection_error(&out.stderr, true));
    }
    crate::config::remember_repo(dest.to_str().ok_or("This path is not valid UTF-8.")?).map_err(
        |e| {
            format!(
                "Cloned to {}. Reopen that folder to add it to the workspace: {e}",
                dest.display()
            )
        },
    )?;
    Ok(json!({"path":dest}))
}

pub fn scan_repos(payload: Value) -> Result<Value> {
    let folder = expand(field(&payload, "folder")?)?
        .canonicalize()
        .map_err(message)?;
    let mut found = BTreeSet::new();
    let mut queue = std::collections::VecDeque::from([(folder, 0u8)]);
    let mut checked = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        if checked >= 10_000 || found.len() >= 500 {
            break;
        }
        checked += 1;
        if dir.join(".git").exists() {
            found.insert(dir);
            continue;
        }
        if depth >= 6 {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if depth == 0 => return Err(e.to_string()),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if checked + queue.len() >= 10_000 {
                break;
            }
            let name = entry.file_name();
            let n = name.to_string_lossy();
            if n.starts_with('.')
                || matches!(
                    n.as_ref(),
                    "target" | "node_modules" | "build" | "dist" | "vendor"
                )
            {
                continue;
            }
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                queue.push_back((entry.path(), depth + 1));
            }
        }
    }
    Ok(json!(found))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_only_the_confirmed_unassigned_key_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("id_ed25519");
        let mut keygen = command("ssh-keygen", &["-q", "-t", "ed25519", "-N", "", "-f"]);
        keygen.arg(&path);
        assert!(run(keygen, FAST, None).unwrap().status.success());
        let public = public_path(&path);
        let (_, _, fingerprint) = validated_pub(&public).unwrap();
        let request = json!({"path":path,"fingerprint":fingerprint,"hasPrivate":true});
        let profile = json!({"profiles":[{"name":"Work","keyPath":path}]});
        assert!(remove_key_files(dir.path(), &request, &profile, None).is_err());
        let changed = json!({"path":path,"fingerprint":"SHA256:changed","hasPrivate":true});
        assert!(remove_key_files(dir.path(), &changed, &json!({}), None).is_err());
        assert!(path.is_file() && public.is_file());
        remove_key_files(dir.path(), &request, &json!({}), None).unwrap();
        assert!(!path.exists() && !public.exists());
    }

    #[cfg(unix)]
    #[test]
    fn deletes_key_loaded_in_an_isolated_ssh_agent() {
        struct Agent(std::process::Child);
        impl Drop for Agent {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("agent.sock");
        let mut agent = Agent(
            command("ssh-agent", &["-D", "-a"])
                .arg(&socket)
                .stdout(Stdio::null())
                .spawn()
                .unwrap(),
        );
        for _ in 0..100 {
            if socket.exists() || agent.0.try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(socket.exists(), "Could not start isolated SSH agent");
        let generate = |name: &str| {
            let path = dir.path().join(name);
            let mut keygen = command("ssh-keygen", &["-q", "-t", "ed25519", "-N", "", "-f"]);
            keygen.arg(&path);
            assert!(run(keygen, FAST, None).unwrap().status.success());
            let mut add = command("ssh-add", &[]);
            add.env("SSH_AUTH_SOCK", &socket).arg(&path);
            assert!(run(add, FAST, None).unwrap().status.success());
            let (_, _, fingerprint) = validated_pub(&public_path(&path)).unwrap();
            (path, fingerprint)
        };
        let (path, fingerprint) = generate("delete_me");
        let (other, other_fingerprint) = generate("keep_me");
        let request = json!({"path":path,"fingerprint":fingerprint,"hasPrivate":true});
        remove_key_files(dir.path(), &request, &json!({}), Some(socket.as_os_str())).unwrap();
        assert!(!path.exists() && !public_path(&path).exists());
        assert!(other.exists() && public_path(&other).exists());
        let mut list = command("ssh-add", &["-l", "-E", "sha256"]);
        list.env("SSH_AUTH_SOCK", &socket);
        let remaining = run(list, FAST, None).unwrap();
        assert!(remaining.status.success());
        assert!(remaining.stdout.contains(&other_fingerprint));
        assert!(!remaining.stdout.contains(&fingerprint));
    }

    #[test]
    fn github_greetings_verify_user_identity() {
        assert_eq!(greeting("Hi alice-work! You've successfully authenticated, but GitHub does not provide shell access."),Some("alice-work"));
        assert!(greeting("Permission denied (publickey).").is_none());
        assert!(greeting("Hi alice/repo! You've successfully authenticated, but GitHub does not provide shell access.").is_none());
    }
    #[test]
    fn urls_scope_clone_and_hide_credentials() {
        assert_eq!(
            repo_parts("git@github-work:acme/service.git").unwrap(),
            ("github-work", "acme", "service")
        );
        assert!(repo_parts("ext::running something").is_err());
        assert!(repo_parts("https://github.com/../escaped").is_err());
        assert_eq!(
            safe_url("https://alice:secret@github.com/acme/x.git?token=secret"),
            "https://github.com/acme/x.git"
        );
        assert_eq!(
            ssh_alias("git@github-work:acme/service.git"),
            Some("github-work")
        );
        assert!(test_limitation("ssh://git@sample:2222/org/code", false).is_some());
        assert!(test_limitation("admin@sample:org/code", false).is_some());
        assert!(test_limitation("git@sample:org/code", true).is_some());
        assert!(test_limitation("git@sample:org/code", false).is_none());
        assert_eq!(ssh_alias("C:/source/code"), None);
    }
    #[test]
    fn reads_effective_local_identity_without_network() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        for args in [
            &["init", "-q"][..],
            &["config", "user.name", "Example Developer"],
            &["config", "user.email", "dev@example.test"],
            &[
                "remote",
                "add",
                "origin",
                "git@github-work:acme/service.git",
            ],
        ] {
            git_value(p, args).unwrap();
        }
        let details = inspect(json!({"path":p})).unwrap();
        assert_eq!(details["email"], "dev@example.test");
        assert!(details["emailSource"].as_str().unwrap().contains("config"));
        assert_eq!(details["remotes"][0]["alias"], "github-work");
        assert_eq!(scan_repos(json!({"folder":p})).unwrap()[0], json!(p));
        git_value(p, &["config", "author.email", "author@example.test"]).unwrap();
        assert_eq!(
            inspect(json!({"path":p})).unwrap()["email"],
            "author@example.test"
        );
    }
    #[test]
    fn nested_folder_rules_use_closest_parent() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let nested = parent.join("client");
        fs::create_dir(&nested).unwrap();
        let state = json!({"profiles":[{"id":"work"},{"id":"client"}],"rules":[{"folder":nested,"profileId":"client"},{"folder":parent,"profileId":"work"}]});
        assert_eq!(
            profile_for(&state, &nested, None).unwrap().unwrap()["id"],
            "client"
        );
        assert_eq!(
            profile_for(&state, &nested, Some("work")).unwrap().unwrap()["id"],
            "work"
        );
    }
}
