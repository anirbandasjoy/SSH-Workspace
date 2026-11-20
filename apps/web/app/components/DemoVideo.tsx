"use client";

import { PlayIcon } from "@primer/octicons-react";
import { MediaPlayer, MediaProvider, PlayButton, Poster } from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import styles from "../page.module.css";

// Vidstack player. The video is only fetched when someone presses play.
export function DemoVideo({ src, poster }: { src: string; poster: string }) {
  return (
    <div className={`${styles.window} ${styles.demo}`}>
      <div className={styles.windowBar} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <MediaPlayer
        className={styles.vidstack}
        title="Vexo demo: install and use Vexo"
        src={{ src, type: "video/mp4" }}
        viewType="video"
        streamType="on-demand"
        load="visible"
        preload="none"
        posterLoad="eager"
        playsInline
      >
        <MediaProvider>
          <Poster
            className="vds-poster"
            src={poster}
            alt="Vexo: every GitHub account, the right key, every time"
          />
        </MediaProvider>
        <PlayButton className={styles.bigPlay} aria-label="Play the Vexo demo video">
          <PlayIcon size={44} />
        </PlayButton>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    </div>
  );
}
