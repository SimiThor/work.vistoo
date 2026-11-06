"use client";

import { Check } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { cn } from "@/lib/utils";

/** Searchable list of workspace members (single or multiple selection). */
export function MemberPicker({
  members,
  selected,
  onToggle,
  multiple,
  label,
}: {
  members: MemberDTO[];
  selected: string[];
  onToggle: (userId: string) => void;
  multiple: boolean;
  label: string;
}) {
  return (
    <Command className="rounded-lg border" label={label}>
      <CommandInput placeholder="Name oder E-Mail suchen …" />
      <CommandList className="max-h-56">
        <CommandEmpty>Niemand gefunden.</CommandEmpty>
        {members.map((m) => {
          const checked = selected.includes(m.userId);
          return (
            <CommandItem
              key={m.userId}
              value={`${displayName(m)} ${m.email}`}
              onSelect={() => onToggle(m.userId)}
              aria-checked={multiple ? checked : undefined}
            >
              {multiple && (
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border border-border-strong",
                    checked && "border-accent-blue bg-accent-blue text-white",
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
              )}
              <MemberAvatar member={m} size="xs" />
              <span className="min-w-0 flex-1 truncate">{displayName(m)}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{m.email}</span>
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
}
