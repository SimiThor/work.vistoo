"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyTheme, readTheme, THEME_LABEL, THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/theme";

const ICON: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const CHANGE_EVENT = "vistoo:theme-change";

/** Stored choice, kept in sync across components and tabs. */
function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Appearance switch next to the user's name: System (default), Hell, Dunkel. Stored per browser. */
export function ThemeToggle() {
  // "system" on the server; the stored choice on the client.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  // Changes of the system setting while "system" is chosen: THEME_INIT_SCRIPT (lib/theme.ts).

  function choose(value: string) {
    const next = (THEMES as readonly string[]).includes(value) ? (value as Theme) : "system";
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies to this page view.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  const Icon = ICON[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Darstellung: ${THEME_LABEL[theme]}`}
          title={`Darstellung: ${THEME_LABEL[theme]}`}
        >
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-36">
        <DropdownMenuLabel>Darstellung</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={choose}>
          {THEMES.map((t) => {
            const ItemIcon = ICON[t];
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <ItemIcon aria-hidden />
                {THEME_LABEL[t]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
