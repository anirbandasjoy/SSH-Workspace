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
  process.env.NEXT_PUBLIC_REPO_URL ??
  "https://github.com/anirbandasjoy/vexo";
const version = process.env.NEXT_PUBLIC_APP_VERSION ?? desktopVersion();
const debFile = `Vexo_${version}_amd64.deb`;

export const site = {
  name: "Vexo",
  tagline: "Every GitHub account. The right key. Every time.",
  description:
    "Vexo is a desktop app that manages SSH keys, GitHub accounts, commit authors and folder rules, so every repository pushes with the right identity.",
  version,
  repo,
  releases: `${repo}/releases`,
  debFile,
  downloads: {
    linuxDeb:
      process.env.NEXT_PUBLIC_DOWNLOAD_URL ??
      `${repo}/releases/latest/download/${debFile}`,
  },
};
