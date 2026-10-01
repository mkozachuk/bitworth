import type { TagChip } from "@/lib/tags";

interface Props {
  tags?: readonly TagChip[];
  className?: string;
}

// An asset's tags as small chips. Names render as React text nodes, so a tag
// called "<b>x</b>" shows those characters and is never parsed as markup.
export function TagChips({ tags, className = "" }: Props) {
  if (!tags || tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((tag) => (
        <li
          key={tag.id}
          className="border-foreground/15 text-foreground/70 bg-kraft/30 inline-flex max-w-full items-center truncate rounded-sm border px-1.5 py-0.5 text-[11px] leading-none"
        >
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
