import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface Profile {
  id: string;
  name: string;
  username: string;
  gitName: string;
  email: string;
  alias: string;
  keyPath: string;
}
export interface Host {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  keyPath: string;
}
export interface Rule {
  folder: string;
  profileId: string;
}
export interface WorkspaceState {
  profiles: Profile[];
  hosts: Host[];
  rules: Rule[];
  repositories: string[];
  canUndo: boolean;
}
export interface KeyInfo {
  path: string;
  publicPath: string;
  name: string;
  fingerprint: string;
  type: string;
  loaded: boolean;
}
export interface Remote {
  name: string;
  url: string;
  pushUrl: string;
  alias: string;
  testable: boolean;
  testReason: string;
  login: string;
}
export interface Repository {
  path: string;
  name: string;
  gitName: string;
  email: string;
  nameSource: string;
  emailSource: string;
  branch: string;
  remotes: Remote[];
  sshOverride: string;
}
export interface Check {
  ok: boolean;
  username: string;
  message: string;
}
export interface EnvInfo {
  git: string;
  ssh: string;
  agent: string;
  home: string;
}
export interface Review {
  token: string;
  files: { path: string; before: string; after: string }[];
}
export const empty: WorkspaceState = {
  profiles: [],
  hosts: [],
  rules: [],
  repositories: [],
  canUndo: false,
};

export function api<T = unknown>(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      new Error(
        "Open the desktop app to access local SSH and Git. Start it with npm run desktop.",
      ),
    );
  return invoke<T>("workspace", { name, payload });
}
export async function pickDirectory(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}
export function openGithubSettings(): Promise<void> {
  return invoke("open_github_settings");
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
export function profileAt(
  path: string,
  state: WorkspaceState,
): Profile | undefined {
  const clean = (s: string) => {
    const unix = s.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[A-Za-z]:\//.test(unix) ? unix.toLowerCase() : unix;
  };
  const dir = clean(path);
  const match = state.rules
    .filter(
      (r) => dir === clean(r.folder) || dir.startsWith(clean(r.folder) + "/"),
    )
    .sort((a, b) => b.folder.length - a.folder.length)[0];
  return state.profiles.find((p) => p.id === match?.profileId);
}
export function leaf(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}
