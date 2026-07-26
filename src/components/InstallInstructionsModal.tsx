import { useEffect, useRef } from "react";
import { X, Share, Plus } from "lucide-react";

const DISMISSED_KEY = "bw-ios-install-dismissed-v1";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function shouldShow(): boolean {
  if (!isIOS() || isStandalone()) return false;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === null;
  } catch {
    return true;
  }
}

export default function InstallInstructionsModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!shouldShow()) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  const close = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    } catch {
      // localStorage may be disabled — non-fatal
    }
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) close();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onClick={onBackdropClick}
      className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-0 backdrop:bg-[#3b2f2a]/50"
    >
      <div className="border-border flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-display text-base font-bold">Install BitWorth</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-foreground/60 hover:bg-accent hover:text-foreground rounded-sm p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="space-y-4 px-5 py-5 text-sm">
        <li className="flex items-start gap-3">
          <Share className="text-primary mt-0.5 size-5 shrink-0" />
          <span>
            Tap the <strong>Share</strong> button in Safari&rsquo;s bottom bar.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Plus className="text-primary mt-0.5 size-5 shrink-0" />
          <span>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="number-chip mt-0.5">3</span>
          <span>
            Tap <strong>Add</strong> in the top right.
          </span>
        </li>
      </ol>
      <div className="border-border flex justify-end border-t px-5 py-3">
        <button
          type="button"
          onClick={close}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-4 py-1.5 text-sm font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </dialog>
  );
}
