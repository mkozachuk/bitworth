import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  context.locals.theme = null;
  context.locals.displayCurrency = null;
  if (supabase && context.locals.user) {
    const { data } = await supabase
      .from("user_preferences")
      .select("theme, display_currency")
      .eq("user_id", context.locals.user.id)
      .maybeSingle();
    const raw = data as { theme?: string; display_currency?: string } | null;
    if (raw?.theme === "light" || raw?.theme === "dark" || raw?.theme === "system") {
      context.locals.theme = raw.theme;
    }
    if (raw?.display_currency === "USD" || raw?.display_currency === "EUR" || raw?.display_currency === "PLN") {
      context.locals.displayCurrency = raw.display_currency;
    }
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
