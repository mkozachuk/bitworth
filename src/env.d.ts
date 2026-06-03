declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    theme: "light" | "dark" | "system" | null;
    displayCurrency: "USD" | "EUR" | "PLN" | null;
  }
}
