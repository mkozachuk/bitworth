import { useState } from "react";
import { Save } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { FireProjectionChart } from "@/components/fire/FireProjectionChart";
import { computeFireProjection, type FireInputs } from "@/lib/fire";

type Currency = "USD" | "EUR" | "PLN";

interface Props {
  displayCurrency: Currency;
  startingPrincipal: number;
  initialInputs: Partial<FireInputs>;
}

// Form state mirrors FireInputs, but rate fields are held as whole-number
// percentages (7 = 7%) so typing in the input does not fight float jitter.
// They are divided by 100 only when feeding fire.ts and the persistence API.
interface FormState {
  startingPrincipal: number;
  annualIncome: number;
  annualExpenses: number;
  expectedReturnPct: number;
  inflationRatePct: number;
  safeWithdrawalRatePct: number;
  currentAge: number;
  traditionalRetirementAge: number;
  baristaIncome: number;
}

// Money fields default to NaN so a fresh user sees a blank box (with a "0"
// placeholder) instead of a literal 0 they have to delete before typing.
// num() coerces NaN -> 0 wherever the value is actually consumed.
const DEFAULTS: FormState = {
  startingPrincipal: 0,
  annualIncome: NaN,
  annualExpenses: NaN,
  expectedReturnPct: 7,
  inflationRatePct: 3,
  safeWithdrawalRatePct: 4,
  currentAge: 30,
  traditionalRetirementAge: 65,
  baristaIncome: NaN,
};

const num = (v: number): number => (Number.isNaN(v) ? 0 : v);

// Convert a fraction (0.07) to a percent (7), rounding away float artifacts like 7.000000000000001.
const toPct = (v: number): number => Math.round(v * 10000) / 100;

function seedState(startingPrincipal: number, initial: Partial<FireInputs>): FormState {
  return {
    // The override (initial.startingPrincipal) wins over the seeded net worth;
    // otherwise the user starts from their current net worth. Rounded to whole
    // units — a projection input has no business showing ten float decimals.
    startingPrincipal: Math.round(initial.startingPrincipal ?? startingPrincipal),
    annualIncome: initial.annualIncome ?? DEFAULTS.annualIncome,
    annualExpenses: initial.annualExpenses ?? DEFAULTS.annualExpenses,
    expectedReturnPct: initial.nominalReturn !== undefined ? toPct(initial.nominalReturn) : DEFAULTS.expectedReturnPct,
    inflationRatePct: initial.inflationRate !== undefined ? toPct(initial.inflationRate) : DEFAULTS.inflationRatePct,
    safeWithdrawalRatePct:
      initial.safeWithdrawalRate !== undefined ? toPct(initial.safeWithdrawalRate) : DEFAULTS.safeWithdrawalRatePct,
    currentAge: initial.currentAge ?? DEFAULTS.currentAge,
    traditionalRetirementAge: initial.traditionalRetirementAge ?? DEFAULTS.traditionalRetirementAge,
    baristaIncome: initial.baristaIncome ?? DEFAULTS.baristaIncome,
  };
}

function toInputs(state: FormState): FireInputs {
  return {
    startingPrincipal: num(state.startingPrincipal),
    annualIncome: num(state.annualIncome),
    annualExpenses: num(state.annualExpenses),
    nominalReturn: num(state.expectedReturnPct) / 100,
    inflationRate: num(state.inflationRatePct) / 100,
    safeWithdrawalRate: num(state.safeWithdrawalRatePct) / 100,
    currentAge: num(state.currentAge),
    traditionalRetirementAge: num(state.traditionalRetirementAge),
    baristaIncome: num(state.baristaIncome) > 0 ? num(state.baristaIncome) : undefined,
  };
}

function formatMoney(value: number, currency: Currency): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function FireCalculatorForm({ displayCurrency, startingPrincipal, initialInputs }: Props) {
  const [state, setState] = useState<FormState>(() => seedState(startingPrincipal, initialInputs));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      // Keep NaN (empty box) in state so the field can be cleared and retyped
      // without snapping back to 0; num() coerces it where the value is used.
      setState((prev) => ({ ...prev, [key]: e.target.valueAsNumber }));
    };
  }

  // The only invalid input fire.ts cannot absorb is a non-positive SWR (the
  // FIRE number divides by it). Guard the call rather than let it throw.
  const swrValid = num(state.safeWithdrawalRatePct) > 0;
  const inputs = toInputs(state);
  const result = swrValid ? computeFireProjection(inputs) : null;

  async function handleSave() {
    setError(null);
    setPending(true);

    const payload = {
      fire_current_age: num(state.currentAge),
      fire_annual_income: num(state.annualIncome),
      fire_annual_expenses: num(state.annualExpenses),
      fire_expected_return: num(state.expectedReturnPct) / 100,
      fire_inflation_rate: num(state.inflationRatePct) / 100,
      fire_safe_withdrawal_rate: num(state.safeWithdrawalRatePct) / 100,
      fire_starting_principal_override: num(state.startingPrincipal),
      fire_traditional_retirement_age: num(state.traditionalRetirementAge),
      fire_barista_income: num(state.baristaIncome),
    };

    try {
      const res = await fetch("/api/user-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
        }}
        noValidate
      >
        <ServerError message={error} />

        <NumberField
          id="fire_current_age"
          label="Current age"
          value={state.currentAge}
          onChange={update("currentAge")}
          min={0}
          max={120}
          step={1}
        />
        <NumberField
          id="fire_starting_principal"
          label={`Starting principal (${displayCurrency}, today's money)`}
          help="Seeded from your current net worth. Override it to model a different starting point."
          value={state.startingPrincipal}
          onChange={update("startingPrincipal")}
          min={0}
          placeholder="0"
        />
        <NumberField
          id="fire_annual_income"
          label={`Annual income (${displayCurrency})`}
          value={state.annualIncome}
          onChange={update("annualIncome")}
          min={0}
          placeholder="0"
        />
        <NumberField
          id="fire_annual_expenses"
          label={`Annual expenses (${displayCurrency})`}
          value={state.annualExpenses}
          onChange={update("annualExpenses")}
          min={0}
          placeholder="0"
        />
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="fire_expected_return"
            label="Expected return (nominal, %)"
            value={state.expectedReturnPct}
            onChange={update("expectedReturnPct")}
            min={0}
            max={100}
            step={0.1}
          />
          <NumberField
            id="fire_inflation_rate"
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
            id="fire_safe_withdrawal_rate"
            label="Safe withdrawal rate (%)"
            value={state.safeWithdrawalRatePct}
            onChange={update("safeWithdrawalRatePct")}
            min={0}
            max={100}
            step={0.1}
          />
          <NumberField
            id="fire_traditional_retirement_age"
            label="Traditional retirement age"
            value={state.traditionalRetirementAge}
            onChange={update("traditionalRetirementAge")}
            min={0}
            max={120}
            step={1}
          />
        </div>
        <NumberField
          id="fire_barista_income"
          label={`Part-time income in semi-retirement (${displayCurrency}, optional)`}
          help="Barista FIRE — income that covers part of your expenses, lowering the portfolio you need."
          value={state.baristaIncome}
          onChange={update("baristaIncome")}
          min={0}
          placeholder="0"
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
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
      </form>

      <div className="space-y-4">
        {result === null ? (
          <div className="bg-kraft/40 border-kraft text-foreground/80 rounded-sm border p-6 text-sm">
            Enter a safe withdrawal rate greater than 0% to see your projection.
          </div>
        ) : (
          <>
            <div className="bg-card border-border rounded-md border p-6">
              <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
                Projected retirement age
              </p>
              {result.retirementAge !== null ? (
                <p className="font-display tnum text-foreground mt-1 text-4xl font-bold">
                  {result.retirementAge}
                  <span className="text-muted-foreground ml-2 font-sans text-base font-normal">
                    in {result.yearsToFi} {result.yearsToFi === 1 ? "year" : "years"}
                  </span>
                </p>
              ) : (
                <p className="text-loss mt-1 text-lg font-semibold">
                  Not reachable within the projection horizon at this savings rate.
                </p>
              )}
            </div>

            <dl className="bg-card border-border space-y-3 rounded-md border p-6">
              <ResultRow label="FIRE number" value={formatMoney(result.fireNumber, displayCurrency)} />
              <ResultRow
                label="Savings rate"
                value={formatPct(result.savingsRate)}
                detail={`Saving ${formatMoney(result.annualSavings, displayCurrency)} of ${formatMoney(
                  state.annualIncome,
                  displayCurrency,
                )} income each year.`}
              />
              <ResultRow
                label="Coast FIRE"
                value={
                  result.coastFireNumber === null
                    ? "Already past traditional retirement age"
                    : formatMoney(result.coastFireNumber, displayCurrency)
                }
                detail={
                  result.coastFireNumber === null
                    ? undefined
                    : result.isCoastFi
                      ? "Reached — your principal can coast to your FIRE number by traditional retirement age."
                      : "Not yet reached."
                }
              />
              {state.baristaIncome > 0 && (
                <ResultRow
                  label="Barista FIRE number"
                  value={formatMoney(result.baristaFireNumber, displayCurrency)}
                  detail={result.isBaristaFi ? "Reached with your part-time income." : "Not yet reached."}
                />
              )}
            </dl>

            <p className="bg-card border-border text-muted-foreground rounded-md border p-4 text-xs">
              All figures are an <strong>estimate, not financial advice</strong>, shown in {displayCurrency} in
              today&apos;s purchasing power (real terms).
            </p>

            <FireProjectionChart
              projection={result.projection}
              fireNumber={result.fireNumber}
              displayCurrency={displayCurrency}
              retirementAge={result.retirementAge}
            />
          </>
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
      <label htmlFor={id} className="text-foreground/70 mb-1 block text-sm">
        {label}
      </label>
      {help && <p className="text-muted-foreground mb-2 text-xs">{help}</p>}
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
        className="tnum border-input bg-card text-foreground focus:border-primary w-full rounded-sm border px-3 py-2 transition-colors focus:outline-none"
      />
    </div>
  );
}

function ResultRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-foreground/70 text-sm">
        {label}
        {detail && <span className="text-muted-foreground mt-0.5 block text-xs">{detail}</span>}
      </dt>
      <dd className="tnum text-foreground text-right text-sm font-semibold whitespace-nowrap">{value}</dd>
    </div>
  );
}
