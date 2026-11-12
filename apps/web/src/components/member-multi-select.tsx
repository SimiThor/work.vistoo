"use client";

import { Check, ChevronDown } from "lucide-react";
import { AssigneeStack } from "@/components/assignee-stack";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayName, MAX_TASK_ASSIGNEES, type MemberDTO } from "@vistoo/domain";
import { cn } from "@/lib/utils";

/**
 * Picker for several people (task assignees). Order = order of selection.
 * Active members can be toggled; former members that are still selected stay
 * visible and can only be removed.
 */
export function MemberMultiSelect({
  id,
  value,
  onChange,
  members,
  people,
  disabled,
  className,
  ariaLabel,
  noneLabel = "Nicht zugewiesen",
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  members: MemberDTO[];
  /** Active + former members (names of former assignees). */
  people: Map<string, MemberDTO>;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  noneLabel?: string;
}) {
  const former = value.filter((v) => !members.some((m) => m.userId === v));
  const full = value.length >= MAX_TASK_ASSIGNEES;
  const toggle = (userId: string) =>
    onChange(value.includes(userId) ? value.filter((v) => v !== userId) : full ? value : [...value, userId]);

  const names = value.map((v) => (people.get(v) ? displayName(people.get(v)!) : "Ehemaliges Mitglied"));
  const summary = !value.length ? noneLabel : names.length <= 2 ? names.join(", ") : `${names[0]} und ${names.length - 1} weitere`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("h-8 w-full justify-start gap-2 px-2.5 font-normal", className)}
          aria-label={ariaLabel ? `${ariaLabel}: ${summary}` : undefined}
        >
          <AssigneeStack ids={value} people={people} size="xs" />
          <span className={cn("min-w-0 flex-1 truncate text-left", !value.length && "text-muted-foreground")}>{summary}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          {members.length > 8 && <CommandInput placeholder="Person suchen …" />}
          <CommandList>
            <CommandEmpty>Keine Treffer.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => {
                const checked = value.includes(m.userId);
                return (
                  <CommandItem
                    key={m.userId}
                    value={`${displayName(m)} ${m.email} ${m.userId}`}
                    onSelect={() => toggle(m.userId)}
                    aria-checked={checked}
                    disabled={!checked && full}
                  >
                    <CheckBox checked={checked} />
                    <MemberAvatar member={m} size="xs" />
                    <span className="truncate">{displayName(m)}</span>
                  </CommandItem>
                );
              })}
              {former.map((userId) => (
                <CommandItem key={userId} value={`former ${userId}`} onSelect={() => toggle(userId)} aria-checked>
                  <CheckBox checked />
                  <MemberAvatar member={people.get(userId) ?? null} size="xs" />
                  <span className="truncate text-muted-foreground">
                    {people.get(userId) ? displayName(people.get(userId)!) : "Ehemaliges Mitglied"} (ehemalig)
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => onChange([])}>
                Niemand zuweisen
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong",
        checked && "border-accent-blue bg-accent-blue text-white",
      )}
      aria-hidden
    >
      {checked && <Check className="size-3" />}
    </span>
  );
}
