import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { XIcon } from "@primer/octicons-react";
import "./management.css";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}

export default function Modal({
  title,
  onClose,
  children,
  busy = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  // Capture the opener during the first render, before React applies autoFocus
  // to a field inside the dialog.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // Fields inside a closed dialog cannot take focus, so React's autoFocus
    // has no effect and showModal() focuses the close button. Move focus to
    // the first editable field so typing and Enter work immediately.
    dialog
      .querySelector<HTMLElement>(
        ".mw-dialog-body :is(input, select, textarea):not([readonly]):not([disabled])",
      )
      ?.focus();
    return () => {
      dialog.close();
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !document.querySelector("dialog[open]")
      )
        opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="mw-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="mw-dialog-head">
        <h2 id={heading}>{title}</h2>
        <button
          type="button"
          className="mw-icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <XIcon size={18} />
        </button>
      </header>
      <div className="mw-dialog-body">{children}</div>
    </dialog>
  );
}
