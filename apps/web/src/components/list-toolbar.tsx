"use client";

import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * One look for every filter bar above a list (tasks, ideas, CRM, decisions):
 * search on the left, everything else on the right as a segmented control and
 * quiet icon buttons. Each page picks its own filters; only the design is shared.
 */
export function ListToolbar({
  search,
  label,
  children,
  className,
}: {
  search: React.ReactNode;
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4", className)}
    >
      {search}
      {children && (
        // Scrolls horizontally inside the row on narrow screens instead of wrapping.
        <div className="-mx-4 flex min-w-0 items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>
      )}
    </div>
  );
}

type Tone = "accent" | "destructive";

/** Class for a quiet toolbar button; filled softly while its filter is active. */
export function toolbarButtonClass(active = false, tone: Tone = "accent") {
  return cn(
    "h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-[13px] font-normal text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
    active &&
      (tone === "accent"
        ? "bg-accent-blue-soft text-accent-blue-text hover:bg-accent-blue-soft hover:text-accent-blue-text"
        : "bg-destructive/8 text-destructive hover:bg-destructive/10 hover:text-destructive"),
  );
}

/** On/off filter such as "Meine Aufgaben" or "Überfällig". */
export function ToolbarToggle({
  pressed,
  onPressedChange,
  icon,
  tone,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: React.ReactNode;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="sm" aria-pressed={pressed} onClick={() => onPressedChange(!pressed)} className={toolbarButtonClass(pressed, tone)}>
      {icon}
      {children}
    </Button>
  );
}

export type ToolbarOption<T extends string> = { value: T; label: string; icon?: React.ReactNode };

/**
 * Single choice (a filter or the sort order) behind a quiet button showing the
 * current choice. A filter is highlighted while it differs from `defaultValue`;
 * a sort order (`highlight={false}`) never is.
 */
export function ToolbarSelect<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  defaultValue,
  defaultLabel,
  highlight = true,
}: {
  label: string;
  icon: React.ReactNode;
  value: T;
  options: ToolbarOption<T>[];
  onChange: (value: T) => void;
  defaultValue?: T;
  /** Button text while the default is selected (e.g. "Person" instead of "Alle Personen"). */
  defaultLabel?: string;
  highlight?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  const isDefault = defaultValue !== undefined && value === defaultValue;
  const text = isDefault && defaultLabel ? defaultLabel : (current?.label ?? label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${label}: ${current?.label ?? ""}`} className={toolbarButtonClass(highlight && !isDefault)}>
          {icon}
          <span className="max-w-40 truncate">{text}</span>
          <ToolbarChevron />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.icon}
              <span className="truncate">{o.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small "opens a menu" hint for dropdown buttons in the toolbar. */
export function ToolbarChevron() {
  return <ChevronDown className="-ml-0.5 size-3 opacity-60" aria-hidden />;
}

/** "Zurücksetzen", shown only while a filter is active. */
export function ToolbarReset({ onClick, children = "Zurücksetzen" }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={toolbarButtonClass()}>
      <X aria-hidden />
      {children}
    </Button>
  );
}
