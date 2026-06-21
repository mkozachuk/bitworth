import { useRef, useState } from "react";
import { Download, Upload, TriangleAlert } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";

type Mode = "replace" | "merge";

export function BackupRestore() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("merge");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function handleExport() {
    setError(null);
    setExporting(true);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        setError(json?.error?.message ?? "Export failed. Please try again.");
        setExporting(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bitworth-backup.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    setImporting(true);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("The selected file is not valid JSON.");
      setImporting(false);
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      setError("The selected file is not a valid backup.");
      setImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(parsed as Record<string, unknown>), mode }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (json.error) {
        setError(json.error.message);
        setImporting(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
      setImporting(false);
    }
  }

  function handleImportClick() {
    if (!file) return;
    setError(null);
    if (mode === "replace") {
      dialogRef.current?.showModal();
      return;
    }
    void runImport();
  }

  function confirmReplace() {
    dialogRef.current?.close();
    void runImport();
  }

  function cancelReplace() {
    dialogRef.current?.close();
  }

  return (
    <div className="space-y-6">
      <ServerError message={error} />

      <section>
        <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Export</h3>
        <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-white/40">
          Download a single JSON file containing all your preferences, assets, snapshots, and snapshot items.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="size-4" />
              Export backup
            </>
          )}
        </button>
      </section>

      <hr className="border-zinc-200 dark:border-white/10" />

      <section>
        <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Import</h3>
        <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-white/40">
          Restore data from a previously exported backup file.
        </p>

        <input
          type="file"
          accept="application/json"
          aria-label="Backup file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:text-white/70 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/20"
        />

        <fieldset className="mt-4">
          <legend className="mb-2 block text-sm text-zinc-700 dark:text-blue-100/80">Import mode</legend>
          <div className="space-y-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "merge"
                  ? "border-purple-500 bg-purple-50 dark:border-purple-400/60 dark:bg-purple-900/20"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="import_mode"
                value="merge"
                checked={mode === "merge"}
                onChange={() => {
                  setMode("merge");
                }}
                className="mt-1 size-4 cursor-pointer accent-purple-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-900 dark:text-white">Merge</span>
                <span className="block text-xs text-zinc-500 dark:text-white/50">
                  Append the file&rsquo;s data alongside your existing data.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mode === "replace"
                  ? "border-purple-500 bg-purple-50 dark:border-purple-400/60 dark:bg-purple-900/20"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="import_mode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => {
                  setMode("replace");
                }}
                className="mt-1 size-4 cursor-pointer accent-purple-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-900 dark:text-white">Replace all</span>
                <span className="block text-xs text-zinc-500 dark:text-white/50">
                  Delete your current assets and snapshots, then restore from the file.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {mode === "merge" && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <TriangleAlert className="size-4 shrink-0" />
            Merge appends a copy of the file&rsquo;s data — importing the same file twice creates duplicates.
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            onClick={handleImportClick}
            disabled={!file || importing}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="size-4" />
                Import backup
              </>
            )}
          </button>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        onClose={cancelReplace}
        className="rounded-2xl border border-zinc-200 bg-white/95 p-0 text-zinc-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100"
      >
        <div className="border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Replace all data?</h2>
        </div>
        <p className="max-w-sm px-5 py-5 text-sm">
          This permanently deletes your current assets and snapshots, then restores everything from the selected file.
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={cancelReplace}
            className="rounded-md px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmReplace}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            Replace all
          </button>
        </div>
      </dialog>
    </div>
  );
}
