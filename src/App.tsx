import { useCallback, useEffect, useRef, useState } from "react";
import { NavList } from "@primer/react";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FileDirectoryIcon,
  HistoryIcon,
  KeyIcon,
  PersonIcon,
  RepoIcon,
  ServerIcon,
  SlidersIcon,
  SyncIcon,
  TerminalIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  api,
  empty,
  errorText,
  type EnvInfo,
  type Host,
  type KeyInfo,
  type Review,
  type WorkspaceState,
} from "./api";
import { Management } from "./Management";
import Repositories from "./Repositories";
import Modal from "./Modal";

type Section =
  "Repositories" | "Profiles" | "SSH keys" | "Hosts" | "Folder rules";
type Mode = "system" | "light" | "dark";
const navigation = [
  { name: "Repositories", icon: RepoIcon },
  { name: "Profiles", icon: PersonIcon },
  { name: "SSH keys", icon: KeyIcon },
  { name: "Hosts", icon: ServerIcon },
  { name: "Folder rules", icon: FileDirectoryIcon },
] as const;

export default function App({
  mode,
  onMode,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
}) {
  const [section, setSection] = useState<Section>("Repositories");
  const [state, setState] = useState<WorkspaceState>(empty);
  const [keys, setKeys] = useState<KeyInfo[]>([]),
    [hosts, setHosts] = useState<Host[]>([]);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false);
  const [startupError, setStartupError] = useState(""),
    [message, setMessage] = useState("");
  const [trustBusy, setTrustBusy] = useState(false);
  const [settings, setSettings] = useState(false),
    [initialAdd, setInitialAdd] = useState(false);
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<(Review & { title: string }) | null>(
    null,
  );
  const [undo, setUndo] = useState(false),
    [writing, setWriting] = useState(false),
    [writeError, setWriteError] = useState("");
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++latest.current;
    setRefreshing(true);
    const result = await Promise.allSettled([
      api<WorkspaceState>("state"),
      api<KeyInfo[]>("keys"),
      api<Host[]>("hosts"),
      api<EnvInfo>("env_info"),
    ] as const);
    if (seq !== latest.current) return;
    const [s, k, h, e] = result;
    if (s.status === "fulfilled") {
      setState(s.value);
      setStartupError("");
    } else setStartupError(errorText(s.reason));
    if (k.status === "fulfilled") setKeys(k.value);
    if (h.status === "fulfilled") setHosts(h.value);
    if (e.status === "fulfilled") setEnv(e.value);
    const failures = [k, h, e].filter((v) => v.status === "rejected");
    if (failures.length && s.status === "fulfilled")
      setMessage(failures.map((v) => errorText(v.reason)).join(" · "));
    setRevision((n) => n + 1);
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const openReview = async (
    request: Record<string, unknown>,
    title: string,
  ) => {
    const result = await api<Review>("preview", request);
    setWriteError("");
    setReview({ ...result, title });
  };
  const commit = async () => {
    if (writing || (!review && !undo)) return;
    setWriting(true);
    setWriteError("");
    try {
      const updated = await api<WorkspaceState>(
        undo ? "undo" : "apply",
        review ? { token: review.token } : {},
      );
      setState(updated);
      setMessage(
        undo ? "Configuration change undone." : "Configuration updated.",
      );
      setReview(null);
      setUndo(false);
      await refresh();
    } catch (e) {
      setWriteError(errorText(e));
    } finally {
      setWriting(false);
    }
  };
  function navigate(next: Section) {
    setSection(next);
    setInitialAdd(false);
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <TerminalIcon size={23} />
          </span>
          <div>
            SSH Workspace<span>Desktop</span>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        <NavList aria-label="Workspace navigation" className="main-nav">
          {navigation.map(({ name, icon: Icon }) => (
            <NavList.Item
              key={name}
              href={"#" + name.toLowerCase().replaceAll(" ", "-")}
              aria-current={section === name ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(name);
              }}
            >
              <NavList.LeadingVisual>
                <Icon size={16} />
              </NavList.LeadingVisual>
              {name}
            </NavList.Item>
          ))}
        </NavList>
        <div className="sidebar-bottom">
          <button
            onClick={() => {
              setWriteError("");
              setUndo(true);
            }}
            disabled={!state.canUndo}
          >
            <HistoryIcon />
            Undo last change
          </button>
          <button onClick={() => setSettings(true)}>
            <SlidersIcon />
            Preferences
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="appbar">
          <div>
            <TerminalIcon />
            <span>Local workspace</span>
            <ChevronRightIcon size={12} />
            <strong>{section}</strong>
          </div>
          <button
            title="Refresh workspace"
            aria-label="Refresh workspace"
            className="plain-icon"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <SyncIcon className={refreshing ? "spinning" : ""} />
          </button>
        </header>
        <div className="canvas">
          {loading ? (
            <div className="pending" role="status">
              Reading workspace…
            </div>
          ) : startupError ? (
            <section className="empty">
              <AlertIcon size={28} />
              <h1>Workspace unavailable</h1>
              <p>{startupError}</p>
              <button className="primary" onClick={() => void refresh()}>
                Try again
              </button>
            </section>
          ) : section === "Repositories" ? (
            <Repositories
              state={state}
              revision={revision}
              refresh={refresh}
              notify={setMessage}
              openReview={openReview}
              addProfile={() => {
                setSection("Profiles");
                setInitialAdd(true);
              }}
            />
          ) : (
            <Management
              key={section}
              section={section}
              state={state}
              keys={keys}
              hosts={hosts}
              refresh={refresh}
              notify={setMessage}
              openReview={openReview}
              initialAdd={initialAdd}
              onInitialAddHandled={() => setInitialAdd(false)}
            />
          )}
        </div>
        <footer className="statusbar">
          <span>
            <span className={"status-dot " + (startupError ? "issue" : "")} />
            {refreshing
              ? "Refreshing"
              : startupError
                ? "Unavailable"
                : "Local workspace"}
          </span>
          <span>
            {state.profiles.length}{" "}
            {state.profiles.length === 1 ? "profile" : "profiles"}
          </span>
        </footer>
      </main>
      {message && (
        <div className="notice" role="status">
          <span>{message}</span>
          <button
            className="plain-icon"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <XIcon />
          </button>
        </div>
      )}
      {settings && (
        <Modal title="Preferences" onClose={() => setSettings(false)}>
          <label className="form-field">
            Appearance
            <select
              value={mode}
              onChange={(e) => onMode(e.target.value as Mode)}
            >
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <h3 className="minor-title">Local environment</h3>
          <dl className="facts">
            {[
              ["Git", env?.git],
              ["OpenSSH", env?.ssh],
              ["SSH agent", env?.agent],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v || "Unavailable"}</dd>
              </div>
            ))}
          </dl>
          <h3 className="minor-title">GitHub.com host key</h3>
          <p className="subtext">
            For a first connection on port 22, review GitHub’s published Ed25519
            key before adding it to known_hosts.
          </p>
          <p className="fingerprint">
            <code>SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU</code>
          </p>
          <button
            className="secondary"
            disabled={trustBusy}
            onClick={async () => {
              setTrustBusy(true);
              try {
                await openReview(
                  { kind: "trustGithub" },
                  "Trust GitHub host key",
                );
                setSettings(false);
              } catch (e) {
                setMessage(errorText(e));
                setSettings(false);
              } finally {
                setTrustBusy(false);
              }
            }}
          >
            Trust GitHub host key
          </button>
        </Modal>
      )}
      {(review || undo) && (
        <Modal
          title={undo ? "Undo last configuration change" : review!.title}
          busy={writing}
          onClose={() => {
            setReview(null);
            setUndo(false);
          }}
        >
          {review ? (
            <div className="diff-list">
              {review.files.map((f, i) => (
                <section className="diff-file" key={i}>
                  <strong>{f.path}</strong>
                  {f.before && (
                    <pre className="removed">
                      {f.before
                        .split("\n")
                        .map((l) => "− " + l)
                        .join("\n")}
                    </pre>
                  )}
                  {f.after && (
                    <pre className="added">
                      {f.after
                        .split("\n")
                        .map((l) => "+ " + l)
                        .join("\n")}
                    </pre>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p>
              The app will restore the files from the last applied change after
              checking for newer edits.
            </p>
          )}
          {writeError && (
            <div className="error-block" role="alert">
              {writeError}
            </div>
          )}
          <div className="actions end">
            <button
              className="secondary"
              disabled={writing}
              onClick={() => {
                setReview(null);
                setUndo(false);
              }}
            >
              <ArrowLeftIcon /> Cancel
            </button>
            <button
              className="primary"
              disabled={writing}
              onClick={() => void commit()}
            >
              <CheckCircleIcon />
              {writing ? "Saving…" : undo ? "Undo change" : "Apply changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
