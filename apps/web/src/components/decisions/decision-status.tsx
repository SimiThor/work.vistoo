"use client";

import { FlaskConical, Scale, type LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DECISION_STATUS_COLOR,
  DECISION_STATUS_LABEL,
  DECISION_TYPE_LABEL,
  STATUSES_BY_TYPE,
  type DecisionStatus,
  type DecisionType,
} from "@vistoo/domain/decisions";

export const TYPE_ICON: Record<DecisionType, LucideIcon> = { decision: Scale, experiment: FlaskConical };

/** `decorative` when a visible label sits next to it (avoids announcing the type twice). */
export function TypeIcon({ type, className, decorative = false }: { type: DecisionType; className?: string; decorative?: boolean }) {
  const Icon = TYPE_ICON[type];
  const cls = cn("size-4 shrink-0 text-muted-foreground", className);
  return decorative ? <Icon className={cls} aria-hidden /> : <Icon className={cls} aria-label={DECISION_TYPE_LABEL[type]} role="img" />;
}

export function StatusDot({ status }: { status: DecisionStatus }) {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: DECISION_STATUS_COLOR[status] }} />;
}

/** Quiet pill: dot + label. */
export function StatusBadge({ status, className }: { status: DecisionStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-xs whitespace-nowrap text-foreground/85",
        status === "superseded" && "text-muted-foreground line-through decoration-muted-foreground/40",
        className,
      )}
    >
      <StatusDot status={status} />
      {DECISION_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Statuses of the entry's type. "Superseded" is shown only when the entry
 * already is (it is reached through "Ersetzen", not by picking it).
 */
export function DecisionStatusSelect({
  id,
  type,
  value,
  onChange,
  className,
}: {
  id?: string;
  type: DecisionType;
  value: DecisionStatus;
  onChange: (s: DecisionStatus) => void;
  className?: string;
}) {
  const options = STATUSES_BY_TYPE[type].filter((s) => s !== "superseded" || value === "superseded");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DecisionStatus)}>
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((s) => (
          <SelectItem key={s} value={s}>
            <StatusDot status={s} />
            {DECISION_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
