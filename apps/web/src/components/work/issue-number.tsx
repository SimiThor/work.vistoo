"use client";

import { toast } from "sonner";
import { formatIssueNumber } from "@vistoo/domain/issue-refs";
import { cn } from "@/lib/utils";

/**
 * `#24` next to a task title: same size as the surrounding text, quieter
 * colour, tabular digits so lists line up. Plain selectable text.
 */
export function IssueNumber({ number, className }: { number: number; className?: string }) {
  return (
    <span className={cn("shrink-0 font-normal text-muted-foreground tabular-nums select-text", className)}>
      {formatIssueNumber(number)}
    </span>
  );
}

/** `#24` as a button: click copies the number (e.g. to paste into a chat or commit message). */
export function CopyIssueNumber({ number, className }: { number: number; className?: string }) {
  const label = formatIssueNumber(number);
  return (
    <button
      type="button"
      title="Nummer kopieren"
      aria-label={`Nummer ${label} kopieren`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(label);
          toast.success(`${label} kopiert`);
        } catch {
          toast.error("Nummer konnte nicht kopiert werden.");
        }
      }}
      className={cn(
        "rounded-md px-1 -mx-1 tabular-nums text-muted-foreground outline-none hover:bg-surface-subtle hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35",
        className,
      )}
    >
      {label}
    </button>
  );
}
