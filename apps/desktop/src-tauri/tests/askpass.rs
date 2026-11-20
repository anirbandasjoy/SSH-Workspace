// Checks that the Vexo executable works as an SSH_ASKPASS helper, which is how
// passphrase-protected keys are loaded into the SSH agent on Windows.
use std::path::Path;
use std::process::{Command, Output, Stdio};

const VEXO: &str = env!("CARGO_BIN_EXE_vexo");
const SECRET: &str = "VEXO_ASKPASS_SECRET";

fn quiet(cmd: &mut Command) -> Output {
    cmd.stdin(Stdio::null()).output().expect("command could not start")
}

#[test]
fn prints_the_passphrase_and_exits() {
    let out = quiet(
        Command::new(VEXO)
            .arg("Enter passphrase for key:")
            .env(SECRET, "correct horse 1"),
    );
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "correct horse 1\n");
}

struct Agent {
    socket: Option<std::path::PathBuf>,
    child: Option<std::process::Child>,
}
impl Agent {
    // An isolated agent on Unix; the OpenSSH Authentication Agent service on Windows.
    fn start(dir: &Path) -> Option<Self> {
        if cfg!(windows) {
            let status = quiet(Command::new("ssh-add").arg("-l")).status.code();
            return (status != Some(2)).then_some(Agent {
                socket: None,
                child: None,
            });
        }
        let socket = dir.join("agent.sock");
        let child = Command::new("ssh-agent")
            .args(["-D", "-a"])
            .arg(&socket)
            .stdout(Stdio::null())
            .spawn()
            .ok()?;
        for _ in 0..200 {
            if socket.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Some(Agent {
            socket: Some(socket),
            child: Some(child),
        })
    }
    fn ssh_add(&self) -> Command {
        let mut cmd = Command::new("ssh-add");
        if let Some(socket) = &self.socket {
            cmd.env("SSH_AUTH_SOCK", socket);
        }
        cmd
    }
}
impl Drop for Agent {
    fn drop(&mut self) {
        if let Some(child) = &mut self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[test]
fn ssh_add_loads_a_passphrase_key_through_the_helper() {
    let dir = tempfile::tempdir().unwrap();
    let key = dir.path().join("locked");
    let made = quiet(
        Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-C", "vexo-test", "-N", "correct horse 1", "-f"])
            .arg(&key),
    );
    assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
    let Some(agent) = Agent::start(dir.path()) else {
        eprintln!("No SSH agent is available; skipping.");
        return;
    };
    let added = quiet(
        agent
            .ssh_add()
            .arg(&key)
            .env("SSH_ASKPASS", VEXO)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", ":0")
            .env(SECRET, "correct horse 1"),
    );
    assert!(
        added.status.success(),
        "ssh-add failed: {}",
        String::from_utf8_lossy(&added.stderr)
    );
    let mut public = key.clone().into_os_string();
    public.push(".pub");
    let fingerprint = quiet(Command::new("ssh-keygen").args(["-l", "-E", "sha256", "-f"]).arg(&public));
    let fingerprint = String::from_utf8_lossy(&fingerprint.stdout)
        .split_whitespace()
        .nth(1)
        .unwrap()
        .to_string();
    let listed = quiet(agent.ssh_add().args(["-l", "-E", "sha256"]));
    let removed = quiet(agent.ssh_add().arg("-d").arg(&public));
    assert!(String::from_utf8_lossy(&listed.stdout).contains(&fingerprint));
    assert!(removed.status.success());
}
