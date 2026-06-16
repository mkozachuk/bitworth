// asset_categories.icon stores Lucide icon *names* (see supabase/seed.sql). Native
// <select> options can't render SVG, so we map those names to emoji and use the same
// glyphs everywhere (dropdown + asset list) for a consistent look.
const CATEGORY_EMOJI: Record<string, string> = {
  wallet: "👛",
  "piggy-bank": "🐖",
  briefcase: "💼",
  banknote: "💵",
  "trending-up": "📈",
  "bar-chart-2": "📊",
  shield: "🛡️",
  bitcoin: "₿",
  gem: "💎",
  home: "🏠",
  car: "🚗",
  "credit-card": "💳",
  "hand-coins": "🤝",
};

/** Emoji for a category icon name, or "" when the name is unknown/null. */
export function categoryEmoji(iconName: string | null): string {
  if (!iconName) return "";
  return CATEGORY_EMOJI[iconName] ?? "";
}
