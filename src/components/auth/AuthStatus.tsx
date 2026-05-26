import type { Currency } from "@/lib/net-worth";
import { CurrencySelector } from "@/components/dashboard/CurrencySelector";

interface AuthStatusProps {
  email: string;
  currency: Currency;
  onCurrencyChange: (c: Currency) => void;
}

export function AuthStatus({ email, currency, onCurrencyChange }: AuthStatusProps) {
  return (
    <div className="flex items-center gap-3">
      {email && <span className="hidden text-sm text-white/50 sm:block">{email}</span>}
      <CurrencySelector value={currency} onChange={onCurrencyChange} />
      <form method="POST" action="/api/auth/signout">
        <button
          type="submit"
          className="rounded-lg border border-white/10 px-3 py-1 text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
