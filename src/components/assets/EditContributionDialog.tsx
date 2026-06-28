import { useState, useEffect, useCallback, useRef } from "react";
import { ContributionField } from "./ContributionField";
import type { Currency } from "@/lib/net-worth";

/**
 * Controlled per-snapshot "edit contribution" dialog.
 *
 * Prop contract (driven by a parent, e.g. the Phase 6 chart — one edit action
 * per interval/bar). The parent owns the open state and re-targets this single
 * dialog per interval:
 *
 *   - `open`            — whether the dialog is shown (parent-controlled).
 *   - `id`             — the target snapshot id to PATCH. An interval is the
 *                         pair `(prev, curr)`; the contribution belongs to
 *                         `curr` (money added since `prev`), so the parent
 *                         passes `curr.id` here.
 *   - `netContribution` — the snapshot's current value to pre-fill (number) or
 *                         `null` (blank = unknown split).
 *   - `displayCurrency` — currency shown in the field helper line.
 *   - `dateLabel`      — human-readable date of `curr`, used in the title so
 *                         the user knows which snapshot is being edited.
 *   - `onClose`        — called when the dialog should close (cancel / backdrop
 *                         click / native close). Parent flips `open` to false.
 *   - `onSaved`        — called after a successful PATCH; the parent decides
 *                         whether to reload or refetch.
 *
 * Native `<dialog>` + showModal()/close() (mirrors Phase 4's SaveButton — no
 * Radix). Blank field ↔ explicit `null` in the PATCH body; a filled field ↔ a
 * finite signed number. NaN is guarded client-side.
 */
export interface EditContributionDialogProps {
  open: boolean;
  id: string;
  netContribution: number | null;
  displayCurrency: Currency;
  dateLabel: string;
  onClose: () => void;
  onSaved: () => void;
}

type DialogState = "idle" | "loading" | "error";

function toFieldValue(netContribution: number | null): string {
  return netContribution === null ? "" : String(netContribution);
}

// The form is a child of the <dialog> and is only mounted while `open`. Because
// it unmounts on close, every open is a fresh mount, so the field can pre-fill
// from `netContribution` via a lazy useState initializer — no setState in an
// effect (react-hooks/set-state-in-effect) or during render.
function EditContributionForm({
  id,
  netContribution,
  displayCurrency,
  dateLabel,
  onClose,
  onSaved,
}: Omit<EditContributionDialogProps, "open">) {
  const [state, setState] = useState<DialogState>("idle");
  const [contribution, setContribution] = useState(() => toFieldValue(netContribution));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (state === "loading") return;

    // Map the field to the PATCH body: a blank field clears the value back to
    // unknown (explicit null); a filled field sends a parsed signed number.
    // Guard NaN client-side so we never send a non-finite number.
    const trimmed = contribution.trim();
    let netContributionPayload: number | null;
    if (trimmed === "") {
      netContributionPayload = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setState("error");
        setErrorMessage("Net contribution must be a number");
        return;
      }
      netContributionPayload = parsed;
    }

    setState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/snapshots/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ net_contribution: netContributionPayload }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      setErrorMessage(msg);
    }
  }, [state, contribution, id, onSaved]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
        <h2 className="text-base font-semibold">Edit contribution</h2>
      </div>
      <div className="px-5 py-5">
        <p className="mb-4 text-sm text-zinc-600 dark:text-white/60">
          Contribution recorded for <span className="font-medium text-zinc-900 dark:text-white">{dateLabel}</span>
        </p>
        <ContributionField
          id="edit-net-contribution"
          value={contribution}
          onChange={setContribution}
          currency={displayCurrency}
          disabled={state === "loading"}
        />
        {state === "error" && errorMessage && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">{errorMessage}</p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-white/10">
        <button
          type="button"
          onClick={onClose}
          disabled={state === "loading"}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={state === "loading"}
          className="flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/50"
        >
          {state === "loading" ? (
            <>
              <svg
                className="h-4 w-4 animate-spin text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </>
  );
}

export function EditContributionDialog({ open, onClose, ...formProps }: EditContributionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // DOM sync only: open/close the native <dialog> to match the `open` prop.
  // showModal()/close() are imperative DOM calls, so they live in an effect —
  // never render (mirrors Phase 4's react-compiler-safe ref usage).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="w-[min(92vw,28rem)] rounded-2xl border border-zinc-200 bg-white/95 p-0 text-zinc-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100"
    >
      {open && <EditContributionForm onClose={onClose} {...formProps} />}
    </dialog>
  );
}
