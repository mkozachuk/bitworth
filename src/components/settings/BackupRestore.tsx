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
      // `anchor.download` wins over the server's Content-Disposition for blob
      // URLs, so the yyyy-MM-dd prefix is rebuilt here from the local date.
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      anchor.download = `${stamp}-bitworth-export.json`;
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
      const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
      if (!res.ok || json?.error) {
        setError(json?.error?.message ?? "Import failed. Please try again.");
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
        <h3 className="font-display text-foreground text-sm font-bold">Export</h3>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">
          Download a single JSON file containing all your preferences, assets, snapshots, and snapshot items.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-sm px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <>
              <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
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

      <hr className="border-border" />

      <section>
        <h3 className="font-display text-foreground text-sm font-bold">Import</h3>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">Restore data from a previously exported backup file.</p>

        <input
          type="file"
          accept="application/json"
          aria-label="Backup file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="text-foreground/70 file:bg-secondary file:text-secondary-foreground hover:file:bg-kraft/60 block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium"
        />

        <fieldset className="mt-4">
          <legend className="text-foreground/70 mb-2 block text-sm">Import mode</legend>
          <div className="space-y-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors ${
                mode === "merge" ? "border-primary bg-card" : "border-border bg-card hover:border-primary/50"
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
                className="accent-primary mt-1 size-4 cursor-pointer"
              />
              <span>
                <span className="text-foreground block text-sm font-medium">Merge</span>
                <span className="text-muted-foreground block text-xs">
                  Append the file&rsquo;s data alongside your existing data.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors ${
                mode === "replace" ? "border-primary bg-card" : "border-border bg-card hover:border-primary/50"
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
                className="accent-primary mt-1 size-4 cursor-pointer"
              />
              <span>
                <span className="text-foreground block text-sm font-medium">Replace all</span>
                <span className="text-muted-foreground block text-xs">
                  Delete your current assets and snapshots, then restore from the file.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {mode === "merge" && (
          <p className="border-kraft bg-kraft/40 text-foreground/80 mt-3 flex items-center gap-2 rounded-sm border px-3 py-2 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            Merge appends a copy of the file&rsquo;s data — importing the same file twice creates duplicates.
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            onClick={handleImportClick}
            disabled={!file || importing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-sm px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? (
              <>
                <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
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
        className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-0 backdrop:bg-[#3b2f2a]/50"
      >
        <div className="border-border border-b px-5 py-3">
          <h2 className="font-display text-base font-bold">Replace all data?</h2>
        </div>
        <p className="max-w-sm px-5 py-5 text-sm">
          This permanently deletes your current assets and snapshots, then restores everything from the selected file.
          This cannot be undone.
        </p>
        <div className="border-border flex justify-end gap-3 border-t px-5 py-3">
          <button
            type="button"
            onClick={cancelReplace}
            className="border-primary text-primary hover:bg-primary/8 rounded-sm border-[1.5px] px-4 py-1.5 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmReplace}
            className="border-destructive text-destructive hover:bg-destructive hover:text-background rounded-sm border-[1.5px] px-4 py-1.5 text-sm font-medium transition-colors"
          >
            Replace all
          </button>
        </div>
      </dialog>
    </div>
  );
}
