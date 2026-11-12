import { MemberAvatar } from "@/components/member-avatar";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { cn } from "@/lib/utils";

/** Screen-reader text for a list of assignees (unknown ids count as former members). */
export function assigneesLabel(ids: string[], people: Map<string, MemberDTO>): string {
  if (!ids.length) return "Nicht zugewiesen";
  const names = ids.map((id) => {
    const p = people.get(id);
    return p ? displayName(p) : "Ehemaliges Mitglied";
  });
  return `Verantwortlich: ${names.join(", ")}`;
}

/**
 * Overlapping initials of everyone responsible (at most `max`, then "+n").
 * Empty list: the dashed "unassigned" avatar. Decorative; pair with `assigneesLabel`.
 */
export function AssigneeStack({
  ids,
  people,
  size = "sm",
  max = 3,
  className,
}: {
  ids: string[];
  people: Map<string, MemberDTO>;
  size?: "xs" | "sm" | "md";
  max?: number;
  className?: string;
}) {
  if (!ids.length) return <MemberAvatar member={null} size={size} className={className} />;
  const shown = ids.length > max ? ids.slice(0, max - 1) : ids;
  const rest = ids.length - shown.length;
  const dims = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  return (
    <span className={cn("flex items-center -space-x-1.5", className)} aria-hidden>
      {shown.map((id) => (
        <MemberAvatar
          key={id}
          member={people.get(id) ?? { fullName: "?", email: "?" }}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-sunken font-semibold text-muted-foreground tabular-nums ring-2 ring-background",
            dims,
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
