import { useState } from "react";
import { Save } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";

type Currency = "USD" | "EUR" | "PLN";
type Theme = "light" | "dark" | "system";

interface Props {
  initialDisplayCurrency: Currency;
  initialTheme: Theme;
  initialShowFireDashboard: boolean;
  initialShowDriftAlerts: boolean;
  initialShowTrajectory: boolean;
  initialShowGoals: boolean;
}

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "PLN", label: "PLN — Polish Zloty" },
];

const THEMES: { value: Theme; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use the light background." },
  { value: "dark", label: "Dark", description: "Always use the dark background." },
  { value: "system", label: "System", description: "Follow your operating system preference." },
];

export function SettingsForm({
  initialDisplayCurrency,
  initialTheme,
  initialShowFireDashboard,
  initialShowDriftAlerts,
  initialShowTrajectory,
  initialShowGoals,
}: Props) {
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(initialDisplayCurrency);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [showFireDashboard, setShowFireDashboard] = useState<boolean>(initialShowFireDashboard);
  const [showDriftAlerts, setShowDriftAlerts] = useState<boolean>(initialShowDriftAlerts);
  const [showTrajectory, setShowTrajectory] = useState<boolean>(initialShowTrajectory);
  const [showGoals, setShowGoals] = useState<boolean>(initialShowGoals);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hasChanges =
    displayCurrency !== initialDisplayCurrency ||
    theme !== initialTheme ||
    showFireDashboard !== initialShowFireDashboard ||
    showDriftAlerts !== initialShowDriftAlerts ||
    showTrajectory !== initialShowTrajectory ||
    showGoals !== initialShowGoals;

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hasChanges) return;
    setError(null);
    setPending(true);

    const updates: {
      display_currency?: Currency;
      theme?: Theme;
      show_fire_dashboard?: boolean;
      show_drift_alerts?: boolean;
      show_trajectory?: boolean;
      show_goals?: boolean;
    } = {};
    if (displayCurrency !== initialDisplayCurrency) updates.display_currency = displayCurrency;
    if (theme !== initialTheme) updates.theme = theme;
    if (showFireDashboard !== initialShowFireDashboard) updates.show_fire_dashboard = showFireDashboard;
    if (showDriftAlerts !== initialShowDriftAlerts) updates.show_drift_alerts = showDriftAlerts;
    if (showTrajectory !== initialShowTrajectory) updates.show_trajectory = showTrajectory;
    if (showGoals !== initialShowGoals) updates.show_goals = showGoals;

    try {
      const res = await fetch("/api/user-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = (await res.json()) as { error?: { message: string } };

      if (json.error) {
        setError(json.error.message);
        setPending(false);
        return;
      }

      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <ServerError message={error} />

      <div>
        <label htmlFor="display_currency" className="text-foreground/70 mb-1 block text-sm">
          Display currency
        </label>
        <p className="text-muted-foreground mb-2 text-xs">
          Used for new snapshots and dashboard totals. Historical snapshots keep the currency they were saved in.
        </p>
        <div className="relative">
          <select
            id="display_currency"
            name="display_currency"
            value={displayCurrency}
            onChange={(e) => {
              setDisplayCurrency(e.target.value as Currency);
            }}
            className="border-input bg-card text-foreground focus:border-primary w-full appearance-none rounded-sm border px-3 py-2 pr-8 transition-colors focus:outline-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
            ▼
          </span>
        </div>
      </div>

      <fieldset>
        <legend className="text-foreground/70 mb-2 block text-sm">Theme</legend>
        <div className="space-y-2">
          {THEMES.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors ${
                theme === t.value ? "border-primary bg-card" : "border-border bg-card hover:border-primary/50"
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                onChange={() => {
                  setTheme(t.value);
                }}
                className="accent-primary mt-1 size-4 cursor-pointer"
              />
              <span>
                <span className="text-foreground block text-sm font-medium">{t.label}</span>
                <span className="text-muted-foreground block text-xs">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="show_fire_dashboard" className="text-foreground/70 flex items-center gap-2 text-sm">
          <input
            id="show_fire_dashboard"
            type="checkbox"
            checked={showFireDashboard}
            onChange={(e) => {
              setShowFireDashboard(e.target.checked);
            }}
            className="accent-primary size-4"
          />
          Show FIRE progress on dashboard
        </label>
        <p className="text-muted-foreground mt-1 text-xs">
          Adds a card to your dashboard showing progress toward financial independence.
        </p>
      </div>

      <div>
        <label htmlFor="show_drift_alerts" className="text-foreground/70 flex items-center gap-2 text-sm">
          <input
            id="show_drift_alerts"
            type="checkbox"
            checked={showDriftAlerts}
            onChange={(e) => {
              setShowDriftAlerts(e.target.checked);
            }}
            className="accent-primary size-4"
          />
          Show allocation drift alerts on dashboard
        </label>
        <p className="text-muted-foreground mt-1 text-xs">
          Adds a card highlighting balancer cards whose real allocation has drifted from target.
        </p>
      </div>

      <div>
        <label htmlFor="show_trajectory" className="text-foreground/70 flex items-center gap-2 text-sm">
          <input
            id="show_trajectory"
            type="checkbox"
            checked={showTrajectory}
            onChange={(e) => {
              setShowTrajectory(e.target.checked);
            }}
            className="accent-primary size-4"
          />
          Show net-worth projection on dashboard
        </label>
        <p className="text-muted-foreground mt-1 text-xs">
          Extends your net-worth chart with a projected trend line and an estimated date to reach a target.
        </p>
      </div>

      <div>
        <label htmlFor="show_goals" className="text-foreground/70 flex items-center gap-2 text-sm">
          <input
            id="show_goals"
            type="checkbox"
            checked={showGoals}
            onChange={(e) => {
              setShowGoals(e.target.checked);
            }}
            className="accent-primary size-4"
          />
          Show savings goals on dashboard
        </label>
        <p className="text-muted-foreground mt-1 text-xs">
          Adds a card with your top savings goals, each with a progress bar and an estimated completion date.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending || !hasChanges}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-sm px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <>
              <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Save
            </>
          )}
        </button>
      </div>
    </form>
  );
}
