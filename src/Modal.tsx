import { useEffect, useId, useRef, type ReactNode } from "react";
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
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
