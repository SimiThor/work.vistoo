"use client";

import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteMeetingAction, getMeetingAction } from "@/app/actions/meetings";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { MemberAvatar } from "@/components/member-avatar";
import { peopleMap } from "@/components/member-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO, type ProjectDTO } from "@vistoo/domain";
import {
  formatDuration,
  formatMeetingDay,
  formatMeetingTimeRange,
  googleCalendarUrl,
  isRunning,
  MEETING_PROVIDER_LABEL,
  meetingProvider,
  type AgendaItemDTO,
  type MeetingDetailDTO,
  type MeetingDTO,
} from "@vistoo/domain/meetings";
import { Agenda } from "./agenda";
import { MeetingDialog } from "./meeting-dialog";
import { useMeetingSignals, useNow } from "./shared";

export function MeetingDetail({
  initial,
  serverNow,
  workspaceId,
  members,
  former,
  projects,
  meId,
  teamMeetingUrl,
}: {
  initial: MeetingDetailDTO;
  serverNow: string;
  workspaceId: string;
  members: MemberDTO[];
  former: MemberDTO[];
  projects: ProjectDTO[];
  meId: string;
  teamMeetingUrl: string | null;
}) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<MeetingDTO>(initial.meeting);
  const [agenda, setAgendaState] = useState<AgendaItemDTO[]>(initial.agenda);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pendingIds = useRef(new Set<string>());
  const deleted = useRef(false);
  const people = useMemo(() => peopleMap(members, former), [members, former]);
  const now = useNow(serverNow);

  const setAgenda = useCallback((update: (prev: AgendaItemDTO[]) => AgendaItemDTO[]) => setAgendaState(update), []);

  // Changes by teammates (Realtime signal, reconnect, tab visible again): reload from the server.
  const reload = useCallback(async () => {
    const res = await getMeetingAction({ id: initial.meeting.id });
    if (deleted.current) return;
    if (!res.ok) {
      if (res.error.code === "NOT_FOUND") {
        toast.info("Dieses Meeting wurde gelöscht.");
        router.push("/meetings");
      }
      return;
    }
    setMeeting(res.data.meeting);
    setAgendaState((prev) => {
      // Keep points that are still being created by me.
      const optimistic = prev.filter((i) => pendingIds.current.has(i.id) && !res.data.agenda.some((s) => s.id === i.id));
      return [...res.data.agenda, ...optimistic];
    });
  }, [initial.meeting.id, router]);
  useMeetingSignals(workspaceId, reload);

  const minutes = Math.round((new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime()) / 60_000);
  const running = isRunning(meeting, now);
  const past = new Date(meeting.endsAt).getTime() <= now.getTime();
  const provider = meeting.meetingUrl ? meetingProvider(meeting.meetingUrl) : null;

  return (
    <div className="pb-16">
      <Link
        href="/meetings"
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Meetings
      </Link>

      <header className="mt-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{meeting.title}</h1>
              {running && (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent-blue-soft px-2.5 text-xs font-medium text-accent-blue-text">
                  <span aria-hidden className="size-1.5 rounded-full bg-accent-blue" />
                  Läuft gerade
                </span>
              )}
              {past && <span className="inline-flex h-6 items-center rounded-full bg-surface-subtle px-2.5 text-xs text-muted-foreground">Vergangen</span>}
            </div>
            <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Datum</dt>
                <CalendarDays className="size-4" aria-hidden />
                <dd>{formatMeetingDay(meeting.startsAt)}</dd>
              </div>
              <div className="flex items-center gap-1.5 tabular-nums">
                <dt className="sr-only">Uhrzeit</dt>
                <Clock className="size-4" aria-hidden />
                <dd>
                  {formatMeetingTimeRange(meeting.startsAt, meeting.endsAt)}
                  <span className="text-muted-foreground/70"> · {formatDuration(minutes)}</span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {meeting.meetingUrl && (
              <Button asChild variant={past ? "outline" : "default"}>
                <a href={meeting.meetingUrl} target="_blank" rel="noopener noreferrer">
                  <Video aria-hidden />
                  Meeting beitreten
                  <span className="sr-only">
                    {provider && provider !== "web" ? ` (${MEETING_PROVIDER_LABEL[provider]}, ` : " ("}öffnet in neuem Tab)
                  </span>
                </a>
              </Button>
            )}
            <CalendarMenu meeting={meeting} agenda={agenda} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Weitere Aktionen">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  Bearbeiten
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden />
                  Meeting löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Participants ids={meeting.participantIds} people={people} onEdit={() => setEditing(true)} />

        {meeting.description.trim() && (
          <MarkdownView source={meeting.description} className="mt-5 max-w-3xl text-sm text-foreground/85" disabled />
        )}
      </header>

      <Agenda
        meeting={meeting}
        agenda={agenda}
        setAgenda={setAgenda}
        pendingIds={pendingIds}
        members={members}
        people={people}
        projects={projects}
        meId={meId}
      />

      <MeetingDialog
        open={editing}
        onOpenChange={setEditing}
        meeting={meeting}
        members={members}
        people={people}
        meId={meId}
        teamMeetingUrl={teamMeetingUrl}
        onSaved={setMeeting}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Meeting löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{meeting.title}“ wird mit Agenda und festgehaltenen Ergebnissen für alle gelöscht. Verknüpfte Issues und
              Entscheidungen bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const res = await deleteMeetingAction({ id: meeting.id });
                if (!res.ok && res.error.code !== "NOT_FOUND") return void toast.error(res.error.message);
                deleted.current = true;
                toast.success("Meeting gelöscht");
                router.push("/meetings");
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Participants({ ids, people, onEdit }: { ids: string[]; people: Map<string, MemberDTO>; onEdit: () => void }) {
  if (ids.length === 0) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 rounded-md text-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/35"
      >
        Teilnehmende hinzufügen
      </button>
    );
  }
  return (
    <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label="Teilnehmende">
      {ids.map((id) => {
        const m = people.get(id);
        return (
          <li
            key={id}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border bg-background py-0.5 pr-2.5 pl-0.5 text-[13px]",
              !m && "text-muted-foreground",
            )}
          >
            <MemberAvatar member={m ?? { fullName: "?", email: "?" }} size="sm" />
            {m ? displayName(m) : "Ehemaliges Mitglied"}
          </li>
        );
      })}
    </ul>
  );
}

/** "Zum Kalender": .ics download (Apple Calendar, Outlook, …) or a prefilled Google Calendar event. */
function CalendarMenu({ meeting, agenda }: { meeting: MeetingDTO; agenda: AgendaItemDTO[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <CalendarPlus aria-hidden />
          <span className="hidden md:inline">Zum Kalender</span>
          <span className="sr-only md:hidden">Zum Kalender hinzufügen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem asChild>
          <a href={`/meetings/${meeting.id}/ics`} download>
            <Download aria-hidden />
            <span className="flex flex-col">
              Kalenderdatei (.ics)
              <span className="text-xs text-muted-foreground">Apple Kalender, Outlook, Thunderbird</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const url = googleCalendarUrl(meeting, {
              agendaTitles: agenda.map((i) => i.title),
              pageUrl: `${window.location.origin}/meetings/${meeting.id}`,
            });
            window.open(url, "_blank", "noopener,noreferrer");
          }}
        >
          <ExternalLink aria-hidden />
          <span className="flex flex-col">
            Google Kalender
            <span className="text-xs text-muted-foreground">Termin vorausgefüllt anlegen</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
