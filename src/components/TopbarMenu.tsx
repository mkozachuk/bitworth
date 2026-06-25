import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Menu, LayoutDashboard, FileText, Scale, Flame, Dices, Settings, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import InstallButton from "@/components/InstallButton";

interface Props {
  user: { email?: string };
}

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-purple-600 outline-none transition-colors hover:bg-zinc-100 hover:text-purple-800 focus-visible:bg-zinc-100 data-[highlighted]:bg-zinc-100 dark:text-purple-300 dark:hover:bg-white/10 dark:hover:text-purple-100 dark:focus-visible:bg-white/10 dark:data-[highlighted]:bg-white/10";

export default function TopbarMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const pointerDownHandledRef = useRef(false);

  return (
    <div>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={user.email ? `Open menu for ${user.email}` : "Open menu"}
            onPointerDown={() => {
              pointerDownHandledRef.current = true;
            }}
            onClick={() => {
              if (!pointerDownHandledRef.current) {
                setOpen((prev) => !prev);
              }
              pointerDownHandledRef.current = false;
            }}
          >
            <Menu className="size-5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[200px] rounded-lg border border-zinc-200 bg-white/80 p-1 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
          >
            <DropdownMenu.Item asChild>
              <a href="/dashboard" className={itemClass}>
                <LayoutDashboard className="size-4" />
                Dashboard
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href="/dashboard/assets" className={itemClass}>
                <FileText className="size-4" />
                Assets
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href="/dashboard/balancer" className={itemClass}>
                <Scale className="size-4" />
                Balance
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href="/dashboard/fire" className={itemClass}>
                <Flame className="size-4" />
                FIRE
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href="/dashboard/forecast" className={itemClass}>
                <Dices className="size-4" />
                Forecast
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href="/dashboard/settings" className={itemClass}>
                <Settings className="size-4" />
                Settings
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
            <DropdownMenu.Item asChild>
              <InstallButton className={itemClass} />
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <form method="POST" action="/api/auth/signout" className="m-0">
                <button type="submit" className={itemClass}>
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </form>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
