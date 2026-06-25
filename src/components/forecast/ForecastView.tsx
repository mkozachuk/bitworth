import { useState } from "react";
import { Dices } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { computeMonteCarlo, type MonteCarloInputs } from "@/lib/monte-carlo";
import type { FireInputs } from "@/lib/fire";

type Currency = "USD" | "EUR" | "PLN";

interface Props {
  displayCurrency: Currency;
  startingPrincipal: number;
  initialInputs: Partial<FireInputs>;
}

// Form state mirrors FireInputs, but rate fields (including the new return
// volatility) are held as whole-number percentages (7 = 7%) so typing in the
// input does not fight float jitter. They are divided by 100 only when feeding
// monte-carlo.ts. There is no Save here — the FIRE assumptions are read-only
// inputs sourced from the persisted prefs, and volatility is session-only.
interface FormState {
  startingPrincipal: number;
  annualIncome: number;
  annualExpenses: number;
  expectedReturnPct: number;
  inflationRatePct: number;
  safeWithdrawalRatePct: number;
  currentAge: number;
  returnVolatilityPct: number;
}

// 1,000 paths is the v1 simulation size (see plan); held as a constant so the
// headline copy and the engine call cannot drift apart.
const PATH_COUNT = 1000;

// A fixed default seed keeps the page reproducible across reloads for a given
// input set; the "Re-run" button re-rolls it for a fresh draw on demand.
const DEFAULT_SEED = 1;

const DEFAULTS: FormState = {
  startingPrincipal: 0,
  annualIncome: NaN,
  annualExpenses: NaN,
  expectedReturnPct: 7,
  inflationRatePct: 3,
  safeWithdrawalRatePct: 4,
  currentAge: 30,
  returnVolatilityPct: 15,
};

const num = (v: number): number => (Number.isNaN(v) ? 0 : v);

function seedState(startingPrincipal: number, initial: Partial<FireInputs>): FormState {
  return {
    startingPrincipal: initial.startingPrincipal ?? startingPrincipal,
    annualIncome: initial.annualIncome ?? DEFAULTS.annualIncome,
    annualExpenses: initial.annualExpenses ?? DEFAULTS.annualExpenses,
    expectedReturnPct: initial.nominalReturn !== undefined ? initial.nominalReturn * 100 : DEFAULTS.expectedReturnPct,
    inflationRatePct: initial.inflationRate !== undefined ? initial.inflationRate * 100 : DEFAULTS.inflationRatePct,
    safeWithdrawalRatePct:
      initial.safeWithdrawalRate !== undefined ? initial.safeWithdrawalRate * 100 : DEFAULTS.safeWithdrawalRatePct,
    currentAge: initial.currentAge ?? DEFAULTS.currentAge,
    returnVolatilityPct: DEFAULTS.returnVolatilityPct,
  };
}

function toInputs(state: FormState, seed: number): MonteCarloInputs {
  return {
    startingPrincipal: num(state.startingPrincipal),
    annualIncome: num(state.annualIncome),
    annualExpenses: num(state.annualExpenses),
    nominalReturn: num(state.expectedReturnPct) / 100,
    inflationRate: num(state.inflationRatePct) / 100,
    safeWithdrawalRate: num(state.safeWithdrawalRatePct) / 100,
    currentAge: num(state.currentAge),
    // traditionalRetirementAge is part of FireInputs but unused by the MC engine;
    // pass a harmless value so the type is satisfied without inventing a UI field.
    traditionalRetirementAge: 65,
    returnVolatility: num(state.returnVolatilityPct) / 100,
    seed,
    pathCount: PATH_COUNT,
  };
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// initialInputs is "empty" (first visit, no FIRE prefs saved) when none of the
// user-supplied fields came through from the SSR prefs load. NB: safeWithdrawalRate
// is excluded on purpose — its column is NOT NULL DEFAULT 0.04, so it is set even
// for a brand-new account and is therefore not a signal that the user engaged
// with the FIRE calculator. Income/expenses/return/age are the nullable fields a
// user actually fills, so they are the honest "has saved prefs" signal.
function hasSavedPrefs(initial: Partial<FireInputs>): boolean {
  return (
    initial.annualIncome !== undefined ||
    initial.annualExpenses !== undefined ||
    initial.nominalReturn !== undefined ||
    initial.inflationRate !== undefined ||
    initial.currentAge !== undefined
  );
}

export function ForecastView({ displayCurrency, startingPrincipal, initialInputs }: Props) {
  const [state, setState] = useState<FormState>(() => seedState(startingPrincipal, initialInputs));
  const [seed, setSeed] = useState(DEFAULT_SEED);

  function update(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      // Keep NaN (empty box) in state so the field can be cleared and retyped
      // without snapping back to 0; num() coerces it where the value is used.
      setState((prev) => ({ ...prev, [key]: e.target.valueAsNumber }));
    };
  }

  // The only invalid input monte-carlo.ts cannot absorb is a non-positive SWR
  // (the FIRE number divides by it). Guard the call rather than let it throw.
  const swrValid = num(state.safeWithdrawalRatePct) > 0;
  const inputs = toInputs(state, seed);
  const result = swrValid ? computeMonteCarlo(inputs) : null;

  const showCta = !hasSavedPrefs(initialInputs);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
        }}
        noValidate
      >
        <ServerError message={null} />

        <NumberField
          id="forecast_current_age"
          label="Current age"
          value={state.currentAge}
          onChange={update("currentAge")}
          min={0}
          max={120}
          step={1}
        />
        <NumberField
          id="forecast_starting_principal"
          label={`Starting principal (${displayCurrency}, today's money)`}
          help="Seeded from your current net worth. Override it to model a different starting point."
          value={state.startingPrincipal}
          onChange={update("startingPrincipal")}
          min={0}
          placeholder="0"
        />
        <NumberField
          id="forecast_annual_income"
          label={`Annual income (${displayCurrency})`}
          value={state.annualIncome}
          onChange={update("annualIncome")}
          min={0}
          placeholder="0"
        />
        <NumberField
          id="forecast_annual_expenses"
          label={`Annual expenses (${displayCurrency})`}
          value={state.annualExpenses}
          onChange={update("annualExpenses")}
          min={0}
          placeholder="0"
        />
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="forecast_expected_return"
            label="Expected return (nominal, %)"
            value={state.expectedReturnPct}
            onChange={update("expectedReturnPct")}
            min={0}
            max={100}
            step={0.1}
          />
          <NumberField
            id="forecast_inflation_rate"
            label="Inflation rate (%)"
            value={state.inflationRatePct}
            onChange={update("inflationRatePct")}
            min={0}
            max={100}
            step={0.1}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="forecast_safe_withdrawal_rate"
            label="Safe withdrawal rate (%)"
            value={state.safeWithdrawalRatePct}
            onChange={update("safeWithdrawalRatePct")}
            min={0}
            max={100}
            step={0.1}
          />
          <NumberField
            id="forecast_return_volatility"
            label="Return volatility (%)"
            help="Year-to-year swing in real returns. Higher volatility widens the range of outcomes."
            value={state.returnVolatilityPct}
            onChange={update("returnVolatilityPct")}
            min={0}
            max={60}
            step={0.1}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setSeed((prev) => prev + 1);
          }}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          <Dices className="size-4" />
          Re-run simulation
        </button>
      </form>

      <div className="space-y-4">
        {showCta && (
          <div className="rounded-2xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
            Using default assumptions. Set up your FIRE plan on the{" "}
            <a href="/dashboard/fire" className="font-semibold underline hover:no-underline">
              FIRE Calculator
            </a>{" "}
            to pre-fill these from your saved figures.
          </div>
        )}

        {result === null ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Enter a safe withdrawal rate greater than 0% to run the simulation.
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50">
              Probability of reaching FIRE
            </p>
            <p className="mt-1 text-5xl font-bold text-zinc-900 dark:text-white">
              {formatPct(result.successProbability)}
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-white/60">
              of {result.pathCount.toLocaleString("en-US")} simulated paths reach your FIRE number over{" "}
              {result.horizonYears} {result.horizonYears === 1 ? "year" : "years"}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  help?: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

function NumberField({ id, label, help, value, onChange, min, max, step, placeholder }: NumberFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
        {label}
      </label>
      {help && <p className="mb-2 text-xs text-zinc-500 dark:text-white/40">{help}</p>}
      <input
        id={id}
        name={id}
        type="number"
        inputMode="decimal"
        value={Number.isNaN(value) ? "" : value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 transition-colors focus:ring-2 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
      />
    </div>
  );
}
