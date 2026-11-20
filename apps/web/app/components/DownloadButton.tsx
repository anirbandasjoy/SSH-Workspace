"use client";

import { DownloadIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import type { Download, Platform } from "../site";

type Choice = { platform: Platform; name: string; file: Download };
type UAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

async function detect(): Promise<{ platform: Platform; intel: boolean } | null> {
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (/android|iphone|ipad/.test(hint)) return null;
  if (hint.includes("win")) return { platform: "windows", intel: true };
  if (hint.includes("mac")) {
    // Browsers report "Intel" on every Mac; only Chromium can tell the CPU apart.
    let intel = false;
    try {
      const values = await nav.userAgentData?.getHighEntropyValues?.(["architecture"]);
      intel = values?.architecture === "x86";
    } catch {
      intel = false;
    }
    return { platform: "mac", intel };
  }
  if (hint.includes("linux") || hint.includes("x11")) return { platform: "linux", intel: true };
  return null;
}

export function DownloadButton({
  downloads,
  className,
}: {
  downloads: Record<Platform, { name: string; files: Download[] }>;
  className: string;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    let active = true;
    void detect().then((found) => {
      if (!active || !found) return;
      const group = downloads[found.platform];
      const file =
        found.platform === "mac" && found.intel ? group.files[1]! : group.files[0]!;
      setChoice({ platform: found.platform, name: group.name, file });
    });
    return () => {
      active = false;
    };
  }, [downloads]);

  return (
    <a
      className={className}
      href={choice ? choice.file.url : "#download"}
      title={choice ? `${choice.file.label} · ${choice.file.detail}` : undefined}
    >
      <DownloadIcon size={20} />
      {choice ? `Download for ${choice.name}` : "Download Vexo"}
    </a>
  );
}
