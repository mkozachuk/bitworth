import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Tables } from "@/lib/database.types";

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
      <label htmlFor="category_id" className="text-foreground/70 mb-1 block text-sm">
        Category
      </label>
      {loading ? (
        <div className="bg-muted h-10 w-full animate-pulse rounded-sm" />
      ) : (
        <div className="relative">
          <select
            id="category_id"
            name="category_id"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className={`bg-card text-foreground focus:border-primary w-full appearance-none rounded-sm border px-3 py-2 pr-8 transition-colors focus:outline-none ${
              error ? "border-destructive" : "border-input"
            }`}
          >
            <option value="">Select a category</option>
            {assets.length > 0 && (
              <optgroup label="Assets">
                {assets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {liabilities.length > 0 && (
              <optgroup label="Liabilities">
                {liabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
            ▼
          </span>
        </div>
      )}
      {fetchError && (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {fetchError}
        </p>
      )}
      {error ? (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
