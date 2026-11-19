import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FileDirectoryIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  KeyIcon,
  PlusIcon,
  RepoCloneIcon,
  RepoIcon,
  SearchIcon,
  UnlinkIcon,
} from "@primer/octicons-react";
import {
  api,
  errorText,
  leaf,
  pickDirectory,
  profileAt,
  type Check,
  type Repository,
  type WorkspaceState,
} from "./api";
import Modal from "./Modal";

interface Props {
  state: WorkspaceState;
  revision: number;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openReview: (
    request: Record<string, unknown>,
    title: string,
  ) => Promise<void>;
  addProfile: () => void;
}
type Dialog = "open" | "scan" | "clone" | "repair" | null;

export default function Repositories({
  state,
  revision,
  refresh,
  notify,
  openReview,
  addProfile,
}: Props) {
  const [selected, setSelected] = useState(() =>
    state.repositories.includes(localStorage.getItem("last-repository") || "")
      ? localStorage.getItem("last-repository")!
      : state.repositories[0] || "",
  );
  const [repo, setRepo] = useState<Repository | null>(null),
    [repoError, setRepoError] = useState("");
  const [smallDetail, setSmallDetail] = useState(false),
    [filter, setFilter] = useState("");
  const [remoteName, setRemoteName] = useState("origin"),
    [check, setCheck] = useState<Check | null>(null),
    [checking, setChecking] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null),
    [path, setPath] = useState(""),
    [source, setSource] = useState(""),
    [profileId, setProfileId] = useState("");
  const [pending, setPending] = useState(false),
    [issue, setIssue] = useState(""),
    [results, setResults] = useState<string[] | null>(null);
  const sequence = useRef(0),
    testAfter = useRef<{ path: string; alias: string } | null>(null),
    listRef = useRef<HTMLDivElement>(null);
  const profile = repo ? profileAt(repo.path, state) : undefined;
  const remote =
    repo?.remotes.find((r) => r.name === remoteName) ?? repo?.remotes[0];
  const expected = profile?.username.toLowerCase();
  const differentAlias = Boolean(
    remote && profile && remote.alias !== profile.alias,
  );
  const wrongAccount = Boolean(
    check?.ok &&
    check.username &&
    expected &&
    check.username.toLowerCase() !== expected,
  );
  const wrongAuthor = Boolean(
    repo &&
    profile &&
    (repo.email !== profile.email || repo.gitName !== profile.gitName),
  );
  const canTest = Boolean(remote?.testable && !repo?.sshOverride);
  const groups = new Map<string, string[]>();
  for (const p of state.repositories.filter((p) =>
    p.toLowerCase().includes(filter.toLowerCase()),
  )) {
    const name = profileAt(p, state)?.name || "Unassigned";
    groups.set(name, [...(groups.get(name) || []), p]);
  }
  function selectRepo(p: string) {
    setSelected(p);
    localStorage.setItem("last-repository", p);
    setSmallDetail(true);
    setRemoteName("origin");
  }
  useEffect(() => {
    if (selected && !state.repositories.includes(selected))
      setSelected(state.repositories[0] || "");
    else if (!selected && state.repositories.length)
      setSelected(state.repositories[0]);
  }, [selected, state.repositories]);
  useEffect(() => {
    let current = true;
    sequence.current++;
    setChecking(false);
    setRepo(null);
    setRepoError("");
    setCheck(null);
    if (selected)
      api<Repository>("inspect", { path: selected })
        .then((v) => {
          if (current) setRepo(v);
        })
        .catch((e) => {
          if (current) setRepoError(errorText(e));
        });
    return () => {
      current = false;
      sequence.current++;
    };
  }, [selected, revision]);
  async function test(target = remote) {
    if (!target?.testable) return;
    const id = ++sequence.current;
    setChecking(true);
    try {
      const r = await api<Check>("test_connection", {
        alias: target.alias,
        fromRepo: true,
        login: target.login,
      });
      if (sequence.current === id) setCheck(r);
    } catch (e) {
      if (sequence.current === id)
        setCheck({ ok: false, username: "", message: errorText(e) });
    } finally {
      if (sequence.current === id) setChecking(false);
    }
  }
  useEffect(() => {
    const target = testAfter.current;
    if (
      target &&
      repo?.path === target.path &&
      remote?.alias === target.alias &&
      canTest
    ) {
      testAfter.current = null;
      void test(remote);
    }
  }, [repo, remote, canTest]);
  function show(type: Dialog) {
    setDialog(type);
    setIssue("");
    setPath("");
    setSource("");
    setResults(null);
    setProfileId(
      type === "repair" ? profile?.id || state.profiles[0]?.id || "" : "",
    );
  }
  async function browse() {
    try {
      const p = await pickDirectory();
      if (p) {
        setPath(p);
        setResults(null);
      }
    } catch (e) {
      setIssue(errorText(e));
    }
  }
  async function openPath(p: string) {
    const next = await api<Repository>("open_repo", { path: p });
    await refresh();
    selectRepo(next.path);
    setDialog(null);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setIssue("");
    try {
      if (dialog === "open") await openPath(path);
      if (dialog === "scan") {
        const items = await api<string[]>("scan_repos", { folder: path });
        setResults(items);
      }
      if (dialog === "clone") {
        const result = await api<{ path: string }>("clone_repo", {
          folder: path,
          source,
          profileId,
        });
        await refresh();
        selectRepo(result.path);
        setDialog(null);
        notify("Repository cloned.");
      }
      if (dialog === "repair" && repo && remote) {
        await openReview(
          { kind: "remote", repo: repo.path, remote: remote.name, profileId },
          "Review remote change",
        );
        const p = state.profiles.find((p) => p.id === profileId);
        if (p) testAfter.current = { path: repo.path, alias: p.alias };
        setDialog(null);
      }
    } catch (e) {
      setIssue(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function forget() {
    try {
      await api("forget_repo", { path: selected });
      await refresh();
      notify("Repository removed from the workspace list.");
    } catch (e) {
      notify(errorText(e));
    }
  }
  const back = () => {
    setSmallDetail(false);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus(),
    );
  };
  return (
    <section className="repo-section">
      <div className="pagehead">
        <div>
          <h1>Repositories</h1>
          <p>Inspect Git identities and SSH connections.</p>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => show("clone")}>
            <RepoCloneIcon />
            Clone
          </button>
          <button className="primary" onClick={() => show("open")}>
            <PlusIcon />
            Open repository
          </button>
        </div>
      </div>
      {state.repositories.length === 0 ? (
        <div className="welcome">
          <div className="welcome-mark">
            <RepoIcon size={32} />
          </div>
          <h2>Open your first repository</h2>
          <p>
            Choose a local project to see which author Git uses for commits and
            which SSH account handles pushes.
          </p>
          <div className="actions">
            <button className="secondary" onClick={() => show("scan")}>
              <SearchIcon />
              Find repositories in a folder
            </button>
          </div>
          {!state.profiles.length && (
            <div className="onboard">
              <KeyIcon />
              <span>Setting up personal and work accounts?</span>
              <button onClick={addProfile}>
                Add a profile <ArrowRightIcon size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={"repo-split " + (smallDetail ? "show-detail" : "")}>
          <div className="repo-list" ref={listRef}>
            <label className="search">
              <SearchIcon />
              <input
                aria-label="Filter repositories"
                placeholder="Find repository…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            {[...groups].map(([group, paths]) => (
              <div className="repo-group" key={group}>
                <h3>
                  <FileDirectoryIcon size={14} />
                  {group}
                </h3>
                {paths.map((p) => (
                  <button
                    key={p}
                    title={p}
                    aria-pressed={selected === p}
                    onClick={() => selectRepo(p)}
                  >
                    <RepoIcon />
                    <span>{leaf(p)}</span>
                    <ChevronRightIcon size={13} />
                  </button>
                ))}
              </div>
            ))}
            {!groups.size && (
              <p className="subtext">No matching repositories.</p>
            )}
            <button className="list-action" onClick={() => show("scan")}>
              <SearchIcon />
              Scan folder
            </button>
          </div>
          <article className="inspector">
            <button className="back-link" onClick={back}>
              <ArrowLeftIcon />
              Repository list
            </button>
            {repoError ? (
              <div className="error-block">
                <strong>Could not open repository</strong>
                <p>{repoError}</p>
                <button className="secondary" onClick={() => void forget()}>
                  Remove from list
                </button>
              </div>
            ) : !repo ? (
              <p role="status">Reading repository…</p>
            ) : (
              <>
                <div className="repo-title">
                  <span className="repo-glyph">
                    <RepoIcon size={21} />
                  </span>
                  <div>
                    <h2>{repo.name}</h2>
                    <code>{repo.path}</code>
                  </div>
                </div>
                <div className="branch-line">
                  <GitBranchIcon size={14} />
                  <code>{repo.branch || "No commits yet"}</code>
                </div>
                <h3 className="group-heading">Git identity</h3>
                <dl className="facts">
                  <div>
                    <dt>Folder profile</dt>
                    <dd>{profile?.name || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt>Commit author</dt>
                    <dd>{repo.gitName || "Unset"}</dd>
                  </div>
                  <div>
                    <dt>Commit email</dt>
                    <dd>
                      <code>{repo.email || "Unset"}</code>
                    </dd>
                  </div>
                </dl>
                {wrongAuthor && (
                  <div className="inline-alert">
                    <AlertIcon />
                    <span>
                      Expected {profile!.gitName} &lt;{profile!.email}&gt;.
                      Check the setting sources below.
                    </span>
                  </div>
                )}
                <div className="section-line">
                  <h3 className="group-heading">SSH connection</h3>
                  {repo.remotes.length > 1 && (
                    <select
                      aria-label="Remote"
                      value={remote?.name || ""}
                      onChange={(e) => {
                        sequence.current++;
                        setChecking(false);
                        setCheck(null);
                        setRemoteName(e.target.value);
                      }}
                    >
                      {repo.remotes.map((r) => (
                        <option key={r.name}>{r.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {remote ? (
                  <>
                    <dl className="facts">
                      <div>
                        <dt>Push remote</dt>
                        <dd>
                          <code>{remote.pushUrl || remote.url}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>SSH host</dt>
                        <dd>
                          <code>{remote.alias || "Non-SSH remote"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>GitHub account</dt>
                        <dd>
                          {check?.ok
                            ? check.username
                              ? "@" + check.username
                              : "SSH authenticated"
                            : check
                              ? "Check failed"
                              : "Untested"}
                        </dd>
                      </div>
                    </dl>
                    {repo.sshOverride && (
                      <div className="inline-alert">
                        <AlertIcon />
                        <span>
                          A custom SSH command controls this repository. Verify
                          its identity in your terminal.
                        </span>
                      </div>
                    )}
                    {!repo.sshOverride && remote.testReason && (
                      <p className="subtext">{remote.testReason}</p>
                    )}
                    {(differentAlias || wrongAccount) && (
                      <div className="inline-alert">
                        <AlertIcon />
                        <span>
                          {wrongAccount
                            ? "GitHub authenticated as @" +
                              check!.username +
                              ". "
                            : ""}
                          The {profile!.name} profile expects{" "}
                          <code>{profile!.alias}</code> and{" "}
                          <code>@{profile!.username}</code>.
                        </span>
                      </div>
                    )}
                    {check && !wrongAccount && (
                      <p
                        className={
                          "result " + (check.ok ? "success-text" : "error-text")
                        }
                        role="status"
                      >
                        {check.ok ? <CheckCircleIcon /> : <AlertIcon />}
                        {check.message}
                      </p>
                    )}
                    <div className="actions">
                      <button
                        className="secondary"
                        disabled={!canTest || checking}
                        onClick={() => void test()}
                      >
                        {checking ? "Testing…" : "Test connection"}
                      </button>
                      {state.profiles.length > 0 && (
                        <button
                          className={differentAlias ? "primary" : "secondary"}
                          onClick={() => show("repair")}
                        >
                          <GitPullRequestIcon />
                          {differentAlias
                            ? "Preview fix"
                            : "Change remote profile"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="subtext">This repository has no Git remotes.</p>
                )}
                <details className="config-sources">
                  <summary>Configuration sources</summary>
                  <dl className="facts">
                    <div>
                      <dt>Author name</dt>
                      <dd>
                        <code>{repo.nameSource || "Unset"}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Author email</dt>
                      <dd>
                        <code>{repo.emailSource || "Unset"}</code>
                      </dd>
                    </div>
                    {remote && (
                      <div>
                        <dt>Fetch URL</dt>
                        <dd>
                          <code>{remote.url}</code>
                        </dd>
                      </div>
                    )}
                  </dl>
                </details>
                <button className="text-action" onClick={() => void forget()}>
                  <UnlinkIcon size={14} />
                  Remove from workspace list
                </button>
              </>
            )}
          </article>
        </div>
      )}
      {dialog && (
        <Modal
          busy={pending}
          onClose={() => setDialog(null)}
          title={
            {
              open: "Open repository",
              scan: "Find repositories",
              clone: "Clone repository",
              repair: "Change remote profile",
            }[dialog]
          }
        >
          <form className="form-stack" onSubmit={submit}>
            {dialog === "clone" && (
              <label className="form-field">
                GitHub repository
                <input
                  autoFocus
                  required
                  value={source}
                  placeholder="git@github.com:owner/project.git"
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
            )}
            {dialog !== "repair" && (
              <label className="form-field">
                {dialog === "clone"
                  ? "Destination folder"
                  : dialog === "scan"
                    ? "Search folder"
                    : "Repository folder"}
                <span className="input-action">
                  <input
                    autoFocus={dialog !== "clone"}
                    required
                    value={path}
                    placeholder="/path/to/projects"
                    onChange={(e) => {
                      setPath(e.target.value);
                      setResults(null);
                    }}
                  />
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void browse()}
                  >
                    Browse…
                  </button>
                </span>
              </label>
            )}
            {(dialog === "repair" || dialog === "clone") && (
              <label className="form-field">
                SSH profile
                <select
                  required={dialog === "repair"}
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                >
                  {dialog === "clone" && (
                    <option value="">Use destination folder rule</option>
                  )}
                  {state.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.alias}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dialog === "repair" && remote && (
              <p className="subtext">
                Review the change to <code>{remote.name}</code> in{" "}
                <strong>{repo?.name}</strong> before applying it.
              </p>
            )}
            {results !== null && (
              <div className="scan-results">
                {results.length
                  ? results.map((p) => (
                      <button
                        disabled={pending}
                        key={p}
                        type="button"
                        onClick={async () => {
                          setPending(true);
                          try {
                            await openPath(p);
                          } catch (e) {
                            setIssue(errorText(e));
                          } finally {
                            setPending(false);
                          }
                        }}
                      >
                        <RepoIcon />
                        <span>{p}</span>
                        <ChevronRightIcon />
                      </button>
                    ))
                  : "No repositories found in this folder."}
              </div>
            )}
            {issue && (
              <p role="alert" className="error-block">
                {issue}
              </p>
            )}
            <div className="actions end">
              <button
                type="button"
                disabled={pending}
                className="secondary"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button disabled={pending} className="primary">
                {pending
                  ? "Working…"
                  : {
                      open: "Open repository",
                      clone: "Clone repository",
                      scan: "Find repositories",
                      repair: "Preview change",
                    }[dialog]}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
