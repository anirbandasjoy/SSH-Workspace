"use client";

import { PlayIcon } from "@primer/octicons-react";
import { useRef, useState } from "react";
import styles from "../page.module.css";

// Click-to-play so the 11 MB video is only fetched when someone asks for it.
export function DemoVideo({ src, poster }: { src: string; poster: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  return (
    <div className={`${styles.window} ${styles.demo}`}>
      <div className={styles.windowBar} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={styles.demoStage}>
        <video
          ref={video}
          className={styles.demoVideo}
          src={src}
          poster={poster}
          controls={started}
          preload="none"
          playsInline
          aria-label="Vexo demo: install and use Vexo on macOS, Windows and Linux"
          onEnded={() => setStarted(false)}
        />
        {!started && (
          <button
            type="button"
            className={styles.demoPlay}
            aria-label="Play the Vexo demo video"
            onClick={() => {
              setStarted(true);
              void video.current?.play();
            }}
          >
            <span>
              <PlayIcon size={44} />
            </span>
            <small>Watch demo · 0:36</small>
          </button>
        )}
      </div>
    </div>
  );
}
