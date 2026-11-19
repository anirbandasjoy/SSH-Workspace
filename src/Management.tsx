import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CopyIcon,
  FileDirectoryIcon,
  KeyIcon,
  LinkExternalIcon,
  PencilIcon,
  PersonIcon,
  PlusIcon,
  ServerIcon,
  TrashIcon,
} from "@primer/octicons-react";
import {
  api,
  errorText as reason,
  leaf as basename,
  openGithubSettings,
  pickDirectory,
} from "./api";
import type { Host, KeyInfo, Profile, Rule, WorkspaceState } from "./api";
import Modal from "./Modal";
import "./management.css";

type Section = "Profiles" | "SSH keys" | "Hosts" | "Folder rules";
type Review = (
  request: Record<string, unknown>,
  title: string,
) => Promise<void>;
type Toast = (message: string) => void;
type Test = { ok: boolean; username: string; message: string };
type Row = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  fingerprint?: string;
};

interface Props {
  section: Section;
  state: WorkspaceState;
  keys: KeyInfo[];
  hosts: Host[];
  refresh: () => Promise<void>;
  notify: Toast;
  openReview: Review;
  initialAdd?: boolean;
  onInitialAddHandled?: () => void;
}

const labels = {
  Profiles: {
    add: "New profile",
    singular: "profile",
    icon: PersonIcon,
    empty:
      "Group a Git author, GitHub username, and SSH key into a personal or work profile.",
  },
  "SSH keys": {
    add: "Generate key",
    singular: "key",
    icon: KeyIcon,
    empty:
      "Generate a passphrase-protected key to use with a GitHub account or SSH host.",
  },
  Hosts: {
    add: "Add host",
    singular: "host",
    icon: ServerIcon,
    empty:
      "Save an SSH alias with its hostname, port, login user, and identity file.",
  },
  "Folder rules": {
    add: "Add folder rule",
    singular: "folder rule",
    icon: FileDirectoryIcon,
    empty:
      "Assign a parent folder to a profile so repositories inside it inherit the right Git author.",
  },
} as const;

function aliasFor(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? "github-" + slug : "";
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p className="mw-error" role="alert">
      <AlertIcon size={16} />
      <span>{text}</span>
    </p>
  ) : null;
}
function Field({
  name,
  children,
  hint,
}: {
  name: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="mw-field">
      <span>{name}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Pair({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}
async function copyPublic(path: string) {
  const value = api<string>("public_key", { path });
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const text = value.then((key) => new Blob([key], { type: "text/plain" }));
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": text }),
      ]);
      return;
    } catch {
      // Some desktop WebViews only implement writeText.
    }
  }
  const key = await value;
  if (!navigator.clipboard?.writeText)
    throw new Error("Clipboard access is unavailable in this window.");
  await navigator.clipboard.writeText(key);
}

function KeyDialog({
  defaultName,
  done,
  close,
}: {
  defaultName: string;
  done: (key: KeyInfo) => void;
  close: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!pass || pass !== confirm) {
      setError("Enter the same passphrase in both fields.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const key = await api<KeyInfo>("generate_key", {
        name: name.trim(),
        passphrase: pass,
      });
      setPass("");
      setConfirm("");
      done(key);
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Generate SSH key" onClose={close} busy={busy}>
      <form className="mw-form" onSubmit={submit}>
        <p className="mw-intro">
          Create an Ed25519 key pair in your SSH directory.
        </p>
        <Field name="Key filename">
          <input
            value={name}
            pattern="[A-Za-z0-9_][A-Za-z0-9._\-]*"
            maxLength={80}
            required
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="id_ed25519_work"
          />
        </Field>
        <Field name="Passphrase">
          <input
            type="password"
            autoComplete="new-password"
            required
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </Field>
        <Field name="Confirm passphrase">
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <ErrorLine text={error} />
        <footer className="mw-form-actions">
          <button
            type="button"
            className="mw-button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="mw-button mw-primary" disabled={busy}>
            {busy ? "Generating…" : "Generate key"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function LoadKeyDialog({
  item,
  close,
  done,
}: {
  item: KeyInfo;
  close: () => void;
  done: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("agent_key", { path: item.path, action: "load", passphrase });
      setPassphrase("");
      done();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Load key into SSH agent" onClose={close} busy={busy}>
      <form className="mw-form" onSubmit={submit}>
        <p className="mw-intro">
          <code>{item.path}</code>
        </p>
        <Field name="Key passphrase" hint="Leave blank for an unencrypted key.">
          <input
            type="password"
            value={passphrase}
            autoFocus
            autoComplete="off"
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </Field>
        <ErrorLine text={error} />
        <footer className="mw-form-actions">
          <button
            type="button"
            disabled={busy}
            className="mw-button"
            onClick={close}
          >
            Cancel
          </button>
          <button className="mw-button mw-primary" disabled={busy}>
            {busy ? "Loading…" : "Load key"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function Editor({
  section,
  profile,
  host,
  rule,
  state,
  keys,
  openReview,
  refresh,
  notify,
  close,
}: Pick<
  Props,
  "section" | "state" | "keys" | "openReview" | "refresh" | "notify"
> & { profile?: Profile; host?: Host; rule?: Rule; close: () => void }) {
  const [p, setP] = useState<Profile>(
    () =>
      profile ?? {
        id: crypto.randomUUID(),
        name: "",
        username: "",
        gitName: "",
        email: "",
        alias: "",
        keyPath: "",
      },
  );
  const [h, setH] = useState<Host>(
    () => host ?? { alias: "", hostname: "", port: 22, user: "", keyPath: "" },
  );
  const [r, setR] = useState<Rule>(
    () => rule ?? { folder: "", profileId: state.profiles[0]?.id ?? "" },
  );
  const [folder, setFolder] = useState("");
  const [keyDialog, setKeyDialog] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const list = useId();
  const isProfile = section === "Profiles";
  const isRule = section === "Folder rules";
  const editing = Boolean(profile || host || rule);
  const key = isProfile ? p.keyPath : h.keyPath;
  function updateKey(path: string) {
    if (isProfile) setP((prev) => ({ ...prev, keyPath: path }));
    else setH((prev) => ({ ...prev, keyPath: path }));
    setMessage("");
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let request: Record<string, unknown>;
      if (isProfile) {
        const profile = Object.fromEntries(
          Object.entries(p).map(([k, v]) => [k, String(v).trim()]),
        );
        profile.alias ||= aliasFor(p.name);
        request = {
          kind: "profile",
          profile,
          ...(!editing && folder.trim() ? { folder: folder.trim() } : {}),
        };
      } else if (isRule) {
        request = {
          kind: "rule",
          rule: { profileId: r.profileId, folder: r.folder.trim() },
        };
      } else {
        request = {
          kind: "host",
          host: {
            ...h,
            alias: h.alias.trim(),
            hostname: h.hostname.trim(),
            user: h.user.trim(),
            keyPath: h.keyPath.trim(),
          },
        };
      }
      await openReview(
        request,
        (editing ? "Update " : "Add ") + labels[section].singular,
      );
      close();
    });
  }
  function generated(key: KeyInfo) {
    updateKey(key.path);
    setKeyDialog(false);
    notify("SSH key generated");
    void refresh().catch((e) => setError(reason(e)));
  }
  const aliasInput = (
    value: string,
    update: (s: string) => void,
    locked?: boolean,
    fallback?: string,
  ) => (
    <Field name="SSH alias">
      <input
        className="mw-mono"
        required={!fallback}
        value={value}
        readOnly={locked}
        onChange={(e) => update(e.target.value)}
        placeholder={fallback || "work-server"}
        autoCapitalize="none"
        spellCheck={false}
      />
    </Field>
  );
  return (
    <>
      <Modal
        title={(editing ? "Edit " : "New ") + labels[section].singular}
        onClose={close}
        busy={busy}
      >
        <form className="mw-form" onSubmit={submit}>
          {isProfile && (
            <>
              <Field name="Profile name">
                <input
                  autoFocus
                  required
                  value={p.name}
                  onChange={(e) => setP({ ...p, name: e.target.value })}
                  placeholder="Work"
                />
              </Field>
              <div className="mw-form-grid">
                <Field name="Commit author">
                  <input
                    required
                    value={p.gitName}
                    onChange={(e) => setP({ ...p, gitName: e.target.value })}
                    placeholder="Full name"
                  />
                </Field>
                <Field name="Commit email">
                  <input
                    type="email"
                    required
                    value={p.email}
                    onChange={(e) => setP({ ...p, email: e.target.value })}
                    placeholder="you@company.com"
                  />
                </Field>
              </div>
              <div className="mw-form-grid">
                <Field name="GitHub username">
                  <input
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                    value={p.username}
                    onChange={(e) => setP({ ...p, username: e.target.value })}
                    placeholder="your-account"
                  />
                </Field>
                {aliasInput(
                  p.alias,
                  (alias) => setP({ ...p, alias }),
                  false,
                  aliasFor(p.name),
                )}
              </div>
            </>
          )}
          {!isProfile && !isRule && (
            <>
              {aliasInput(h.alias, (alias) => setH({ ...h, alias }), editing)}
              <Field name="Hostname">
                <input
                  required
                  value={h.hostname}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setH({ ...h, hostname: e.target.value })}
                  placeholder="build.company.com"
                />
              </Field>
              <div className="mw-form-grid">
                <Field name="SSH user">
                  <input
                    required
                    value={h.user}
                    onChange={(e) => setH({ ...h, user: e.target.value })}
                    placeholder="deploy"
                  />
                </Field>
                <Field name="Port">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={h.port || ""}
                    onChange={(e) =>
                      setH({ ...h, port: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
            </>
          )}
          {!isRule && (
            <>
              <Field
                name="Private key path"
                hint="Use an existing identity file or generate a new key pair."
              >
                <input
                  required
                  list={list}
                  value={key}
                  spellCheck={false}
                  className="mw-mono"
                  onChange={(e) => updateKey(e.target.value)}
                  placeholder="~/.ssh/id_ed25519_work"
                />
              </Field>
              <datalist id={list}>
                {keys.map((k) => (
                  <option key={k.path} value={k.path}>
                    {k.type} · {k.name}
                  </option>
                ))}
              </datalist>
              <div className="mw-actions">
                <button
                  type="button"
                  className="mw-button"
                  disabled={busy}
                  onClick={() => setKeyDialog(true)}
                >
                  <KeyIcon />
                  Generate key
                </button>
                {isProfile && (
                  <>
                    <button
                      type="button"
                      className="mw-button"
                      disabled={!key || busy}
                      onClick={() =>
                        void run(async () => {
                          await copyPublic(key);
                          setMessage("Public key copied.");
                        })
                      }
                    >
                      <CopyIcon />
                      Copy public key
                    </button>
                    <button
                      type="button"
                      className="mw-link"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await openGithubSettings();
                        })
                      }
                    >
                      GitHub key settings <LinkExternalIcon size={13} />
                    </button>
                  </>
                )}
              </div>
              {message && (
                <p className="mw-positive" role="status">
                  {message}
                </p>
              )}
            </>
          )}
          {isProfile && !editing && (
            <div className="mw-folder-field">
              <Field
                name="Project folder (optional)"
                hint="Apply this Git author to repositories inside the folder."
              >
                <input
                  className="mw-mono"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="~/Projects/Work"
                />
              </Field>
              <button
                type="button"
                className="mw-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const selected = await pickDirectory();
                    if (selected) setFolder(selected);
                  })
                }
              >
                <FileDirectoryIcon />
                Browse folders
              </button>
            </div>
          )}
          {isRule && (
            <>
              <Field
                name="Parent folder"
                hint="Repositories inside this folder inherit the selected profile’s Git author."
              >
                <input
                  className="mw-mono"
                  required
                  readOnly={editing}
                  value={r.folder}
                  onChange={(e) => setR({ ...r, folder: e.target.value })}
                  placeholder="~/Projects/Work"
                />
              </Field>
              {!editing && (
                <div>
                  <button
                    type="button"
                    className="mw-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const folder = await pickDirectory();
                        if (folder) setR((prev) => ({ ...prev, folder }));
                      })
                    }
                  >
                    <FileDirectoryIcon />
                    Browse folders
                  </button>
                </div>
              )}
              <Field name="Identity profile">
                <select
                  required
                  value={r.profileId}
                  onChange={(e) => setR({ ...r, profileId: e.target.value })}
                >
                  {!state.profiles.length && (
                    <option value="">Create a profile first</option>
                  )}
                  {state.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.email}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <ErrorLine text={error} />
          <footer className="mw-form-actions">
            <button
              type="button"
              className="mw-button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              className="mw-button mw-primary"
              disabled={busy || (isRule && !state.profiles.length)}
            >
              {busy ? "Preparing…" : "Review changes"}
              <ChevronRightIcon size={14} />
            </button>
          </footer>
        </form>
      </Modal>
      {keyDialog && (
        <KeyDialog
          defaultName={
            "id_ed25519_" +
            (aliasFor(isProfile ? p.name : h.alias).replace(/^github-/, "") ||
              "work")
          }
          close={() => setKeyDialog(false)}
          done={generated}
        />
      )}
    </>
  );
}

function toRows({ section, state, keys, hosts }: Props): Row[] {
  if (section === "Profiles")
    return state.profiles.map((p) => ({
      id: p.id,
      title: p.name,
      subtitle: p.email,
      meta: "@" + p.username,
    }));
  if (section === "SSH keys")
    return keys.map((k) => ({
      id: k.path,
      title: k.name,
      subtitle: k.fingerprint,
      meta: k.type,
      fingerprint: k.fingerprint,
    }));
  if (section === "Folder rules")
    return state.rules.map((r) => ({
      id: r.folder,
      title: basename(r.folder),
      subtitle: r.folder,
      meta:
        state.profiles.find((p) => p.id === r.profileId)?.name ||
        "Unknown profile",
    }));
  return hosts.map((h) => ({
    id: h.alias,
    title: h.alias,
    subtitle: h.user + "@" + h.hostname,
    meta: state.hosts.some((m) => m.alias === h.alias)
      ? "Managed"
      : state.profiles.some((p) => p.alias === h.alias)
        ? "Profile"
        : "Existing config",
  }));
}

export function Management(props: Props) {
  return <ManagementPage key={props.section} {...props} />;
}
export default Management;

function ManagementPage(props: Props) {
  const {
    section,
    state,
    keys,
    hosts,
    refresh,
    notify,
    openReview,
    initialAdd,
    onInitialAddHandled,
  } = props;
  const { add, icon: Icon, empty, singular } = labels[section];
  const needsProfile = section === "Folder rules" && !state.profiles.length;
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [loadKey, setLoadKey] = useState<KeyInfo | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<{ identity: string; result: Test } | null>(
    null,
  );
  useEffect(() => {
    if (initialAdd) {
      setEditor("new");
      onInitialAddHandled?.();
    }
  }, [initialAdd, onInitialAddHandled]);
  const rows = toRows(props);
  const row = rows.find((r) => r.id === selected) || rows[0];
  const id = row?.id;
  const profile =
    section === "Profiles"
      ? state.profiles.find((p) => p.id === id)
      : undefined;
  const host =
    section === "Hosts" ? hosts.find((h) => h.alias === id) : undefined;
  const key =
    section === "SSH keys" ? keys.find((k) => k.path === id) : undefined;
  const rule =
    section === "Folder rules"
      ? state.rules.find((r) => r.folder === id)
      : undefined;
  const ruleProfile = rule
    ? state.profiles.find((p) => p.id === rule.profileId)
    : undefined;
  const hostProfile = host
    ? state.profiles.find((p) => p.alias === host.alias)
    : undefined;
  const editable = Boolean(
    profile ||
    rule ||
    (host && state.hosts.some((h) => h.alias === host.alias)),
  );
  const identity = JSON.stringify([
    profile || host,
    hostProfile?.username,
    keys.find((k) => k.path === (profile || host)?.keyPath)?.fingerprint,
  ]);
  const result = check?.identity === identity ? check.result : null;
  const expected = profile?.username || hostProfile?.username;
  const matched =
    result?.ok &&
    (!expected || result.username.toLowerCase() === expected.toLowerCase());
  async function run(label: string, callback: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await callback();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy("");
    }
  }
  function select(id: string) {
    setSelected(id);
    setError("");
  }
  function remove() {
    if (profile)
      return openReview({ kind: "removeProfile", id }, "Remove profile");
    if (rule)
      return openReview(
        { kind: "removeRule", folder: id },
        "Remove folder rule",
      );
    return openReview({ kind: "removeHost", alias: id }, "Remove host");
  }
  const primary = (
    <button
      type="button"
      className="mw-button mw-primary"
      onClick={() => {
        setError("");
        setEditor("new");
      }}
    >
      <PlusIcon />
      {needsProfile ? "Create first profile" : add}
    </button>
  );
  return (
    <div className="mw-page">
      <header className="mw-page-head">
        <h1>{section}</h1>
        {rows.length > 0 && primary}
      </header>
      {!row ? (
        <div className="mw-empty">
          <span className="mw-empty-icon">
            <Icon size={26} />
          </span>
          <h2>
            {section === "SSH keys"
              ? "No SSH keys found"
              : "No " + section.toLowerCase() + " yet"}
          </h2>
          <p>{empty}</p>
          {primary}
        </div>
      ) : (
        <div className="mw-work-area">
          <section className="mw-list" aria-label={"Select " + singular}>
            {rows.map((item) => (
              <button
                type="button"
                disabled={Boolean(busy)}
                className={"mw-row" + (id === item.id ? " is-active" : "")}
                key={item.id}
                aria-pressed={id === item.id}
                onClick={() => select(item.id)}
              >
                <Icon size={16} />
                <span className="mw-row-content">
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
                <ChevronRightIcon size={14} />
              </button>
            ))}
          </section>
          <section className="mw-inspector" aria-label={singular + " details"}>
            <div className="mw-detail-title">
              <div>
                <h2>{row.title}</h2>
                <p className="mw-secondary">{row.subtitle}</p>
              </div>
              {editable && (
                <button
                  type="button"
                  className="mw-icon-button"
                  disabled={Boolean(busy)}
                  onClick={() => setEditor("edit")}
                  aria-label={"Edit " + singular}
                  title={"Edit " + singular}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
            <dl className="mw-facts">
              {profile && (
                <>
                  <Pair name="GitHub account">@{profile.username}</Pair>
                  <Pair name="Commit author">{profile.gitName}</Pair>
                  <Pair name="Commit email">
                    <code>{profile.email}</code>
                  </Pair>
                  <Pair name="SSH alias">
                    <code>{profile.alias}</code>
                  </Pair>
                  <Pair name="Identity file">
                    <code>{profile.keyPath}</code>
                  </Pair>
                  <Pair name="Folder rules">
                    {state.rules
                      .filter((r) => r.profileId === profile.id)
                      .map((r) => (
                        <code className="mw-line" key={r.folder}>
                          {r.folder}
                        </code>
                      ))}
                    {!state.rules.some((r) => r.profileId === profile.id) &&
                      "Unassigned"}
                  </Pair>
                </>
              )}
              {key && (
                <>
                  <Pair name="Key type">{key.type}</Pair>
                  <Pair name="Fingerprint">
                    <code>{key.fingerprint}</code>
                  </Pair>
                  <Pair name="Public key">
                    <code>{key.publicPath}</code>
                  </Pair>
                  <Pair name="SSH agent">
                    {key.loaded ? "Loaded" : "Not loaded"}
                  </Pair>
                  <Pair name="Used by">
                    {[
                      ...state.profiles
                        .filter((p) => p.keyPath === key.path)
                        .map((p) => p.name),
                      ...state.hosts
                        .filter((h) => h.keyPath === key.path)
                        .map((h) => h.alias),
                    ].join(", ") || "No managed profiles or hosts"}
                  </Pair>
                </>
              )}
              {host && (
                <>
                  <Pair name="Hostname">
                    <code>{host.hostname || host.alias}</code>
                  </Pair>
                  <Pair name="Login user">
                    <code>{host.user || "System default"}</code>
                  </Pair>
                  <Pair name="Port">{host.port || 22}</Pair>
                  <Pair name="Identity file">
                    <code>{host.keyPath || "OpenSSH default"}</code>
                  </Pair>
                  <Pair name="Configured by">
                    {hostProfile ? hostProfile.name + " profile" : row.meta}
                  </Pair>
                </>
              )}
              {rule && (
                <>
                  <Pair name="Parent folder">
                    <code>{rule.folder}</code>
                  </Pair>
                  <Pair name="Profile">{ruleProfile?.name}</Pair>
                  <Pair name="Commit author">{ruleProfile?.gitName}</Pair>
                  <Pair name="Commit email">
                    <code>{ruleProfile?.email}</code>
                  </Pair>
                  <Pair name="Tracked repositories">
                    {
                      state.repositories.filter(
                        (path) =>
                          path.startsWith(
                            rule.folder.replace(/[\\/]+$/, "") + "/",
                          ) || path === rule.folder,
                      ).length
                    }
                  </Pair>
                </>
              )}
            </dl>
            <div className="mw-actions">
              {key && (
                <button
                  type="button"
                  className="mw-button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (!key.loaded) {
                      setLoadKey(key);
                      return;
                    }
                    void run("unload", async () => {
                      await api("agent_key", {
                        path: key.path,
                        action: "unload",
                      });
                      await refresh();
                      notify("Key unloaded from SSH agent");
                    });
                  }}
                >
                  {busy === "unload"
                    ? "Unloading…"
                    : key.loaded
                      ? "Unload from agent"
                      : "Load into agent"}
                </button>
              )}
              {(profile || host) && (
                <button
                  type="button"
                  className="mw-button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("test", async () => {
                      setCheck(null);
                      const result = await api<Test>("test_connection", {
                        alias: (profile || host)!.alias,
                      });
                      setCheck({ identity, result });
                    })
                  }
                >
                  {busy === "test" ? "Testing…" : "Test connection"}
                </button>
              )}
              {(key || profile) && (
                <button
                  type="button"
                  className="mw-button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("copy", async () => {
                      await copyPublic(key?.publicPath || profile!.keyPath);
                      notify("Public key copied");
                    })
                  }
                >
                  <CopyIcon size={14} />
                  Copy public key
                </button>
              )}
              {(key || profile) && (
                <button
                  type="button"
                  className="mw-link"
                  disabled={Boolean(busy)}
                  onClick={() => void run("github", openGithubSettings)}
                >
                  GitHub key settings
                  <LinkExternalIcon size={13} />
                </button>
              )}
              {editable && (
                <button
                  type="button"
                  className="mw-icon-button mw-remove"
                  disabled={Boolean(busy)}
                  aria-label={"Remove " + singular}
                  title={"Remove " + singular}
                  onClick={() => void run("remove", remove)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            {result && (
              <div
                className={"mw-test " + (matched ? "is-good" : "is-warn")}
                role="status"
              >
                {matched ? <CheckCircleIcon /> : <AlertIcon />}
                <div>
                  <strong>
                    {matched
                      ? "Connection verified"
                      : result.ok
                        ? "Account mismatch"
                        : "Connection failed"}
                  </strong>
                  <span>
                    {result.ok && expected && !matched
                      ? "Expected @" +
                        expected +
                        ", authenticated as @" +
                        result.username +
                        "."
                      : result.message}
                  </span>
                </div>
              </div>
            )}
            <ErrorLine text={error} />
          </section>
        </div>
      )}
      {editor && section !== "SSH keys" && (
        <Editor
          {...{ state, keys, openReview, refresh, notify }}
          section={needsProfile ? "Profiles" : section}
          profile={editor === "edit" ? profile : undefined}
          host={editor === "edit" ? host : undefined}
          rule={editor === "edit" ? rule : undefined}
          close={() => setEditor(null)}
        />
      )}
      {editor && section === "SSH keys" && (
        <KeyDialog
          defaultName="id_ed25519_work"
          close={() => setEditor(null)}
          done={(key) => {
            setEditor(null);
            setSelected(key.path);
            notify("SSH key generated");
            void refresh().catch((e) => notify(reason(e)));
          }}
        />
      )}
      {loadKey && (
        <LoadKeyDialog
          item={loadKey}
          close={() => setLoadKey(null)}
          done={() => {
            setLoadKey(null);
            notify("Key loaded into SSH agent");
            void refresh().catch((e) => notify(reason(e)));
          }}
        />
      )}
    </div>
  );
}
