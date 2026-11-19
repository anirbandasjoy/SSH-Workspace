"use client";

import Image, { type StaticImageData } from "next/image";
import { useId, useState } from "react";
import styles from "../page.module.css";

export interface Slide {
  id: string;
  label: string;
  title: string;
  body: string;
  image: StaticImageData;
  alt: string;
}

export function ScreenshotTour({ slides }: { slides: Slide[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const slide = slides[active]!;
  return (
    <div className={styles.tour}>
      <div
        className={styles.tourTabs}
        role="tablist"
        aria-label="Product tour"
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = (active + step + slides.length) % slides.length;
          setActive(next);
          document.getElementById(`${base}-tab-${next}`)?.focus();
        }}
      >
        {slides.map((s, i) => (
          <button
            key={s.id}
            id={`${base}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            className={styles.tourTab}
            onClick={() => setActive(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${active}`}
        className={styles.tourPanel}
      >
        <div className={styles.tourCopy}>
          <h3>{slide.title}</h3>
          <p>{slide.body}</p>
        </div>
        <div className={styles.window}>
          <div className={styles.windowBar} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <Image
            key={slide.id}
            src={slide.image}
            alt={slide.alt}
            sizes="(max-width: 1100px) 100vw, 1040px"
            placeholder="blur"
            className={styles.windowImage}
          />
        </div>
      </div>
    </div>
  );
}
