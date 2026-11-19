use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Mutex, OnceLock};

type AppResult<T> = Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    profiles: Vec<Profile>,
    #[serde(default)]
    hosts: Vec<Host>,
    #[serde(default)]
    rules: Vec<Rule>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    name: String,
    username: String,
    git_name: String,
    email: String,
    alias: String,
    key_path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Host {
    alias: String,
    hostname: String,
    user: String,
    port: u16,
    key_path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Rule {
    folder: String,
    profile_id: String,
}

#[derive(Clone)]
struct Paths {
    home: PathBuf,
    app: PathBuf,
    global: PathBuf,
}
impl Paths {
    fn discover() -> AppResult<Self> {
        let home = dirs::home_dir().ok_or("Cannot locate the home directory.")?;
        let config = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".config"));
        let classic = home.join(".gitconfig");
        let xdg = config.join("git/config");
        let global = env::var_os("GIT_CONFIG_GLOBAL")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if xdg.is_file() && !classic.exists() {
                    xdg
                } else {
                    classic
                }
            });
        if !global.is_absolute() {
            return Err("The global Git configuration path must be absolute.".into());
        }
        Ok(Self {
            home,
            app: config.join("ssh-workspace"),
            global,
        })
    }
    fn settings(&self) -> PathBuf {
        self.app.join("profiles.json")
    }
    fn history(&self) -> PathBuf {
        self.app.join("undo.json")
    }
    fn journal(&self) -> PathBuf {
        self.app.join("transaction.json")
    }
    fn repos(&self) -> PathBuf {
        self.app.join("repositories.json")
    }
    fn ssh(&self) -> PathBuf {
        self.home.join(".ssh/config")
    }
    fn hosts(&self) -> PathBuf {
        self.home.join(".ssh/ssh-workspace-hosts.conf")
    }
    fn rule_file(&self, id: &str) -> PathBuf {
        self.app.join("identities").join(format!("{id}.gitconfig"))
    }
}

fn read(path: &Path) -> AppResult<Option<String>> {
    match fs::symlink_metadata(path) {
        Ok(m) if !m.file_type().is_file() => Err(format!(
            "{} must be a regular file. Resolve its link or special file before editing.",
            path.display()
        )),
        Ok(m) if m.len() > 16 * 1024 * 1024 => {
            Err(format!("{} is too large to safely edit.", path.display()))
        }
        Ok(_) => fs::read_to_string(path)
            .map(Some)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}
fn stored<T: serde::de::DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
    match read(path)? {
        Some(text) => serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display())),
        None => Ok(T::default()),
    }
}
fn pretty<T: Serialize>(value: &T) -> AppResult<String> {
    Ok(serde_json::to_string_pretty(value).map_err(err)? + "\n")
}
fn ensure_folder(dir: &Path) -> AppResult<()> {
    if !dir.is_dir() {
        let mut b = fs::DirBuilder::new();
        b.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            b.mode(0o700);
        }
        b.create(dir)
            .map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    Ok(())
}
fn write_file(path: &Path, value: Option<&str>) -> AppResult<()> {
    if let Some(text) = value {
        if text.len() > 16 * 1024 * 1024 {
            return Err(format!("{} is too large to update safely.", path.display()));
        }
        let dir = path.parent().ok_or("Invalid configuration path.")?;
        ensure_folder(dir)?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(err)?;
        file.write_all(text.as_bytes()).map_err(err)?;
        if let Ok(m) = fs::symlink_metadata(path) {
            if !m.is_file() {
                return Err(format!("Cannot replace {}.", path.display()));
            }
            file.as_file()
                .set_permissions(m.permissions())
                .map_err(err)?;
        }
        file.as_file().sync_all().map_err(err)?;
        file.persist(path).map_err(err)?;
    } else if let Err(e) = fs::remove_file(path) {
        if e.kind() != ErrorKind::NotFound {
            return Err(err(e));
        }
    }
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        if let Ok(f) = fs::File::open(dir) {
            let _ = f.sync_all();
        }
    }
    Ok(())
}
fn text(v: &Value, k: &str) -> AppResult<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Missing {k}."))
}
fn plain(v: &str, label: &str) -> AppResult<()> {
    if v.trim().is_empty() || v != v.trim() || v.len() > 2048 || v.chars().any(char::is_control) {
        Err(format!("Invalid {label}."))
    } else {
        Ok(())
    }
}
fn token(v: &str, label: &str) -> AppResult<()> {
    plain(v, label)?;
    if v.len() > 128
        || !v.as_bytes()[0].is_ascii_alphanumeric()
        || !v
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        || v == ".."
    {
        Err(format!("Invalid {label}."))
    } else {
        Ok(())
    }
}
fn q(v: &str) -> String {
    format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""))
}
fn config_path(path: &Path) -> AppResult<String> {
    let mut s = path
        .to_str()
        .ok_or("A path contains unsupported characters.")?
        .to_owned();
    if cfg!(windows) {
        s = s.replace('\\', "/");
        if let Some(rest) = s.strip_prefix("//?/UNC/") {
            s = format!("//{rest}");
        } else if let Some(rest) = s.strip_prefix("//?/") {
            s = rest.to_owned();
        }
    }
    plain(&s, "path")?;
    Ok(s)
}
fn absolute(val: &str, home: &Path) -> AppResult<PathBuf> {
    plain(val, "path")?;
    let path = if val == "~" {
        home.to_path_buf()
    } else if let Some(relative) = val.strip_prefix("~/") {
        home.join(relative)
    } else {
        PathBuf::from(val)
    };
    if !path.is_absolute() {
        return Err("Choose an absolute file or folder path.".into());
    }
    Ok(path)
}
fn key_path(value: &str, paths: &Paths) -> AppResult<String> {
    let path = absolute(value, &paths.home)?;
    if !path.is_file() {
        return Err("The selected SSH key file does not exist.".into());
    }
    let result = config_path(&path)?;
    if result.contains(['%', '$', '"', '\\']) {
        return Err("Choose a key path without SSH expansion characters.".into());
    }
    Ok(result)
}
fn folder(value: &str, paths: &Paths) -> AppResult<String> {
    let path = absolute(value, &paths.home)?;
    if !path.is_dir() {
        return Err("Choose an existing folder.".into());
    }
    config_path(&fs::canonicalize(path).map_err(err)?)
}
impl Settings {
    fn validate(&self) -> AppResult<()> {
        let mut aliases = HashSet::new();
        for alias in self
            .profiles
            .iter()
            .map(|p| &p.alias)
            .chain(self.hosts.iter().map(|h| &h.alias))
        {
            token(alias, "host alias")?;
            if alias.eq_ignore_ascii_case("github.com")
                || !aliases.insert(alias.to_ascii_lowercase())
            {
                return Err(format!("Choose a unique SSH alias instead of {alias}."));
            }
        }
        Ok(())
    }
    fn has_profile(&self, id: &str) -> AppResult<&Profile> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "Profile no longer exists.".into())
    }
    fn update(&mut self, payload: &Value, paths: &Paths) -> AppResult<()> {
        match text(payload, "kind")?.as_str() {
            "profile" => {
                let mut item: Profile =
                    serde_json::from_value(payload["profile"].clone()).map_err(err)?;
                token(&item.id, "profile ID")?;
                plain(&item.name, "profile name")?;
                token(&item.username, "GitHub username")?;
                plain(&item.git_name, "commit author name")?;
                plain(&item.email, "commit email")?;
                if !item.email.contains('@') || item.email.contains(['<', '>', ' ']) {
                    return Err("Enter a commit email address.".into());
                }
                item.key_path = key_path(&item.key_path, paths)?;
                if let Some(value) = payload.get("folder").filter(|v| !v.is_null()) {
                    let selected = value.as_str().ok_or("Choose an existing folder.")?;
                    if !selected.trim().is_empty() {
                        let path = folder(selected, paths)?;
                        if let Some(existing) = self.rules.iter().find(|rule| rule.folder == path) {
                            if existing.profile_id != item.id {
                                return Err("This folder belongs to another profile. Open Folder rules to reassign it.".into());
                            }
                        } else {
                            self.rules.push(Rule {
                                folder: path,
                                profile_id: item.id.clone(),
                            });
                        }
                    }
                }
                self.profiles.retain(|p| p.id != item.id);
                self.profiles.push(item);
            }
            "host" => {
                let mut item: Host =
                    serde_json::from_value(payload["host"].clone()).map_err(err)?;
                token(&item.user, "SSH user")?;
                plain(&item.hostname, "hostname")?;
                if item.port == 0
                    || item.hostname.starts_with('-')
                    || !item
                        .hostname
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b":.-_[]".contains(&c))
                {
                    return Err("Enter a valid hostname and port.".into());
                }
                item.key_path = key_path(&item.key_path, paths)?;
                self.hosts
                    .retain(|h| !h.alias.eq_ignore_ascii_case(&item.alias));
                self.hosts.push(item);
            }
            "rule" => {
                let mut item: Rule =
                    serde_json::from_value(payload["rule"].clone()).map_err(err)?;
                self.has_profile(&item.profile_id)?;
                item.folder = folder(&item.folder, paths)?;
                self.rules.retain(|r| r.folder != item.folder);
                self.rules.push(item);
            }
            "removeProfile" => {
                let id = text(payload, "id")?;
                if self.rules.iter().any(|r| r.profile_id == id) {
                    return Err("Remove or reassign this profile’s folder rules first.".into());
                }
                self.profiles.retain(|p| p.id != id);
            }
            "removeHost" => {
                let alias = text(payload, "alias")?;
                self.hosts.retain(|h| h.alias != alias);
            }
            "removeRule" => {
                let folder = text(payload, "folder")?;
                self.rules.retain(|r| r.folder != folder);
            }
            _ => return Err("Unsupported configuration change.".into()),
        }
        self.profiles.sort_by(|a, b| a.id.cmp(&b.id));
        self.hosts.sort_by(|a, b| a.alias.cmp(&b.alias));
        self.rules.sort_by(|a, b| {
            a.folder
                .len()
                .cmp(&b.folder.len())
                .then(a.folder.cmp(&b.folder))
        });
        self.validate()
    }
    fn hosts_text(&self) -> Option<String> {
        let mut blocks = Vec::new();
        for p in &self.profiles {
            blocks.push(format!("Host {}\n  HostName github.com\n  User git\n  IdentityFile {}\n  IdentitiesOnly yes\n",p.alias,q(&p.key_path)));
        }
        for h in &self.hosts {
            blocks.push(format!("Host {}\n  HostName {}\n  User {}\n  Port {}\n  IdentityFile {}\n  IdentitiesOnly yes\n",h.alias,h.hostname,h.user,h.port,q(&h.key_path)));
        }
        (!blocks.is_empty()).then(|| format!("# Managed by SSH Workspace\n{}", blocks.join("\n")))
    }
    fn git_files(&self, paths: &Paths) -> AppResult<BTreeMap<PathBuf, String>> {
        let mut result = BTreeMap::new();
        let mut includes = String::new();
        for r in &self.rules {
            let p = self.has_profile(&r.profile_id)?;
            let file = paths.rule_file(&p.id);
            result.insert(
                file.clone(),
                format!(
                    "[user]\n\tname = {}\n\temail = {}\n",
                    q(&p.git_name),
                    q(&p.email)
                ),
            );
            let mut pattern = String::new();
            for c in r.folder.trim_end_matches('/').chars() {
                if matches!(c, '[' | '?' | '*' | '\\') {
                    pattern.push('\\');
                }
                pattern.push(c);
            }
            includes.push_str(&format!(
                "[includeIf {}]\n\tpath = {}\n",
                q(&format!("gitdir:{pattern}/")),
                q(&config_path(&file)?)
            ));
        }
        if !includes.is_empty() {
            result.insert(paths.app.join("folders.gitconfig"), includes);
        }
        Ok(result)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Change {
    path: PathBuf,
    before: Option<String>,
    after: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Transaction {
    id: String,
    files: Vec<Change>,
}
struct Plan {
    transaction: Transaction,
    diff: Vec<Value>,
}
impl Plan {
    fn new() -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        Self {
            transaction: Transaction { id, files: vec![] },
            diff: vec![],
        }
    }
    fn change(
        &mut self,
        path: PathBuf,
        before: Option<String>,
        after: Option<String>,
        display: Option<(String, String)>,
    ) {
        if before == after {
            return;
        }
        if let Some((old, new)) = display {
            self.diff
                .push(json!({"path":path,"before":old,"after":new}));
        }
        self.transaction.files.push(Change {
            path,
            before,
            after,
        });
    }
    fn managed(
        &mut self,
        path: PathBuf,
        before: Option<String>,
        after: Option<String>,
    ) -> AppResult<()> {
        if before == after {
            return Ok(());
        }
        if read(&path)? != before {
            return Err(format!(
                "{} has external edits. Reconcile that file before continuing.",
                path.display()
            ));
        }
        let display = changed_lines(
            before.as_deref().unwrap_or(""),
            after.as_deref().unwrap_or(""),
        );
        self.change(path, before, after, Some(display));
        Ok(())
    }
    fn hook(
        &mut self,
        path: PathBuf,
        block: String,
        was: bool,
        now: bool,
        start: bool,
    ) -> AppResult<()> {
        if !was && !now {
            return Ok(());
        }
        let path = if path.is_symlink() {
            path.canonicalize().map_err(|e| {
                format!(
                    "Cannot resolve linked configuration {}: {e}",
                    path.display()
                )
            })?
        } else {
            path
        };
        let before = read(&path)?;
        let source = before.as_deref().unwrap_or("");
        if was && !source.contains(&block) {
            return Err(format!(
                "The managed include changed in {}. Restore it before editing.",
                path.display()
            ));
        }
        if was == now {
            return Ok(());
        }
        let (content, diff) = if now {
            if source.contains(&block) {
                return Err(format!(
                    "{} already has a matching include.",
                    path.display()
                ));
            }
            let added = if start {
                block.clone() + source
            } else {
                format!(
                    "{source}{}{block}",
                    if source.is_empty() || source.ends_with('\n') {
                        ""
                    } else {
                        "\n"
                    }
                )
            };
            (added, (String::new(), block))
        } else {
            (source.replacen(&block, "", 1), (block, String::new()))
        };
        self.change(path, before, Some(content), Some(diff));
        Ok(())
    }
}

fn changed_lines(before: &str, after: &str) -> (String, String) {
    let old: Vec<_> = before.lines().collect();
    let new: Vec<_> = after.lines().collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    (
        old[prefix..old.len() - suffix].join("\n"),
        new[prefix..new.len() - suffix].join("\n"),
    )
}
fn ssh_alias_conflict(paths: &Paths, old: &Settings, new: &Settings) -> AppResult<()> {
    let added: Vec<_> = new
        .profiles
        .iter()
        .map(|p| p.alias.as_str())
        .chain(new.hosts.iter().map(|h| h.alias.as_str()))
        .filter(|a| {
            !old.profiles.iter().any(|p| p.alias.eq_ignore_ascii_case(a))
                && !old.hosts.iter().any(|h| h.alias.eq_ignore_ascii_case(a))
        })
        .collect();
    if added.is_empty() {
        return Ok(());
    }
    let existing = crate::native::declared_aliases(&paths.home.join(".ssh"));
    for alias in added {
        if existing
            .iter()
            .any(|entry| entry.eq_ignore_ascii_case(alias))
        {
            return Err(format!("SSH alias {alias} already exists in your SSH configuration. Choose a different alias."));
        }
    }
    Ok(())
}
const HOSTS_HOOK: &str =
    "# SSH Workspace hosts\nInclude ~/.ssh/ssh-workspace-hosts.conf\nHost *\n";

// Delete a host the user wrote by hand. Managed hosts and profile aliases are
// removed through their own settings so the generated file stays consistent.
fn config_host_plan(paths: &Paths, input: &Value) -> AppResult<Plan> {
    let alias = text(input, "alias")?;
    token(&alias, "host alias")?;
    let settings: Settings = stored(&paths.settings())?;
    if let Some(p) = settings
        .profiles
        .iter()
        .find(|p| p.alias.eq_ignore_ascii_case(&alias))
    {
        return Err(format!(
            "{alias} belongs to the {} profile. Remove that profile instead.",
            p.name
        ));
    }
    if settings
        .hosts
        .iter()
        .any(|h| h.alias.eq_ignore_ascii_case(&alias))
    {
        return Err(format!("{alias} is a managed host. Remove it as a managed host instead."));
    }
    let (path, before, after) =
        crate::native::remove_host_block(&paths.home.join(".ssh"), &alias, &paths.hosts())?;
    if before.contains(HOSTS_HOOK) && !after.contains(HOSTS_HOOK) {
        return Err("Deleting this host would change the Vexo include. Edit the file manually.".into());
    }
    if read(&path)?.as_deref() != Some(before.as_str()) {
        return Err(format!("{} changed while it was read. Try again.", path.display()));
    }
    let mut plan = Plan::new();
    let display = changed_lines(&before, &after);
    plan.change(path, Some(before), Some(after), Some(display));
    Ok(plan)
}

fn settings_plan(paths: &Paths, input: &Value) -> AppResult<Plan> {
    let before = read(&paths.settings())?;
    let old: Settings = before
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(err)?
        .unwrap_or_default();
    let mut new = old.clone();
    new.update(input, paths)?;
    if new == old {
        return Err("The settings already match.".into());
    }
    ssh_alias_conflict(paths, &old, &new)?;
    let mut plan = Plan::new();
    let old_ssh = old.hosts_text();
    let new_ssh = new.hosts_text();
    let was = old_ssh.is_some();
    let now = new_ssh.is_some();
    plan.managed(paths.hosts(), old_ssh, new_ssh)?;
    plan.hook(paths.ssh(), HOSTS_HOOK.to_owned(), was, now, true)?;
    let previous = old.git_files(paths)?;
    let next = new.git_files(paths)?;
    let mut keys: Vec<_> = previous.keys().chain(next.keys()).cloned().collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        plan.managed(k.clone(), previous.get(&k).cloned(), next.get(&k).cloned())?;
    }
    let pointer = config_path(&paths.app.join("folders.gitconfig"))?;
    plan.hook(
        paths.global.clone(),
        format!(
            "# SSH Workspace folder rules\n[include]\n\tpath = {}\n",
            q(&pointer)
        ),
        !old.rules.is_empty(),
        !new.rules.is_empty(),
        false,
    )?;
    let stored = pretty(&new)?;
    let metadata = changed_lines(&pretty(&old)?, &stored);
    plan.change(paths.settings(), before, Some(stored), Some(metadata));
    Ok(plan)
}

fn git(repo: Option<&Path>, args: &[&str]) -> AppResult<Output> {
    let mut cmd = Command::new("git");
    if let Some(path) = repo {
        cmd.arg("-C").arg(path);
    }
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Could not run Git: {e}"))
}
fn successful(out: Output) -> AppResult<String> {
    if !out.status.success() {
        return Err("Git could not read or update the selected repository configuration.".into());
    }
    String::from_utf8(out.stdout)
        .map(|s| s.trim_end_matches(['\r', '\n']).to_string())
        .map_err(err)
}
fn github_path(url: &str, settings: &Settings) -> AppResult<String> {
    let parsed = if let Some(v) = url.strip_prefix("https://github.com/") {
        Some(("github.com", v))
    } else if let Some(v) = url.strip_prefix("ssh://git@") {
        v.split_once('/')
            .map(|(host, p)| (host.strip_suffix(":22").unwrap_or(host), p))
    } else {
        url.strip_prefix("git@").and_then(|v| v.split_once(':'))
    };
    let (host, path) =
        parsed.ok_or("Select a standard GitHub HTTPS or SSH remote to change its profile.")?;
    if !(host.eq_ignore_ascii_case("github.com")
        || settings
            .profiles
            .iter()
            .any(|p| p.alias.eq_ignore_ascii_case(host)))
    {
        return Err("This remote points to an unrecognized host. Its URL was kept.".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|s| {
            s.is_empty()
                || *s == "."
                || *s == ".."
                || !s
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err("The GitHub repository URL has an unsupported path.".into());
    }
    Ok(path.into())
}
// Source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
const GITHUB_HOST_KEY: &str =
    "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

fn trust_github(paths: &Paths) -> AppResult<Plan> {
    let path = paths.home.join(".ssh/known_hosts");
    let path = if path.is_symlink() {
        path.canonicalize().map_err(err)?
    } else {
        path
    };
    let before = read(&path)?;
    if before.is_some() {
        for host in ["github.com", "[github.com]:22"] {
            let result = Command::new("ssh-keygen")
                .args(["-F", host, "-f"])
                .arg(&path)
                .output()
                .map_err(|e| format!("Could not check known hosts: {e}"))?;
            if result.status.success() {
                return Err("A GitHub host entry already exists. Review its fingerprint in your known_hosts file.".into());
            }
            if result.status.code() != Some(1) || !result.stderr.is_empty() {
                return Err("OpenSSH could not reliably check your known_hosts file. Resolve its errors first.".into());
            }
        }
    }
    let previous = before.as_deref().unwrap_or("");
    let separator = if previous.is_empty() || previous.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let after = format!("{previous}{separator}{GITHUB_HOST_KEY}\n");
    let mut plan = Plan::new();
    plan.change(
        path,
        before,
        Some(after),
        Some((String::new(), GITHUB_HOST_KEY.to_string())),
    );
    Ok(plan)
}

fn remote_plan(paths: &Paths, input: &Value) -> AppResult<Plan> {
    let settings: Settings = stored(&paths.settings())?;
    let repo = absolute(&text(input, "repo")?, &paths.home)?;
    let remote = text(input, "remote")?;
    token(&remote, "remote name")?;
    let id = text(input, "profileId")?;
    let p = settings.has_profile(&id)?;
    let common = successful(git(
        Some(&repo),
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?)?;
    let config = PathBuf::from(common).join("config");
    let before = read(&config)?.ok_or("Repository has no editable Git configuration.")?;
    let mut tmp = tempfile::NamedTempFile::new().map_err(err)?;
    tmp.write_all(before.as_bytes()).map_err(err)?;
    tmp.flush().map_err(err)?;
    let temp_path = config_path(tmp.path())?;
    let mut old = Vec::new();
    let mut new = Vec::new();
    for field in ["url", "pushurl"] {
        let key = format!("remote.{remote}.{field}");
        let out = git(
            None,
            &["config", "--file", &temp_path, "--null", "--get-all", &key],
        )?;
        if out.status.code() == Some(1) && field == "pushurl" {
            continue;
        }
        if !out.status.success() {
            return Err("Select a remote defined in the repository’s shared config file.".into());
        }
        let data = String::from_utf8(out.stdout).map_err(err)?;
        let urls: Vec<_> = data.split_terminator('\0').collect();
        if urls.len() != 1 {
            return Err(
                "This remote has multiple URLs. Edit it manually to preserve its routing.".into(),
            );
        }
        let url = urls[0];
        let suffix = github_path(url, &settings)?;
        let updated = format!("git@{}:{suffix}", p.alias);
        if updated != url {
            successful(git(
                None,
                &[
                    "config",
                    "--file",
                    &temp_path,
                    "--replace-all",
                    &key,
                    &updated,
                ],
            )?)?;
            old.push(format!("{field} = {url}"));
            new.push(format!("{field} = {updated}"));
        }
    }
    if old.is_empty() {
        return Err("This remote already uses the selected profile’s host alias.".into());
    }
    let after = fs::read_to_string(tmp.path()).map_err(err)?;
    let mut plan = Plan::new();
    plan.change(
        config,
        Some(before),
        Some(after),
        Some((old.join("\n"), new.join("\n"))),
    );
    Ok(plan)
}

// Git writers coordinate by creating <config>.lock. Publish our marker with
// no-clobber semantics so Git and this app cannot both commit the same file.
struct GitLock {
    path: PathBuf,
    marker: String,
}
impl GitLock {
    fn owned(&self) -> bool {
        fs::symlink_metadata(&self.path)
            .is_ok_and(|m| m.is_file() && m.len() == self.marker.len() as u64)
            && fs::read_to_string(&self.path).is_ok_and(|value| value == self.marker)
    }
}
impl Drop for GitLock {
    fn drop(&mut self) {
        if self.owned() {
            let _ = fs::remove_file(&self.path);
        }
    }
}
fn git_lock(paths: &Paths, path: &Path, id: &str) -> AppResult<Option<GitLock>> {
    let global = paths
        .global
        .canonicalize()
        .unwrap_or_else(|_| paths.global.clone());
    let ssh = paths.ssh().canonicalize().unwrap_or_else(|_| paths.ssh());
    if path != global && (path.file_name() != Some(std::ffi::OsStr::new("config")) || path == ssh) {
        return Ok(None);
    }
    let directory = path.parent().ok_or("Invalid Git config path.")?;
    ensure_folder(directory)?;
    let mut name = path.as_os_str().to_owned();
    name.push(".lock");
    let lock = GitLock {
        path: PathBuf::from(name),
        marker: format!("# SSH Workspace transaction {id}\n"),
    };
    // Only this app's exact transaction can own a lock left by an interrupted write.
    if lock.owned() {
        return Ok(Some(lock));
    }
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(err)?;
    temp.write_all(lock.marker.as_bytes()).map_err(err)?;
    temp.as_file().sync_all().map_err(err)?;
    temp.persist_noclobber(&lock.path).map_err(|e| {
        format!(
            "Git configuration {} is busy or cannot be locked: {}",
            path.display(),
            e.error
        )
    })?;
    Ok(Some(lock))
}

// Persist the in-flight transaction first. On restart, unfinished writes are
// reversed only when the file still has the exact contents written by this app.
#[derive(Serialize, Deserialize)]
struct Journal {
    undo: bool,
    started: usize,
    transaction: Transaction,
}
fn recover(paths: &Paths) -> AppResult<()> {
    let Some(raw) = read(&paths.journal())? else {
        return Ok(());
    };
    let j: Journal = serde_json::from_str(&raw).map_err(err)?;
    let history: Option<Transaction> = read(&paths.history())?
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(err)?;
    let complete = if j.undo {
        history.is_none()
    } else {
        history.as_ref().is_some_and(|h| h.id == j.transaction.id)
    };
    if !complete {
        for c in j.transaction.files.iter().take(j.started).rev() {
            let _lock = git_lock(paths, &c.path, &j.transaction.id)?;
            let current = read(&c.path)?;
            if current == c.before {
                continue;
            }
            if current != c.after {
                return Err(format!(
                    "{} changed during recovery. Resolve it before applying more changes.",
                    c.path.display()
                ));
            }
            write_file(&c.path, c.before.as_deref())?;
        }
    }
    write_file(&paths.journal(), None)
}
fn commit(paths: &Paths, transaction: &Transaction, undo: bool) -> AppResult<()> {
    for c in &transaction.files {
        if read(&c.path)? != c.before {
            return Err(format!(
                "{} changed since review. Preview again before continuing.",
                c.path.display()
            ));
        }
    }
    let mut journal = Journal {
        undo,
        started: 0,
        transaction: transaction.clone(),
    };
    write_file(&paths.journal(), Some(&pretty(&journal)?))?;
    let result = (|| -> AppResult<()> {
        for (index, c) in transaction.files.iter().enumerate() {
            if read(&c.path)? != c.before {
                return Err(format!("{} changed during the update.", c.path.display()));
            }
            journal.started = index + 1;
            write_file(&paths.journal(), Some(&pretty(&journal)?))?;
            let guard = git_lock(paths, &c.path, &transaction.id);
            let check = guard.as_ref().map_err(|e| e.to_string()).and_then(|_| {
                if read(&c.path)? == c.before {
                    Ok(())
                } else {
                    Err(format!("{} changed during the update.", c.path.display()))
                }
            });
            if let Err(error) = check {
                journal.started = index;
                write_file(&paths.journal(), Some(&pretty(&journal)?))?;
                return Err(error);
            }
            write_file(&c.path, c.after.as_deref())?;
        }
        if undo {
            write_file(&paths.history(), None)?;
        } else {
            write_file(&paths.history(), Some(&pretty(transaction)?))?;
        }
        write_file(&paths.journal(), None)
    })();
    if let Err(e) = result {
        return match recover(paths) {
            Ok(()) => Err(e),
            Err(recovery) => Err(format!("{e} {recovery}")),
        };
    }
    Ok(())
}
fn snapshot(paths: &Paths) -> AppResult<Value> {
    recover(paths)?;
    let settings: Settings = stored(&paths.settings())?;
    let repos: Vec<String> = stored(&paths.repos())?;
    let missing_keys: Vec<&str> = settings
        .profiles
        .iter()
        .map(|p| p.key_path.as_str())
        .chain(settings.hosts.iter().map(|h| h.key_path.as_str()))
        .filter(|k| !Path::new(k).is_file())
        .collect();
    Ok(
        json!({"profiles":settings.profiles,"hosts":settings.hosts,"rules":settings.rules,"repositories":repos,"canUndo":paths.history().is_file(),"missingKeys":missing_keys}),
    )
}
fn active() -> &'static Mutex<Option<Transaction>> {
    static PENDING: OnceLock<Mutex<Option<Transaction>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}
pub fn state() -> AppResult<Value> {
    snapshot(&Paths::discover()?)
}
pub fn preview(payload: Value) -> AppResult<Value> {
    let paths = Paths::discover()?;
    recover(&paths)?;
    let plan = match text(&payload, "kind")?.as_str() {
        "remote" => remote_plan(&paths, &payload)?,
        "trustGithub" => trust_github(&paths)?,
        "removeConfigHost" => config_host_plan(&paths, &payload)?,
        _ => settings_plan(&paths, &payload)?,
    };
    let response = json!({"token":plan.transaction.id,"files":plan.diff});
    *active().lock().map_err(err)? = Some(plan.transaction);
    Ok(response)
}
pub fn apply(payload: Value) -> AppResult<Value> {
    let paths = Paths::discover()?;
    recover(&paths)?;
    let selected = text(&payload, "token")?;
    let mut guard = active().lock().map_err(err)?;
    let change = guard
        .as_ref()
        .filter(|t| t.id == selected)
        .ok_or("This preview has expired. Review the change again.")?;
    commit(&paths, change, false)?;
    *guard = None;
    snapshot(&paths)
}
pub fn undo() -> AppResult<Value> {
    let paths = Paths::discover()?;
    recover(&paths)?;
    let mut last: Transaction =
        serde_json::from_str(&read(&paths.history())?.ok_or("There are no changes to undo.")?)
            .map_err(err)?;
    for c in &mut last.files {
        std::mem::swap(&mut c.before, &mut c.after);
    }
    last.files.reverse();
    commit(&paths, &last, true)?;
    snapshot(&paths)
}
pub fn remember_repo(path: &str) -> AppResult<()> {
    let paths = Paths::discover()?;
    let mut list: Vec<String> = stored(&paths.repos())?;
    if !list.iter().any(|p| p == path) {
        list.push(path.into());
        write_file(&paths.repos(), Some(&pretty(&list)?))?;
    }
    Ok(())
}
pub fn forget_repo(path: &str) -> AppResult<()> {
    let paths = Paths::discover()?;
    let mut list: Vec<String> = stored(&paths.repos())?;
    list.retain(|p| p != path);
    write_file(&paths.repos(), Some(&pretty(&list)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, Paths, Value) {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home with spaces");
        fs::create_dir_all(home.join(".ssh")).unwrap();
        let paths = Paths {
            home: home.clone(),
            app: home.join(".config/ssh-workspace"),
            global: home.join(".gitconfig"),
        };
        let key = home.join(".ssh/id_test");
        fs::write(&key, "test fixture").unwrap();
        let profile = json!({"kind":"profile","profile":{"id":"test-id","name":"Work","username":"example-work","gitName":"Example User","email":"dev@example.invalid","alias":"github-work","keyPath":key}});
        (temp, paths, profile)
    }
    fn run(paths: &Paths, input: &Value) {
        let p = settings_plan(paths, input).unwrap();
        commit(paths, &p.transaction, false).unwrap();
    }
    #[test]
    fn trust_github_preserves_other_hosts_and_respects_hashed_entries() {
        let (_temp, paths, _) = fixture();
        let path = paths.home.join(".ssh/known_hosts");
        let other = GITHUB_HOST_KEY.replacen("github.com", "unrelated.example", 1);
        fs::write(&path, &other).unwrap();
        let p = trust_github(&paths).unwrap();
        assert_eq!(p.diff[0]["before"], "");
        assert_eq!(p.diff[0]["after"], GITHUB_HOST_KEY);
        commit(&paths, &p.transaction, false).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{other}\n{GITHUB_HOST_KEY}\n")
        );
        assert!(trust_github(&paths).is_err());
        let fingerprint = Command::new("ssh-keygen")
            .args(["-lf"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&fingerprint.stdout)
            .contains("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"));
        assert!(Command::new("ssh-keygen")
            .args(["-H", "-f"])
            .arg(&path)
            .output()
            .unwrap()
            .status
            .success());
        assert!(trust_github(&paths).is_err());
    }
    #[test]
    fn profile_folder_is_one_review_and_preserves_other_assignments() {
        let (_temp, paths, mut work) = fixture();
        let folder = paths.home.join("Work");
        fs::create_dir(&folder).unwrap();
        work["folder"] = json!(folder);
        run(&paths, &work);
        let saved: Settings = stored(&paths.settings()).unwrap();
        assert_eq!(saved.rules[0].profile_id, "test-id");
        let mut other = work.clone();
        other["profile"]["id"] = json!("second");
        other["profile"]["alias"] = json!("github-personal");
        assert!(settings_plan(&paths, &other)
            .err()
            .unwrap()
            .contains("another profile"));
    }
    #[cfg(unix)]
    #[test]
    fn user_dotfile_links_and_included_aliases_are_preserved() {
        let (_temp, paths, profile) = fixture();
        let real = paths.home.join("dotfiles-ssh-config");
        fs::write(&real, "Include conf.d/*.conf\n").unwrap();
        std::os::unix::fs::symlink(&real, paths.ssh()).unwrap();
        let dir = paths.home.join(".ssh/conf.d");
        fs::create_dir(&dir).unwrap();
        let external = dir.join("custom.conf");
        fs::write(&external, "Host github-work\n").unwrap();
        assert!(settings_plan(&paths, &profile).is_err());
        fs::write(&external, "Host build-machine\n").unwrap();
        run(&paths, &profile);
        assert!(paths.ssh().is_symlink());
        assert!(fs::read_to_string(real)
            .unwrap()
            .contains("# SSH Workspace hosts"));
    }
    #[test]
    fn git_folder_rules_resolve_and_respect_local_authors() {
        let (_temp, paths, profile) = fixture();
        let ssh_text = "# My hosts\nHost example-box\n  User admin\n";
        fs::write(paths.ssh(), ssh_text).unwrap();
        fs::write(
            &paths.global,
            "[user]\n  email = personal@example.invalid\n",
        )
        .unwrap();
        run(&paths, &profile);
        assert!(fs::read_to_string(paths.ssh()).unwrap().contains(ssh_text));
        let repo = paths.home.join("Work/one");
        fs::create_dir_all(&repo).unwrap();
        successful(git(Some(&repo), &["init", "--quiet"]).unwrap()).unwrap();
        run(
            &paths,
            &json!({"kind":"rule","rule":{"folder":repo.parent().unwrap(),"profileId":"test-id"}}),
        );
        let effective = || {
            Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(["config", "user.email"])
                .env("GIT_CONFIG_GLOBAL", &paths.global)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .output()
                .unwrap()
        };
        assert_eq!(successful(effective()).unwrap(), "dev@example.invalid");
        successful(
            git(
                Some(&repo),
                &["config", "user.email", "repo@example.invalid"],
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(successful(effective()).unwrap(), "repo@example.invalid");
    }
    #[test]
    fn remotes_preserve_separate_push_target_and_refuse_stale_writes() {
        let (_temp, paths, profile) = fixture();
        run(&paths, &profile);
        let repo = paths.home.join("source");
        fs::create_dir(&repo).unwrap();
        for args in [
            vec!["init", "--quiet"],
            vec!["remote", "add", "origin", "https://github.com/a/code.git"],
            vec![
                "remote",
                "set-url",
                "--push",
                "origin",
                "git@github.com:b/fork.git",
            ],
        ] {
            successful(git(Some(&repo), &args).unwrap()).unwrap();
        }
        let p = remote_plan(
            &paths,
            &json!({"repo":repo,"remote":"origin","profileId":"test-id"}),
        )
        .unwrap();
        let f = &p.transaction.files[0];
        let original = read(&f.path).unwrap().unwrap();
        let lock = repo.join(".git/config.lock");
        fs::write(&lock, "Concurrent Git writer").unwrap();
        assert!(commit(&paths, &p.transaction, false).is_err());
        assert_eq!(fs::read_to_string(&lock).unwrap(), "Concurrent Git writer");
        assert!(!paths.journal().exists());
        fs::remove_file(&lock).unwrap();
        write_file(&f.path, Some(&(original.clone() + "# External edit\n"))).unwrap();
        assert!(commit(&paths, &p.transaction, false).is_err());
        write_file(&f.path, Some(&original)).unwrap();
        commit(&paths, &p.transaction, false).unwrap();
        assert_eq!(
            successful(git(Some(&repo), &["remote", "get-url", "origin"]).unwrap()).unwrap(),
            "git@github-work:a/code.git"
        );
        assert_eq!(
            successful(git(Some(&repo), &["remote", "get-url", "--push", "origin"]).unwrap())
                .unwrap(),
            "git@github-work:b/fork.git"
        );
        let mut t: Transaction =
            serde_json::from_str(&read(&paths.history()).unwrap().unwrap()).unwrap();
        for c in &mut t.files {
            std::mem::swap(&mut c.before, &mut c.after);
        }
        t.files.reverse();
        commit(&paths, &t, true).unwrap();
        assert_eq!(read(&f.path).unwrap().unwrap(), original);
        assert!(!paths.history().exists());
    }
    #[test]
    fn deletes_hand_written_hosts_with_review_and_undo() {
        let (_temp, paths, profile) = fixture();
        let mine = "\
# Personal GitHub Account\nHost github.com\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519\n\n\
# Work GitHub Account\nHost github.com-sagar\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/codeftshaunak\n\n\
# Teach Github Account\nHost github.com-teach\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519_teach\n\n\n";
        fs::write(paths.ssh(), mine).unwrap();
        run(&paths, &profile);
        let original = format!("{HOSTS_HOOK}{mine}");
        assert_eq!(fs::read_to_string(paths.ssh()).unwrap(), original);
        let remove = |alias: &str| {
            let p = config_host_plan(&paths, &json!({"alias": alias}))?;
            commit(&paths, &p.transaction, false)?;
            Ok::<_, String>(fs::read_to_string(paths.ssh()).unwrap())
        };
        // Middle block: its comment goes, neighbours and spacing stay.
        let after = remove("github.com-sagar").unwrap();
        assert_eq!(after, original.replace("# Work GitHub Account\nHost github.com-sagar\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/codeftshaunak\n\n", ""));
        // Undo restores the exact file.
        let mut t: Transaction =
            serde_json::from_str(&read(&paths.history()).unwrap().unwrap()).unwrap();
        for c in &mut t.files {
            std::mem::swap(&mut c.before, &mut c.after);
        }
        t.files.reverse();
        commit(&paths, &t, true).unwrap();
        assert_eq!(fs::read_to_string(paths.ssh()).unwrap(), original);
        // First block after the managed include keeps the include intact.
        let after = remove("github.com").unwrap();
        assert!(after.starts_with("# SSH Workspace hosts\nInclude ~/.ssh/ssh-workspace-hosts.conf\nHost *\n# Work GitHub Account\nHost github.com-sagar\n"));
        // Last block: trailing blank lines are trimmed.
        let after = remove("github.com-teach").unwrap();
        assert!(after.ends_with("IdentityFile ~/.ssh/codeftshaunak\n"), "{after:?}");
        assert!(remove("github.com-teach").unwrap_err().contains("not found"));
        // Profile aliases and the managed file are never edited here.
        assert!(remove("github-work").unwrap_err().contains("profile"));
        // Shared Host lines keep their other patterns.
        fs::write(paths.ssh(), "Host one two\n  User git\n").unwrap();
        assert_eq!(remove("one").unwrap(), "Host two\n  User git\n");
    }
    #[test]
    fn protects_external_config_and_recovers_interrupted_write() {
        let (_temp, paths, profile) = fixture();
        fs::write(paths.ssh(), "Host github-work\n  User another\n").unwrap();
        assert!(settings_plan(&paths, &profile).is_err());
        fs::remove_file(paths.ssh()).unwrap();
        let p = settings_plan(&paths, &profile).unwrap();
        let journal = Journal {
            undo: false,
            started: 1,
            transaction: p.transaction.clone(),
        };
        write_file(&paths.journal(), Some(&pretty(&journal).unwrap())).unwrap();
        let c = &p.transaction.files[0];
        write_file(&c.path, c.after.as_deref()).unwrap();
        recover(&paths).unwrap();
        assert_eq!(read(&c.path).unwrap(), c.before);
    }
}
