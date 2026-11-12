import { STATUS_LABEL, type TaskStatus } from "@vistoo/domain";
import { cn } from "@/lib/utils";

const COLOR: Record<TaskStatus, string> = {
  backlog: "text-status-backlog",
  open: "text-status-open",
  in_progress: "text-status-progress",
  in_review: "text-status-review",
  done: "text-status-done",
};

/**
 * Status glyph: distinguishable by shape (dashed, empty, half, three-quarter, check),
 * not only by colour. Decorative by default; pair it with the text label.
 */
export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5 shrink-0", COLOR[status], className)}>
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "backlog" ? "2.2 2.2" : undefined}
      />
      {status === "in_progress" && <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />}
      {status === "in_review" && <path d="M8 3.5a4.5 4.5 0 1 1-4.5 4.5H8z" fill="currentColor" />}
      {status === "done" && (
        <>
          <circle cx="8" cy="8" r="6.25" fill="currentColor" />
          <path d="M5.2 8.2l1.9 1.9 3.7-3.9" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function StatusLabel({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
