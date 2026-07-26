import { useState } from "react";
import { Inbox, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { convertAmount, type Currency } from "@/lib/net-worth";

// One goal exactly as `/api/goals` projects it. `user_id` is deliberately absent
// from that projection, so the island never holds the tenant key. Mirrors
// `GOAL_SELECT` in src/pages/api/goals/index.ts — keep the two in step.
export interface GoalRow {
  id: string;
  name: string;
  kind: string;
  category_id: string | null;
  target_amount: number;
  target_currency: string;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

// The seeded, globally-shared category list, fetched server-side by the page so
// the picker needs no client round-trip (unlike assets' CategorySelect).
export interface GoalCategory {
  id: string;
  name: string;
  icon: string | null;
}

interface Props {
  goals: GoalRow[];
  categories: GoalCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

// Currencies a target can be denominated in. Deliberately a fourth local copy of
// the list (AssetForm, BalancerView, SettingsForm each carry their own) — this
// repo has no shared form primitives and does not want one.
const CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

const KINDS: { value: string; label: string }[] = [
  { value: "net_worth", label: "Total net worth" },
  { value: "category", label: "One asset category" },
];

// Money in whatever currency it is denominated in: two decimals + the code,
// matching the inline toLocaleString convention used across the asset rows.
const money = (value: number, currency: string): string =>
  `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const kindLabel = (kind: string): string => KINDS.find((k) => k.value === kind)?.label ?? kind;

export function GoalsManager({ goals: initialGoals, categories, displayCurrency, rates }: Props) {
  // Seeded from the server render, then updated from each API response — no
  // window.location.reload() anywhere on this page.
  const [goals, setGoals] = useState<GoalRow[]>(initialGoals);
  // null while creating; the goal's id while editing. `formOpen` is separate so
  // the create form can be closed without implying an edit target.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("net_worth");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(displayCurrency);
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function openCreate() {
    setEditingId(null);
    setName("");
    setKind("net_worth");
    setCategoryId("");
    setAmount("");
    setCurrency(displayCurrency);
    setTargetDate("");
    setError(null);
    setFormOpen(true);
  }

  function openEdit(goal: GoalRow) {
    setEditingId(goal.id);
    setName(goal.name);
    setKind(goal.kind);
    setCategoryId(goal.category_id ?? "");
    setAmount(String(goal.target_amount));
    setCurrency(goal.target_currency as Currency);
    setTargetDate(goal.target_date ?? "");
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setError(null);
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    // Validation lives in the API (one rule set, not two) — the empty amount is
    // sent as null so the server answers with its own "must be a finite number"
    // rather than the island inventing a second wording.
    const payload = {
      name,
      kind,
      category_id: kind === "category" ? categoryId : null,
      target_amount: amount.trim() === "" ? null : Number(amount),
      target_currency: currency,
      target_date: targetDate === "" ? null : targetDate,
    };

    const endpoint = editingId === null ? "/api/goals" : `/api/goals/${editingId}`;
    const method = editingId === null ? "POST" : "PATCH";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { data?: GoalRow; error?: { message: string } };

      if (json.error || !json.data) {
        setError(json.error?.message ?? "Saving the goal failed.");
        setPending(false);
        return;
      }

      const saved = json.data;
      setGoals((prev) => (editingId === null ? [...prev, saved] : prev.map((g) => (g.id === saved.id ? saved : g))));
      closeForm();
      setPending(false);
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  async function handleDelete(goal: GoalRow) {
    if (!window.confirm(`Delete "${goal.name}"? This cannot be undone.`)) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: { message: string } };

      if (json.error) {
        setError(json.error.message);
        setPending(false);
        return;
      }

      setGoals((prev) => prev.filter((g) => g.id !== goal.id));
      if (editingId === goal.id) closeForm();
      setPending(false);
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  // Unknown ids fall back to the raw id rather than an empty cell — a goal whose
  // category vanished should still be identifiable.
  function categoryLabel(id: string | null): string {
    if (id === null) return "—";
    const found = categories.find((c) => c.id === id);
    if (!found) return id;
    return found.name;
  }

  // The target in the display currency, shown as a secondary line whenever the
  // goal is denominated in something else. Cast at the boundary per the Currency
  // cast lesson — the column is TEXT, the CHECK constraint pins the three values.
  function targetInDisplay(goal: GoalRow): string | null {
    if (goal.target_currency === displayCurrency) return null;
    return money(
      convertAmount(goal.target_amount, goal.target_currency as Currency, displayCurrency, rates),
      displayCurrency,
    );
  }

  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none";
  const labelClass = "mb-1 block text-sm text-foreground/70";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Your goals</h2>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            Add goal
          </button>
        )}
      </div>

      {/* Inline create/edit form above the list — no dialog primitive exists in
        this repo and a native <dialog> would be a second interaction model on
        the same page. */}
      {formOpen && (
        <form onSubmit={handleSubmit} noValidate className="border-border bg-card mb-6 space-y-4 rounded-md border p-4">
          <h3 className="font-display text-foreground text-sm font-bold">
            {editingId === null ? "New goal" : "Edit goal"}
          </h3>

          <div>
            <label htmlFor="goal-name" className={labelClass}>
              Name
            </label>
            <input
              id="goal-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={60}
              placeholder="e.g. Emergency fund"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="goal-kind" className={labelClass}>
                Measured against
              </label>
              <select
                id="goal-kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                }}
                className={`${inputClass} appearance-none`}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>

            {kind === "category" && (
              <div>
                <label htmlFor="goal-category" className={labelClass}>
                  Category
                </label>
                <select
                  id="goal-category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                  }}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="">Select a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="goal-amount" className={labelClass}>
                Target amount
              </label>
              <input
                id="goal-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
                placeholder="0.00"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="goal-currency" className={labelClass}>
                Currency
              </label>
              <select
                id="goal-currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value as Currency);
                }}
                className={`${inputClass} appearance-none`}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="goal-target-date" className={labelClass}>
                Target date (optional)
              </label>
              <input
                id="goal-target-date"
                type="date"
                value={targetDate}
                onChange={(e) => {
                  setTargetDate(e.target.value);
                }}
                className={inputClass}
              />
            </div>
          </div>

          <ServerError message={error} />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {editingId === null ? "Create goal" : "Save changes"}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="border-primary text-primary hover:bg-primary/8 flex items-center gap-1.5 rounded-sm border-[1.5px] px-4 py-2 text-sm transition-colors"
            >
              <X className="size-4" />
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* List-level errors (delete failures) render here; form errors render
        inside the form above. */}
      {!formOpen && <ServerError message={error} />}

      {goals.length === 0 ? (
        <div className="border-kraft flex flex-col items-center justify-center rounded-md border-2 border-dashed py-16 text-center">
          <Inbox className="text-ink-faint mb-3 size-10" />
          <p className="text-foreground/70">No goals yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add your first savings goal to track it on your dashboard
          </p>
        </div>
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="text-foreground/60 text-left text-xs tracking-[0.12em] uppercase">
                  <th className="pr-4 pb-3 font-bold">Name</th>
                  <th className="pr-4 pb-3 font-bold">Target</th>
                  <th className="pr-4 pb-3 font-bold">Measured against</th>
                  <th className="pr-4 pb-3 font-bold">Target date</th>
                  <th className="pb-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal) => {
                  const converted = targetInDisplay(goal);
                  return (
                    <tr key={goal.id} className="border-border border-b last:border-0">
                      <td className="py-3 pr-4">
                        <span className="text-foreground font-medium">{goal.name}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-foreground tnum">{money(goal.target_amount, goal.target_currency)}</span>
                        {converted && <p className="text-muted-foreground tnum mt-0.5 text-xs">≈ {converted}</p>}
                      </td>
                      <td className="text-foreground/70 py-3 pr-4 text-sm">
                        {goal.kind === "category" ? categoryLabel(goal.category_id) : kindLabel(goal.kind)}
                      </td>
                      <td className="text-foreground/70 tnum py-3 pr-4 text-sm">{goal.target_date ?? "—"}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              openEdit(goal);
                            }}
                            disabled={pending}
                            className="text-primary dark:text-foreground flex items-center gap-1 text-sm transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Pencil className="size-3.5" />
                            Edit
                          </button>
                          <span className="text-border">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              void handleDelete(goal);
                            }}
                            disabled={pending}
                            className="text-destructive flex items-center gap-1 text-sm transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile reflow: the same rows as stacked cards, matching AssetCard. */}
          <ul role="list" className="sm:hidden">
            {goals.map((goal) => {
              const converted = targetInDisplay(goal);
              return (
                <li key={goal.id} className="border-border border-b py-3 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-foreground truncate font-medium">{goal.name}</p>
                      <p className="text-foreground/70 tnum mt-0.5 text-sm">
                        {money(goal.target_amount, goal.target_currency)}
                      </p>
                      {converted && <p className="text-muted-foreground tnum mt-0.5 text-xs">≈ {converted}</p>}
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {goal.kind === "category" ? categoryLabel(goal.category_id) : kindLabel(goal.kind)}
                        {goal.target_date && ` · by ${goal.target_date}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          openEdit(goal);
                        }}
                        disabled={pending}
                        aria-label={`Edit ${goal.name}`}
                        className="text-primary dark:text-foreground flex items-center gap-1 text-sm transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDelete(goal);
                        }}
                        disabled={pending}
                        aria-label={`Delete ${goal.name}`}
                        className="text-destructive flex items-center gap-1 text-sm transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
