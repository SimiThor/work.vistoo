"use client";

import { MemberAvatar } from "@/components/member-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/** Person picker (active members; a former member stays visible as such). */
export function MemberSelect({
  id,
  value,
  onChange,
  members,
  disabled,
  noneLabel = "Nicht zugewiesen",
  className,
  ariaLabel,
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  members: MemberDTO[];
  disabled?: boolean;
  noneLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <MemberAvatar member={null} size="xs" />
          {noneLabel}
        </SelectItem>
        {members.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            <MemberAvatar member={m} size="xs" />
            {displayName(m)}
          </SelectItem>
        ))}
        {value && !members.some((m) => m.userId === value) && (
          <SelectItem value={value} disabled>
            Ehemaliges Mitglied
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

/** Lookup for names of current and former members. */
export function peopleMap(members: MemberDTO[], former: MemberDTO[]): Map<string, MemberDTO> {
  return new Map([...former, ...members].map((m) => [m.userId, m]));
}
