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
      <div className="border-border flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-display text-base font-bold">Edit contribution</h2>
      </div>
      <div className="px-5 py-5">
        <p className="text-foreground/70 mb-4 text-sm">
          Contribution recorded for <span className="text-foreground font-medium">{dateLabel}</span>
        </p>
        <ContributionField
          id="edit-net-contribution"
          value={contribution}
          onChange={setContribution}
          currency={displayCurrency}
          disabled={state === "loading"}
        />
        {state === "error" && errorMessage && <p className="text-destructive mt-3 text-xs">{errorMessage}</p>}
      </div>
      <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={state === "loading"}
          className="border-primary text-primary hover:bg-primary/8 rounded-sm border-[1.5px] px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={state === "loading"}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
        >
          {state === "loading" ? (
            <>
              <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
      className="bg-card text-card-foreground border-border shadow-paper w-[min(92vw,28rem)] rounded-md border p-0 backdrop:bg-[#3b2f2a]/50"
    >
      {open && <EditContributionForm onClose={onClose} {...formProps} />}
    </dialog>
  );
}
