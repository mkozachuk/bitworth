import type { ComponentType } from "react";
import {
  Wallet,
  PiggyBank,
  Briefcase,
  Banknote,
  TrendingUp,
  BarChart2,
  Shield,
  Bitcoin,
  Gem,
  Home,
  Car,
  CreditCard,
  HandCoins,
} from "lucide-react";

// asset_categories.icon stores Lucide icon *names* (see supabase/seed.sql).
// Render them as single-ink line art (The One Ink Rule) — never emoji, whose
// platform colors break the world. Native <select> options can't render SVG,
// so dropdowns show the plain category name instead.
const CATEGORY_ICONS: Record<string, ComponentType<{ className?: string; strokeWidth?: number }> | undefined> = {
  wallet: Wallet,
  "piggy-bank": PiggyBank,
  briefcase: Briefcase,
  banknote: Banknote,
  "trending-up": TrendingUp,
  "bar-chart-2": BarChart2,
  shield: Shield,
  bitcoin: Bitcoin,
  gem: Gem,
  home: Home,
  car: Car,
  "credit-card": CreditCard,
  "hand-coins": HandCoins,
};

/** Single-ink Lucide glyph for a category icon name; renders nothing when unknown/null. */
export function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  if (!name) return null;
  const Icon = CATEGORY_ICONS[name];
  if (!Icon) return null;
  return <Icon className={className ?? "inline size-4 shrink-0"} strokeWidth={1.75} aria-hidden />;
}
