import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import { TAG_NAME_MAX, compareTagNames, validateTagName } from "@/lib/tags";

export interface ManagedTag {
  id: string;
  name: string;
  show_on_dashboard: boolean;
}

interface Props {
  initialTags: ManagedTag[];
}

interface ApiResult<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { error: { code: "NETWORK", message: "Network error. Please try again." } };
  }
}

function sorted(tags: ManagedTag[]): ManagedTag[] {
  return [...tags].sort(compareTagNames);
}

// Settings → Tags: create, rename and delete tags, and the per-tag "show chart
// on dashboard" toggle. Every change is saved immediately through /api/tags and
// the list is updated from the server's answer, so no page reload is needed.
export function TagsManager({ initialTags }: Props) {
  const [tags, setTags] = useState<ManagedTag[]>(() => sorted(initialTags));
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = validateTagName(newName);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await call<ManagedTag>("/api/tags", "POST", { name: checked.name });
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not create the tag.");
      return;
    }
    const created = result.data;
    setTags((prev) => sorted([...prev, created]));
    setNewName("");
  }

  async function patch(id: string, body: Partial<Pick<ManagedTag, "name" | "show_on_dashboard">>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await call<ManagedTag>(`/api/tags/${id}`, "PATCH", body);
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not update the tag.");
      return false;
    }
    const updated = result.data;
    setTags((prev) => sorted(prev.map((t) => (t.id === id ? updated : t))));
    return true;
  }

  async function handleRename(id: string) {
    const checked = validateTagName(editName);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (await patch(id, { name: checked.name })) setEditingId(null);
  }

  async function handleDelete(tag: ManagedTag) {
    if (!confirm(`Delete the tag "${tag.name}"? It is removed from every asset.`)) return;
    setBusy(true);
    setError(null);
    const result = await call<{ id: string }>(`/api/tags/${tag.id}`, "DELETE");
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
  }

  return (
    <div className="space-y-4">
      <ServerError message={error} />

      <form onSubmit={handleCreate} noValidate className="flex gap-2">
        <label htmlFor="new_tag_name" className="sr-only">
          New tag name
        </label>
        <input
          id="new_tag_name"
          type="text"
          value={newName}
          maxLength={TAG_NAME_MAX * 2}
          onChange={(e) => {
            setNewName(e.target.value);
          }}
          placeholder="e.g. Long term"
          className="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-primary min-w-0 flex-1 rounded-sm border px-3 py-2 transition-colors focus:outline-none"
        />
        <Button type="submit" disabled={busy || newName.trim().length === 0} className="rounded-sm">
          <Plus className="size-4" />
          Add tag
        </Button>
      </form>

      {tags.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tags yet. Tags you create can be added to any asset.</p>
      ) : (
        <ul className="divide-border border-border divide-y rounded-sm border">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              {editingId === tag.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <label htmlFor={`rename_${tag.id}`} className="sr-only">
                    New name for {tag.name}
                  </label>
                  <input
                    id={`rename_${tag.id}`}
                    type="text"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRename(tag.id);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="border-input bg-card text-foreground focus:border-primary min-w-0 flex-1 rounded-sm border px-2 py-1 text-sm transition-colors focus:outline-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    aria-label={`Save name for ${tag.name}`}
                    onClick={() => {
                      void handleRename(tag.id);
                    }}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Cancel rename"
                    onClick={() => {
                      setEditingId(null);
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
              )}

              <label className="text-foreground/70 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={tag.show_on_dashboard}
                  disabled={busy}
                  onChange={(e) => {
                    void patch(tag.id, { show_on_dashboard: e.target.checked });
                  }}
                  className="accent-primary size-4"
                />
                Show chart on dashboard
              </label>

              {editingId !== tag.id && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditName(tag.name);
                      setError(null);
                    }}
                    aria-label={`Rename ${tag.name}`}
                    className="text-primary dark:text-foreground flex items-center gap-1 text-sm transition-colors hover:underline"
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </button>
                  <span className="text-border">|</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void handleDelete(tag);
                    }}
                    aria-label={`Delete ${tag.name}`}
                    className="text-destructive flex items-center gap-1 text-sm transition-colors hover:underline"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
