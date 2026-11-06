"use client";

import { useEffect, useState } from "react";
import { chatStorageUsageAction } from "@/app/actions/chat";
import { CHAT_LIMITS, formatBytes } from "@/lib/chat-config";
import type { ChatStorageUsage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/** Admins only: chat file storage usage, with a warning from 80 %. */
export function StorageNotice() {
  const [usage, setUsage] = useState<ChatStorageUsage | null>(null);
  useEffect(() => {
    let cancelled = false;
    void chatStorageUsageAction().then((res) => {
      if (!cancelled && res.ok) setUsage(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!usage) return null;
  const full = usage.ratio >= 1;
  const warn = usage.ratio >= CHAT_LIMITS.warnRatio;
  return (
    <div
      className={cn(
        "mx-2 mb-2 shrink-0 rounded-lg px-3 py-2 text-xs",
        warn ? "bg-warning-bg text-warning-fg" : "text-muted-foreground",
      )}
      role={warn ? "status" : undefined}
    >
      <p>
        Chat-Dateien: {formatBytes(usage.usedBytes)} von {formatBytes(usage.budgetBytes)}
      </p>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken"
        role="meter"
        aria-label="Belegter Chat-Speicher"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, usage.ratio) * 100)}
      >
        <div
          className={cn("h-full rounded-full", warn ? "bg-status-review" : "bg-accent-blue")}
          style={{ width: `${Math.min(100, usage.ratio * 100)}%` }}
        />
      </div>
      {full ? (
        <p className="mt-1.5">Budget ausgeschöpft: Neue Anhänge sind gesperrt, Textnachrichten funktionieren weiter.</p>
      ) : warn ? (
        <p className="mt-1.5">Der Speicher ist fast voll. Lösche nicht mehr benötigte Anhänge.</p>
      ) : null}
    </div>
  );
}
