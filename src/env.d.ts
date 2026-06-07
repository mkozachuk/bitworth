declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    theme: "light" | "dark" | "system" | null;
    displayCurrency: "USD" | "EUR" | "PLN" | null;
  }
}

interface Navigator {
  // iOS Safari only — true when the page is launched as a home-screen PWA.
  readonly standalone?: boolean;
}
