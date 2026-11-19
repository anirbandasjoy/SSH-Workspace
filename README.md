# SSH Workspace

A Tauri 2 desktop application for managing SSH keys, GitHub profiles, Git authors, and folder-based account rules. The interface uses React, TypeScript, GitHub Primer, and Octicons. The Rust backend works with your installed Git and OpenSSH.

## Run on Linux

Launch the compiled executable from the project directory.

```sh
./src-tauri/target/release/ssh-workspace
```

The Debian installer is under `src-tauri/target/release/bundle/deb/`. Install it to launch SSH Workspace from the applications menu.

## Personal and work setup

1. Open **Profiles → New profile**. Set a label, GitHub username, commit name and email, and a unique SSH alias. Select an existing key or generate an encrypted Ed25519 key. Optionally choose a project folder to assign to this profile.
2. Copy the public key and open GitHub's SSH key settings from the app. Register it as an authentication key while signed in to the intended account. Use a separate key for each account.
3. Review the configuration changes and apply them. In **SSH keys**, load the key into the SSH agent your desktop session uses.
4. Choose **Test connection** on the profile to see the account GitHub authenticates. On a first connection to github.com, **Preferences → Trust GitHub host key** previews the published Ed25519 key. Verify the fingerprint before applying it. [GitHub's SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
5. Set up the second profile. Add additional paths in **Folder rules**. In **Repositories**, open a local project, find projects in a folder, or clone from GitHub. Cloning selects the destination folder’s profile by default. The inspector shows the effective commit author and the account used by the selected remote. Use **Preview fix** to review an incorrect remote alias.
6. **Undo last change** restores the last applied configuration transaction and checks for intervening edits. Removing a repository from the workspace list only changes the app’s bookmarks.

## Delete a local SSH key

In **SSH keys**, select a key and choose **Delete key**. Review the file list before confirming permanent deletion. The app unloads the key from the SSH agent if it is loaded. If a managed profile or host uses the key, reassign it first. Remove the public key from GitHub or your server to revoke access there.

## Development

Install Node.js 22.12+ or a current LTS, pnpm 10, Rust, Git, OpenSSH, and the native packages for Tauri 2. The packaged build here targets Ubuntu/Debian x86-64 with GTK 3 and WebKitGTK 4.1. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

```sh
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles deb
```

## Local configuration

The app stores its profile metadata, repository list, and single-step undo history in `$XDG_CONFIG_HOME/ssh-workspace` (default `~/.config/ssh-workspace`). It previews edits to the SSH configuration and Git conditional includes, and edits a repository’s chosen remote on request. Keys stay in the OpenSSH directory. Passphrases are used transiently for generation or agent loading. A custom SSH command, a repository-local author override, or a separate push URL can affect the identity in use. Open the repository inspector to see those settings and their sources.
