"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IDEA_STATUS_LABEL, IDEA_STATUSES, type IdeaStatus } from "@vistoo/domain/ideas";

/** Muted dot per idea status (same visual language as the CRM badges). */
export const IDEA_STATUS_COLOR: Record<IdeaStatus, string> = {
  new: "#4a7fd4",
  planned: "#4f9a5c",
  irrelevant: "#8e8e93",
};

export function IdeaStatusSelect({
  value,
  onChange,
  className,
  label,
}: {
  value: IdeaStatus;
  onChange: (s: IdeaStatus) => void;
  className?: string;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IdeaStatus)}>
      <SelectTrigger size="sm" aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {IDEA_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: IDEA_STATUS_COLOR[s] }} />
            {IDEA_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
