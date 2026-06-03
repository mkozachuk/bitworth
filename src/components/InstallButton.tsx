import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export default function InstallButton({ className }: { className?: string }) {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    if (isIOS() || installed) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setInstallable(true);
    };

    const onAppInstalled = () => {
      deferredPromptRef.current = null;
      setInstallable(false);
      setInstalled(true);
    };

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const onStandaloneChange = (e: MediaQueryListEvent) => {
      if (e.matches) setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    standaloneQuery.addEventListener("change", onStandaloneChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      standaloneQuery.removeEventListener("change", onStandaloneChange);
    };
  }, [installed]);

  if (isIOS() || installed || !installable) return null;

  const onClick = async () => {
    const deferred = deferredPromptRef.current;
    if (!deferred) return;
    deferredPromptRef.current = null;
    setInstallable(false);
    await deferred.prompt();
    await deferred.userChoice;
  };

  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={className ?? "text-purple-600 dark:text-purple-300"}>
      <Download className="size-4" />
      Install app
    </Button>
  );
}
