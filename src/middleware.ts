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
  if (supabase && context.locals.user) {
    const { data } = await supabase
      .from("user_preferences")
      .select("theme")
      .eq("user_id", context.locals.user.id)
      .maybeSingle();
    const rawTheme = (data as { theme?: string } | null)?.theme;
    if (rawTheme === "light" || rawTheme === "dark" || rawTheme === "system") {
      context.locals.theme = rawTheme;
    }
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
