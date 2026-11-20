import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read the desktop app version at build time so download links follow releases.
function desktopVersion() {
  try {
    const file = join(process.cwd(), "../desktop/src-tauri/tauri.conf.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  } catch {
    return "0.1.1";
  }
}

const repo =
  process.env.NEXT_PUBLIC_REPO_URL ||
  "https://github.com/anirbandasjoy/vexo";
const version = process.env.NEXT_PUBLIC_APP_VERSION || desktopVersion();
const debFile = `Vexo_${version}_amd64.deb`;
// Asset names produced by .github/workflows/release.yml (tauri-action).
const asset = (file: string) => `${repo}/releases/latest/download/${file}`;

export type Platform = "mac" | "windows" | "linux";
export interface Download {
  label: string;
  detail: string;
  file: string;
  url: string;
}

export const downloads: Record<Platform, { name: string; files: Download[] }> = {
  mac: {
    name: "macOS",
    files: [
      {
        label: "Apple Silicon",
        detail: "M1 and newer · .dmg",
        file: `Vexo_${version}_aarch64.dmg`,
        url: asset(`Vexo_${version}_aarch64.dmg`),
      },
      {
        label: "Intel",
        detail: "Intel Macs · .dmg",
        file: `Vexo_${version}_x64.dmg`,
        url: asset(`Vexo_${version}_x64.dmg`),
      },
    ],
  },
  windows: {
    name: "Windows",
    files: [
      {
        label: "Windows 10 / 11",
        detail: "64-bit installer · .exe",
        file: `Vexo_${version}_x64-setup.exe`,
        url: asset(`Vexo_${version}_x64-setup.exe`),
      },
    ],
  },
  linux: {
    name: "Linux",
    files: [
      {
        label: "Ubuntu / Debian",
        detail: "x86-64 · .deb",
        file: debFile,
        url: process.env.NEXT_PUBLIC_DOWNLOAD_URL || asset(debFile),
      },
      {
        label: "Other distributions",
        detail: "x86-64 · .AppImage",
        file: `Vexo_${version}_amd64.AppImage`,
        url: asset(`Vexo_${version}_amd64.AppImage`),
      },
    ],
  },
};

export const site = {
  // Canonical address used for links, social previews and the sitemap.
  url: (process.env.SITE_URL || "https://vexo.joydas.dev").replace(/\/+$/, ""),
  title: "Vexo: manage multiple GitHub accounts and SSH keys",
  author: { name: "Joy Das", url: "https://github.com/anirbandasjoy" },
  keywords: [
    "multiple GitHub accounts",
    "SSH key manager",
    "GitHub SSH keys",
    "switch GitHub accounts",
    "Git identity",
    "git commit email per folder",
    "includeIf gitdir",
    "SSH config manager",
    "ssh-agent",
    "desktop app",
    "macOS",
    "Windows",
    "Linux",
  ],
  name: "Vexo",
  tagline: "Every GitHub account. The right key. Every time.",
  description:
    "Vexo is a desktop app that manages SSH keys, GitHub accounts, commit authors and folder rules, so every repository pushes with the right identity.",
  version,
  repo,
  releases: `${repo}/releases`,
  debFile,
};
