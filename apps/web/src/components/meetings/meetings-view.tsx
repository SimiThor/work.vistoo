"use client";

import { CalendarDays, ChevronRight, ListChecks, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { listMeetingsAction } from "@/app/actions/meetings";
import { peopleMap } from "@/components/member-select";
import { SearchField } from "@/components/search-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MemberDTO } from "@vistoo/domain";
import {
  formatDuration,
  formatMeetingDayShort,
  formatMeetingTimeRange,
  isRunning,
  splitMeetings,
  type MeetingSummaryDTO,
} from "@vistoo/domain/meetings";
import { MeetingDialog } from "./meeting-dialog";
import { AvatarStack, DateTile, useMeetingSignals, useNow } from "./shared";

const PAST_PAGE = 20;

/**
 * "Meetings": upcoming (soonest first) and past (latest first) as calm
 * lists, a title search and "Neues Meeting". A click opens the meeting with
 * its agenda.
 */
export function MeetingsView({
  initial,
  serverNow,
  workspaceId,
  members,
  former,
  meId,
  teamMeetingUrl,
}: {
  initial: MeetingSummaryDTO[];
  serverNow: string;
  workspaceId: string;
  members: MemberDTO[];
  former: MemberDTO[];
  meId: string;
  teamMeetingUrl: string | null;
}) {
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [pastShown, setPastShown] = useState(PAST_PAGE);
  const people = useMemo(() => peopleMap(members, former), [members, former]);
  const now = useNow(serverNow);

  // Someone else planned, changed or deleted a meeting: reload the list.
  const reload = useCallback(async () => {
    const res = await listMeetingsAction();
    if (res.ok) setItems(res.data);
  }, []);
  useMeetingSignals(workspaceId, reload);

  const q = query.trim().toLocaleLowerCase("de");
  const filtered = q ? items.filter((m) => m.title.toLocaleLowerCase("de").includes(q)) : items;
  const { upcoming, past } = splitMeetings(filtered, now);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Planen, Agenda gemeinsam vorbereiten, Ergebnisse festhalten.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus aria-hidden />
          <span className="hidden sm:inline">Neues Meeting</span>
          <span className="sr-only sm:hidden">Neues Meeting</span>
        </Button>
      </div>

      {items.length > 0 && (
        <div className="mt-5 max-w-xs">
          <SearchField value={query} onChange={setQuery} label="Meetings nach Titel durchsuchen" placeholder="Meetings suchen …" />
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed px-4 py-12 text-center" role="status">
          <CalendarDays className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Noch keine Meetings</p>
          <p className="mt-1 text-sm text-muted-foreground">Plane das erste Meeting – Titel und Uhrzeit genügen, die Agenda folgt gemeinsam.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Neues Meeting
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" role="status">
          Kein Meeting mit „{query.trim()}“ im Titel.
        </p>
      ) : (
        <>
          <Section title="Anstehend" count={upcoming.length}>
            {upcoming.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{q ? "Keine anstehenden Treffer." : "Nichts geplant."}</p>
            ) : (
              upcoming.map((m) => <MeetingRow key={m.id} meeting={m} people={people} running={isRunning(m, now)} />)
            )}
          </Section>
          {past.length > 0 && (
            <Section title="Vergangen" count={past.length}>
              {past.slice(0, pastShown).map((m) => (
                <MeetingRow key={m.id} meeting={m} people={people} past />
              ))}
              {past.length > pastShown && (
                <button
                  type="button"
                  onClick={() => setPastShown((n) => n + PAST_PAGE)}
                  className="w-full px-4 py-2.5 text-left text-sm text-muted-foreground outline-none hover:bg-surface-subtle/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
                >
                  Weitere {Math.min(PAST_PAGE, past.length - pastShown)} anzeigen
                </button>
              )}
            </Section>
          )}
        </>
      )}

      <MeetingDialog
        open={creating}
        onOpenChange={setCreating}
        members={members}
        people={people}
        meId={meId}
        teamMeetingUrl={teamMeetingUrl}
      />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-7" aria-label={title}>
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-medium text-muted-foreground">
        {title}
        <span className="text-xs font-normal text-muted-foreground/70 tabular-nums">{count}</span>
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border">{children}</ul>
    </section>
  );
}

function MeetingRow({
  meeting: m,
  people,
  past,
  running,
}: {
  meeting: MeetingSummaryDTO;
  people: Map<string, MemberDTO>;
  past?: boolean;
  running?: boolean;
}) {
  const minutes = Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000);
  const allDiscussed = m.agendaCount > 0 && m.discussedCount === m.agendaCount;
  return (
    <li>
      <Link
        href={`/meetings/${m.id}`}
        className="group flex items-center gap-3.5 px-3 py-3 outline-none hover:bg-surface-subtle/60 focus-visible:bg-surface-subtle/60 focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:ring-inset sm:px-4"
      >
        <DateTile iso={m.startsAt} muted={past} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate text-sm font-medium", past && "text-foreground/80")}>{m.title}</span>
            {running && (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-blue-soft px-2 text-[11px] font-medium text-accent-blue-text">
                <span aria-hidden className="size-1.5 rounded-full bg-accent-blue" />
                Läuft
              </span>
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <span className="truncate">
              {formatMeetingDayShort(m.startsAt)} · {formatMeetingTimeRange(m.startsAt, m.endsAt)}
              <span className="hidden sm:inline"> · {formatDuration(minutes)}</span>
            </span>
            {m.meetingUrl && <Video className="size-3.5 shrink-0" aria-label="mit Meeting-Link" role="img" />}
          </span>
        </span>
        <AvatarStack ids={m.participantIds} people={people} className="hidden sm:flex" />
        <span
          className={cn(
            "flex w-12 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground tabular-nums",
            allDiscussed && "text-status-done",
          )}
          title={`${m.agendaCount} Agenda-Punkte${m.agendaCount ? `, ${m.discussedCount} besprochen` : ""}`}
        >
          <ListChecks className="size-3.5" aria-hidden />
          <span className="sr-only">Agenda-Punkte:</span>
          {past && m.agendaCount ? `${m.discussedCount}/${m.agendaCount}` : m.agendaCount}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
