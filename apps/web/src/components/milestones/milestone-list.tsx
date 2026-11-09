"use client";

import { ChevronRight, Flag, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import type { MilestoneDTO } from "@vistoo/domain";
import { formatShortDate } from "@vistoo/domain/dates";
import { MilestoneDialog } from "./milestone-dialog";

/** Overview: open milestones (by due date) with progress; completed ones collapsed. */
export function MilestoneList({ milestones }: { milestones: MilestoneDTO[] }) {
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [showCompleted, setShowCompleted] = useState(false);
  const open = milestones.filter((m) => !m.completed);
  const completed = milestones.filter((m) => m.completed);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Meilensteine</h1>
        <Button className="h-8" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Meilenstein erstellen
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Ziele mit Termin, z. B. ein Launch. Issues aus allen Projekten lassen sich einem Meilenstein zuordnen.
      </p>

      {open.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed px-6 py-12 text-center">
          <Flag className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
          <h2 className="font-semibold">Keine offenen Meilensteine</h2>
          <p className="mt-1 text-sm text-muted-foreground">Lege einen an und ordne ihm Issues zu.</p>
          <Button className="mt-5" onClick={() => setCreating(true)}>
            Ersten Meilenstein erstellen
          </Button>
        </div>
      ) : (
        <ul className="mt-6 divide-y rounded-xl border" aria-label="Offene Meilensteine">
          {open.map((m) => (
            <MilestoneRow key={m.id} milestone={m} />
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <div className="mt-8">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            aria-expanded={showCompleted}
            aria-controls="completed-milestones"
            onClick={() => setShowCompleted((v) => !v)}
          >
            <ChevronRight className={showCompleted ? "rotate-90 transition-transform" : "transition-transform"} aria-hidden />
            Abgeschlossen ({completed.length})
          </Button>
          {showCompleted && (
            <ul id="completed-milestones" className="mt-2 divide-y rounded-xl border">
              {completed.map((m) => (
                <MilestoneRow key={m.id} milestone={m} />
              ))}
            </ul>
          )}
        </div>
      )}

      <MilestoneDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function MilestoneRow({ milestone: m }: { milestone: MilestoneDTO }) {
  const today = useToday();
  const overdue = !m.completed && today !== null && m.dueDate !== null && m.dueDate < today;
  const percent = m.total === 0 ? 0 : Math.round((m.done / m.total) * 100);
  return (
    <li className="relative flex items-center gap-3 px-4 py-3.5 hover:bg-surface-subtle">
      <Flag className={cn("size-4 shrink-0", m.completed ? "text-muted-foreground" : "text-accent-blue")} aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          href={`/milestones/${m.id}`}
          className={cn(
            "block truncate text-[15px] font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/35",
            m.completed && "text-muted-foreground",
          )}
        >
          {m.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {m.dueDate && (
            <span className={cn("tabular-nums", overdue && "font-medium text-destructive")}>
              {overdue ? "Überfällig · " : "Bis "}
              {formatShortDate(m.dueDate)}
            </span>
          )}
          {m.dueDate && m.description && " · "}
          {m.description || (!m.dueDate && "Kein Zieldatum")}
        </p>
      </div>
      <div className="hidden w-36 shrink-0 sm:block">
        <p className="text-right text-sm text-muted-foreground tabular-nums">
          {m.total === 0 ? "Keine Aufgaben" : `${m.done} von ${m.total} erledigt`}
        </p>
        {m.total > 0 && (
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-subtle"
            role="progressbar"
            aria-label={`Fortschritt ${m.name}`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent-blue" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}
