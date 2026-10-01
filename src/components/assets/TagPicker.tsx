import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TagChip } from "@/lib/tags";

interface Props {
  tags: readonly TagChip[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

// Pick any number of the user's tags for an asset. Each tag is a toggle button
// (aria-pressed) built on the shared Button, so it needs no new dependency and
// works the same with a pointer, a keyboard and a screen reader.
export function TagPicker({ tags, selected, onChange }: Props) {
  const chosen = new Set(selected);

  function toggle(id: string) {
    onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <fieldset>
      <legend className="text-foreground/70 mb-1 block text-sm">
        Tags <span className="text-muted-foreground">(optional)</span>
      </legend>
      {tags.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No tags yet. Create them in{" "}
          <a href="/dashboard/settings" className="text-primary dark:text-foreground hover:underline">
            Settings
          </a>
          .
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const on = chosen.has(tag.id);
            return (
              <Button
                key={tag.id}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                onClick={() => {
                  toggle(tag.id);
                }}
                className="rounded-sm"
              >
                {on && <Check className="size-3.5" />}
                {tag.name}
              </Button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
