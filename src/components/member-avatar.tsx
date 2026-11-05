import { UserRound } from "lucide-react";
import { displayName, initials, type MemberDTO } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Initials avatar (no uploaded images in the MVP). Neutral, not colourful. */
export function MemberAvatar({
  member,
  size = "sm",
  className,
  decorative = true,
}: {
  member: Pick<MemberDTO, "fullName" | "email"> | null | undefined;
  size?: "xs" | "sm" | "md";
  className?: string;
  decorative?: boolean;
}) {
  const dims = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  if (!member) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted-foreground",
          dims,
          className,
        )}
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : "Nicht zugewiesen"}
        role={decorative ? undefined : "img"}
      >
        <UserRound className="size-3" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-surface-sunken font-semibold text-foreground/80",
        dims,
        className,
      )}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : displayName(member)}
      role={decorative ? undefined : "img"}
    >
      {initials(member)}
    </span>
  );
}
