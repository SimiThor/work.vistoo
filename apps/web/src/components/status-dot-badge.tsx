import { cn } from "@/lib/utils";

/** Neutral pill with a small coloured dot (status badges in lists and tables). */
export function StatusDotBadge({ color, label, className }: { color: string; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-xs font-medium text-foreground/85",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
