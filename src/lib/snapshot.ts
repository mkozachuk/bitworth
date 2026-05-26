import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { computeNetWorth, type Currency } from "@/lib/net-worth";

export interface SnapshotResult {
  id: string;
  total_net_worth: number;
  currency: Currency;
  snapshot_date: string;
}

export async function saveSnapshot(
  db: SupabaseClient<Database>,
  userId: string,
  displayCurrency: Currency = "PLN",
): Promise<SnapshotResult> {
  // Supabase generic types are complex; using explicit casts to satisfy TS

  const { data: assets, error: assetsErr } = (await db.from("assets").select("*").eq("user_id", userId)) as {
    data: unknown;
    error: unknown;
  };

  if (assetsErr) throw new Error(`Failed to fetch assets: ${(assetsErr as { message: string }).message}`);
  if (!assets) throw new Error("No assets returned");

  const { data: rates, error: ratesErr } = (await db.from("exchange_rates").select("*")) as {
    data: unknown;
    error: unknown;
  };

  if (ratesErr) throw new Error(`Failed to fetch exchange rates: ${(ratesErr as { message: string }).message}`);
  if (!rates) throw new Error("No exchange rates returned");

  const netWorth = computeNetWorth(
    assets as Parameters<typeof computeNetWorth>[0],
    rates as Parameters<typeof computeNetWorth>[1],
    displayCurrency,
  );

  const today = new Date().toISOString().split("T")[0];

  const { data: snapshot, error: snapshotErr } = (await db
    .from("snapshots")
    .insert({
      user_id: userId,
      total_net_worth: netWorth.total,
      currency: displayCurrency,
      snapshot_date: today,
    })
    .select()
    .single()) as { data: unknown; error: unknown };

  if (snapshotErr) throw new Error(`Failed to save snapshot: ${(snapshotErr as { message: string }).message}`);

  const snapshotData = snapshot as { id: string; total_net_worth: number; currency: string; snapshot_date: string };
  return {
    id: snapshotData.id,
    total_net_worth: snapshotData.total_net_worth,
    currency: snapshotData.currency as Currency,
    snapshot_date: snapshotData.snapshot_date,
  };
}
