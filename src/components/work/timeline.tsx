"use client";

import { CalendarPlus, ChevronDown } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProjectDot } from "@/components/project-dot";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import {
  durationDays,
  formatDayOfMonth,
  formatLongDate,
  formatMonthYear,
  formatShortDate,
  formatWeekdayShort,
  fromDayNumber,
  isoWeek,
  isWeekend,
  startOfWeek,
  toDayNumber,
} from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABEL, type TaskDTO, type TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { Scale } from "./filters";
import { useWork } from "./work-context";

const DAY_WIDTH: Record<Scale, number> = { day: 36, week: 14 };

const BAR_CLASS: Record<TaskStatus, string> = {
  open: "bg-[#f0f1f4] border-[#d6d8de] text-foreground",
  in_progress: "bg-accent-blue-soft border-[#b9d3f3] text-foreground",
  in_review: "bg-[#fbf2e3] border-[#ead3ab] text-foreground",
  done: "bg-surface-subtle border-border text-muted-foreground",
};

type Row = { kind: "group"; key: string; label: string; color?: string } | { kind: "task"; task: TaskDTO };

type TimelineProps = {
  /** Already filtered; same objects as the board. */
  tasks: TaskDTO[];
  scale: Scale;
  onOpen: (id: string, focus?: "dates") => void;
};

export function Timeline(props: TimelineProps) {
  // "Today" depends on the viewer's time zone: render after hydration.
  const todayIsoValue = useToday();
  if (!todayIsoValue) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 sm:px-6" aria-busy="true" aria-label="Zeitachse wird geladen">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="min-h-64 w-full flex-1 rounded-xl" />
      </div>
    );
  }
  return <TimelineInner {...props} today={toDayNumber(todayIsoValue)} />;
}

function TimelineInner({ tasks, scale, onOpen, today }: TimelineProps & { today: number }) {
  const { scope, projectById } = useWork();
  const W = DAY_WIDTH[scale];

  const planned = useMemo(() => tasks.filter((t) => t.startDate && t.endDate), [tasks]);
  const unplanned = useMemo(() => tasks.filter((t) => !(t.startDate && t.endDate)), [tasks]);

  const { start, days } = useMemo(() => {
    let min = today;
    let max = today;
    for (const t of planned) {
      min = Math.min(min, toDayNumber(t.startDate!));
      max = Math.max(max, toDayNumber(t.endDate!));
    }
    const s = startOfWeek(min - (scale === "day" ? 7 : 14));
    const e = startOfWeek(max + (scale === "day" ? 21 : 56)) + 6;
    return { start: s, days: e - s + 1 };
  }, [planned, today, scale]);

  const rows = useMemo<Row[]>(() => {
    const sorted = [...planned].sort(
      (a, b) => a.startDate!.localeCompare(b.startDate!) || a.endDate!.localeCompare(b.endDate!) || a.title.localeCompare(b.title, "de"),
    );
    const out: Row[] = [];
    if (scope.kind === "all") {
      const byProject = new Map<string, TaskDTO[]>();
      for (const t of sorted) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);
      const ordered = [...byProject.keys()].sort((a, b) =>
        (projectById.get(a)?.name ?? "").localeCompare(projectById.get(b)?.name ?? "", "de"),
      );
      for (const pid of ordered) {
        const p = projectById.get(pid);
        out.push({ kind: "group", key: pid, label: p?.name ?? "Projekt", color: p?.color });
        for (const t of byProject.get(pid)!) out.push({ kind: "task", task: t });
      }
    } else {
      const project = projectById.get(scope.projectId);
      const groups = project?.groups ?? [];
      const byGroup = new Map<string | null, TaskDTO[]>();
      for (const t of sorted) {
        const g = groups.some((x) => x.id === t.groupId) ? t.groupId : null;
        byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
      }
      const hasGroups = [...byGroup.keys()].some((k) => k !== null);
      for (const g of groups) {
        const list = byGroup.get(g.id);
        if (!list) continue;
        out.push({ kind: "group", key: g.id, label: g.name });
        for (const t of list) out.push({ kind: "task", task: t });
      }
      const ungrouped = byGroup.get(null);
      if (ungrouped) {
        if (hasGroups) out.push({ kind: "group", key: "none", label: "Ohne Gruppe" });
        for (const t of ungrouped) out.push({ kind: "task", task: t });
      }
    }
    return out;
  }, [planned, scope, projectById]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToToday = (behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    const nameCol = el.querySelector<HTMLElement>("[data-name-col]")?.offsetWidth ?? 0;
    const target = (today - start) * W - (el.clientWidth - nameCol) / 3;
    el.scrollTo({ left: Math.max(0, target), behavior });
  };
  // Center on today on mount and whenever the scale changes.
  useLayoutEffect(() => {
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, start]);

  const trackWidth = days * W;
  // Range always starts on a Monday, so weekends repeat at fixed offsets.
  const gridBackground = {
    backgroundImage: [
      `repeating-linear-gradient(90deg, transparent 0 ${5 * W}px, var(--surface-subtle) ${5 * W}px ${7 * W}px)`,
      `repeating-linear-gradient(90deg, var(--border) 0 1px, transparent 1px ${7 * W}px)`,
    ].join(","),
  };
  const todayLeft = (today - start) * W;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 sm:px-6">
      <UnplannedSection tasks={unplanned} onOpen={onOpen} />

      {planned.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Keine Aufgabe hat bisher einen vollständigen Zeitraum. Öffne eine Aufgabe und setze Start- und Enddatum.
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-auto overscroll-x-contain"
            role="region"
            aria-label="Zeitachse"
            tabIndex={0}
          >
            <div style={{ width: `max-content` }} className="relative">
              {/* Header */}
              <div className="sticky top-0 z-30 flex border-b bg-background">
                <div
                  data-name-col
                  className="sticky left-0 z-10 flex w-40 shrink-0 items-end justify-between gap-2 border-r bg-background px-3 pb-2 text-xs font-medium text-muted-foreground sm:w-64"
                >
                  <span>Aufgabe</span>
                  <Button variant="outline" size="xs" onClick={() => scrollToToday("smooth")}>
                    Heute
                  </Button>
                </div>
                <TimeHeader start={start} days={days} W={W} scale={scale} today={today} />
              </div>

              {/* Rows */}
              <ul aria-label="Geplante Aufgaben">
                {rows.map((row) =>
                  row.kind === "group" ? (
                    <li key={`g-${row.key}`} className="flex h-8 border-b bg-background" aria-hidden>
                      <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center gap-2 border-r bg-background px-3 text-xs font-semibold text-muted-foreground sm:w-64">
                        {row.color && <ProjectDot color={row.color} />}
                        <span className="truncate">{row.label}</span>
                      </div>
                      <div style={{ width: trackWidth, ...gridBackground }} className="relative">
                        <TodayLine left={todayLeft} W={W} />
                      </div>
                    </li>
                  ) : (
                    <TaskRow
                      key={row.task.id}
                      task={row.task}
                      start={start}
                      W={W}
                      trackWidth={trackWidth}
                      gridBackground={gridBackground}
                      todayLeft={todayLeft}
                      onOpen={onOpen}
                    />
                  ),
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TodayLine({ left, W }: { left: number; W: number }) {
  return <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent-blue/70" style={{ left: left + W / 2 - 1 }} />;
}

function TaskRow({
  task,
  start,
  W,
  trackWidth,
  gridBackground,
  todayLeft,
  onOpen,
}: {
  task: TaskDTO;
  start: number;
  W: number;
  trackWidth: number;
  gridBackground: React.CSSProperties;
  todayLeft: number;
  onOpen: (id: string) => void;
}) {
  const s = toDayNumber(task.startDate!);
  const e = toDayNumber(task.endDate!);
  const left = (s - start) * W + 2;
  const width = Math.max((e - s + 1) * W - 4, W - 4);
  const duration = durationDays(task.startDate!, task.endDate!);
  const range =
    task.startDate === task.endDate
      ? formatLongDate(task.startDate!)
      : `${formatLongDate(task.startDate!)} bis ${formatLongDate(task.endDate!)}`;

  return (
    <li className="group flex h-10 border-b last:border-b-0">
      <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center border-r bg-background group-hover:bg-surface-subtle sm:w-64">
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="flex h-full w-full min-w-0 items-center gap-2 px-3 text-left text-[13px] outline-none focus-visible:bg-accent-blue-soft"
        >
          <StatusIcon status={task.status} />
          <span className="truncate">{task.title}</span>
          <span className="sr-only">
            , {range}, {duration === 1 ? "1 Tag" : `${duration} Tage`}, Status {STATUS_LABEL[task.status]}
          </span>
        </button>
      </div>
      <div style={{ width: trackWidth, ...gridBackground }} className="relative">
        <TodayLine left={todayLeft} W={W} />
        {/* Mouse/touch target; keyboard users use the name button (same action). */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => onOpen(task.id)}
          title={`${task.title} · ${formatShortDate(task.startDate!)} – ${formatShortDate(task.endDate!)}`}
          className={cn(
            "absolute top-1.5 flex h-7 items-center gap-1.5 overflow-hidden rounded-md border px-1.5 text-xs font-medium shadow-card transition-[filter] hover:brightness-[0.97]",
            BAR_CLASS[task.status],
          )}
          style={{ left, width }}
        >
          {width >= 24 && <StatusIcon status={task.status} className="size-3" />}
          {width > 64 && <span className="truncate">{task.title}</span>}
        </button>
      </div>
    </li>
  );
}

function TimeHeader({
  start,
  days,
  W,
  scale,
  today,
}: {
  start: number;
  days: number;
  W: number;
  scale: Scale;
  today: number;
}) {
  const months: { label: string; from: number; len: number }[] = [];
  for (let d = start; d < start + days; d++) {
    const label = formatMonthYear(d);
    const last = months.at(-1);
    if (last && last.label === label) last.len++;
    else months.push({ label, from: d, len: 1 });
  }
  return (
    <div style={{ width: days * W }} aria-hidden>
      <div className="flex h-7 border-b">
        {months.map((m) => (
          <div
            key={m.from}
            style={{ width: m.len * W }}
            className="truncate border-l px-2 pt-1.5 text-xs font-medium first:border-l-0"
          >
            {m.len * W > 70 ? m.label : ""}
          </div>
        ))}
      </div>
      <div className="flex h-9">
        {scale === "day"
          ? Array.from({ length: days }, (_, i) => {
              const d = start + i;
              const isToday = d === today;
              return (
                <div
                  key={d}
                  style={{ width: W }}
                  className={cn(
                    "flex flex-col items-center justify-center text-[10px] leading-tight text-muted-foreground",
                    isWeekend(d) && "bg-surface-subtle",
                  )}
                >
                  <span>{formatWeekdayShort(d)}</span>
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums text-foreground",
                      isToday && "bg-accent-blue font-semibold text-white",
                    )}
                  >
                    {formatDayOfMonth(d)}
                  </span>
                </div>
              );
            })
          : Array.from({ length: Math.ceil(days / 7) }, (_, i) => {
              const d = start + i * 7;
              const containsToday = today >= d && today < d + 7;
              return (
                <div
                  key={d}
                  style={{ width: 7 * W }}
                  className={cn(
                    "flex flex-col justify-center border-l px-1.5 text-[10px] leading-tight text-muted-foreground first:border-l-0",
                    containsToday && "text-accent-blue-text",
                  )}
                >
                  <span className="font-medium">KW {isoWeek(d)}</span>
                  <span className="tabular-nums">{formatShortDate(fromDayNumber(d)).replace(/\s\d{4}$/, "")}</span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

function UnplannedSection({ tasks, onOpen }: { tasks: TaskDTO[]; onOpen: (id: string, focus?: "dates") => void }) {
  const [open, setOpen] = useState(true);
  if (tasks.length === 0) return null;
  return (
    <section aria-labelledby="unplanned-heading" className="shrink-0 rounded-xl border bg-background">
      <h2 id="unplanned-heading">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="unplanned-list"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold"
        >
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
          Nicht vollständig geplant
          <span className="font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
        </button>
      </h2>
      {open && (
        <ul id="unplanned-list" className="max-h-48 overflow-y-auto border-t">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
              <StatusIcon status={t.status} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[13px] hover:underline"
                onClick={() => onOpen(t.id)}
              >
                {t.title}
              </button>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {t.startDate ? `Nur Start: ${formatShortDate(t.startDate)}` : t.endDate ? `Nur Ende: ${formatShortDate(t.endDate)}` : "Ohne Termine"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-accent-blue-text"
                onClick={() => onOpen(t.id, "dates")}
                aria-label={`Termine für „${t.title}“ setzen`}
              >
                <CalendarPlus aria-hidden />
                <span className="hidden sm:inline">Termine setzen</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
