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
      className="rounded-2xl border border-zinc-200 bg-white/95 p-0 text-zinc-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
        <h2 className="text-base font-semibold">Install BitWorth</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="space-y-4 px-5 py-5 text-sm">
        <li className="flex items-start gap-3">
          <Share className="mt-0.5 size-5 shrink-0 text-purple-600 dark:text-purple-300" />
          <span>
            Tap the <strong>Share</strong> button in Safari&rsquo;s bottom bar.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Plus className="mt-0.5 size-5 shrink-0 text-purple-600 dark:text-purple-300" />
          <span>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-semibold text-white dark:bg-purple-400 dark:text-zinc-900">
            3
          </span>
          <span>
            Tap <strong>Add</strong> in the top right.
          </span>
        </li>
      </ol>
      <div className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-white/10">
        <button
          type="button"
          onClick={close}
          className="rounded-md bg-purple-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 dark:bg-purple-400 dark:text-zinc-900 dark:hover:bg-purple-300"
        >
          Got it
        </button>
      </div>
    </dialog>
  );
}
