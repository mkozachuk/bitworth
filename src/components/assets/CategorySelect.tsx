import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { categoryEmoji } from "@/lib/category-icons";

interface Props {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}

type Category = Tables<"asset_categories">;

export function CategorySelect({ value, onChange, error }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/categories")
      .then((r) => r.json())
      .then((json: { data?: Category[]; error?: unknown }) => {
        if (json.data) setCategories(json.data);
        else if (json.error) setFetchError("Failed to load categories");
      })
      .catch(() => {
        setFetchError("Failed to load categories");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const assets = categories.filter((c) => !c.is_liability);
  const liabilities = categories.filter((c) => c.is_liability);

  return (
    <div>
      <label htmlFor="category_id" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
        Category
      </label>
      {loading ? (
        <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-200 dark:bg-white/5" />
      ) : (
        <div className="relative">
          <select
            id="category_id"
            name="category_id"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className="w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white dark:placeholder-white/40"
            style={
              error
                ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
                : { borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
            }
          >
            <option value="">Select a category</option>
            {assets.length > 0 && (
              <optgroup label="Assets">
                {assets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[categoryEmoji(c.icon), c.name].filter(Boolean).join(" ")}
                  </option>
                ))}
              </optgroup>
            )}
            {liabilities.length > 0 && (
              <optgroup label="Liabilities">
                {liabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[categoryEmoji(c.icon), c.name].filter(Boolean).join(" ")}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-500 dark:text-white/40">
            ▼
          </span>
        </div>
      )}
      {fetchError && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {fetchError}
        </p>
      )}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
