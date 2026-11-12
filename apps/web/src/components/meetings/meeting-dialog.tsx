"use client";

import { ChevronDown, Link2, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createMeetingAction, updateMeetingAction } from "@/app/actions/meetings";
import { MemberPicker } from "@/components/chat/member-picker";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import {
  addMinutes,
  formatDuration,
  instantToWallTime,
  MEETING_LIMITS,
  MEETING_PROVIDER_LABEL,
  meetingProvider,
  meetingTimesSchema,
  minutesBetween,
  type MeetingDTO,
} from "@vistoo/domain/meetings";
import { AvatarStack } from "./shared";

const DURATIONS = [15, 30, 45, 60, 90];
const DEFAULT_DURATION = 30;
const APP_TZ_HINT = "Zeiten in Berliner Zeit";

type Values = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  participantIds: string[];
  meetingUrl: string;
  description: string;
};

/** Next full half hour in the team's time zone (e.g. 14:07 → 14:30). */
function defaultTimes(now = new Date()): Pick<Values, "date" | "startTime" | "endTime"> {
  const next = new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000);
  let { date, time } = instantToWallTime(next);
  // Late evening: suggest tomorrow morning instead of a meeting cut off at midnight.
  if (time >= "23:00" || time < "07:00") {
    const tomorrow = instantToWallTime(new Date(next.getTime() + (time >= "23:00" ? 86_400_000 : 0)));
    date = tomorrow.date;
    time = "10:00";
  }
  return { date, startTime: time, endTime: addMinutes(time, DEFAULT_DURATION) };
}

function valuesOf(m: MeetingDTO): Values {
  const start = instantToWallTime(m.startsAt);
  return {
    title: m.title,
    date: start.date,
    startTime: start.time,
    endTime: instantToWallTime(m.endsAt).time,
    participantIds: m.participantIds,
    meetingUrl: m.meetingUrl ?? "",
    description: m.description,
  };
}

/** Create or edit a meeting. Creating needs only a title: date and time are prefilled. */
export function MeetingDialog({
  open,
  onOpenChange,
  meeting,
  members,
  people,
  meId,
  teamMeetingUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode when set. */
  meeting?: MeetingDTO;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  meId: string;
  /** The workspace's standing meeting room (sidebar "Besprechung"), offered as a one-click link. */
  teamMeetingUrl: string | null;
  onSaved?: (m: MeetingDTO) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <MeetingForm
            meeting={meeting}
            members={members}
            people={people}
            meId={meId}
            teamMeetingUrl={teamMeetingUrl}
            onDone={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MeetingForm({
  meeting,
  members,
  people,
  meId,
  teamMeetingUrl,
  onDone,
  onSaved,
}: {
  meeting?: MeetingDTO;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  meId: string;
  teamMeetingUrl: string | null;
  onDone: () => void;
  onSaved?: (m: MeetingDTO) => void;
}) {
  const router = useRouter();
  const [base, setBase] = useState<{ values: Values; version: number } | null>(() =>
    meeting ? { values: valuesOf(meeting), version: meeting.version } : null,
  );
  const [values, setValues] = useState<Values>(
    () =>
      base?.values ?? {
        title: "",
        ...defaultTimes(),
        participantIds: members.some((m) => m.userId === meId) ? [meId] : [],
        meetingUrl: "",
        description: "",
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showDescription, setShowDescription] = useState(Boolean(meeting?.description));
  const [clientId] = useState(() => crypto.randomUUID());
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    const key = k === "startTime" || k === "endTime" || k === "date" ? `times.${k}` : k;
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
    setFormError(null);
  };

  const duration = minutesBetween(values.startTime, values.endTime);
  /** Moving the start keeps the duration (like every calendar app). */
  const setStart = (startTime: string) => {
    const keep = duration > 0 ? duration : DEFAULT_DURATION;
    setValues((prev) => ({ ...prev, startTime, endTime: startTime ? addMinutes(startTime, keep) : prev.endTime }));
    setErrors((e) => ({ ...e, "times.startTime": "", "times.endTime": "" }));
  };

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  const submit = () => {
    const next: Record<string, string> = {};
    if (!values.title.trim()) next.title = "Bitte gib einen Titel ein.";
    const times = meetingTimesSchema.safeParse({ date: values.date, startTime: values.startTime, endTime: values.endTime });
    if (!times.success) for (const issue of times.error.issues) next[`times.${String(issue.path[0])}`] ??= issue.message;
    if (Object.keys(next).length) return setErrors(next);
    if (pending) return;

    const payload = {
      title: values.title,
      times: { date: values.date, startTime: values.startTime, endTime: values.endTime },
      participantIds: values.participantIds,
      meetingUrl: values.meetingUrl.trim() ? values.meetingUrl.trim() : null,
      description: values.description,
    };

    startTransition(async () => {
      if (!meeting || !base) {
        const res = await createMeetingAction({ id: clientId, ...payload });
        if (!res.ok) {
          if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
          return setFormError(res.error.fieldErrors ? null : res.error.message);
        }
        onDone();
        router.push(`/meetings/${res.data.id}`);
        return;
      }
      // Only changed fields: a concurrent edit of another field is not overwritten.
      const b = base.values;
      const patch: Record<string, unknown> = {};
      if (payload.title.trim() !== b.title.trim()) patch.title = payload.title;
      if (values.date !== b.date || values.startTime !== b.startTime || values.endTime !== b.endTime) patch.times = payload.times;
      if ([...values.participantIds].sort().join() !== [...b.participantIds].sort().join()) patch.participantIds = payload.participantIds;
      if ((payload.meetingUrl ?? "") !== b.meetingUrl) patch.meetingUrl = payload.meetingUrl;
      if (payload.description !== b.description) patch.description = payload.description;
      if (Object.keys(patch).length === 0) return onDone();

      const res = await updateMeetingAction({ id: meeting.id, version: base.version, patch });
      if (!res.ok) {
        if (res.error.code === "CONFLICT" && res.error.current) {
          const current = res.error.current as MeetingDTO;
          setBase({ values: valuesOf(current), version: current.version });
          onSaved?.(current);
          return setFormError(
            "Jemand anderes hat das Meeting gerade geändert. Deine Eingaben sind noch da – prüfe sie und speichere erneut.",
          );
        }
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        return setFormError(res.error.fieldErrors ? null : res.error.message);
      }
      onSaved?.(res.data);
      toast.success("Gespeichert");
      onDone();
    });
  };

  const provider = values.meetingUrl.trim() ? meetingProvider(values.meetingUrl.trim().replace(/^(?!https?:\/\/)/, "https://")) : null;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{meeting ? "Meeting bearbeiten" : "Neues Meeting"}</DialogTitle>
        <DialogDescription className="sr-only">Titel, Termin, Teilnehmende und optional Link und Beschreibung.</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor={fid("title")}>Titel</Label>
        <Input
          id={fid("title")}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={MEETING_LIMITS.titleMax}
          placeholder="z. B. Weekly Sync"
          aria-invalid={Boolean(errors.title) || undefined}
          aria-describedby={errors.title ? `${fid("title")}-error` : undefined}
          autoFocus
          autoComplete="off"
        />
        <FieldError id={`${fid("title")}-error`} message={errors.title} />
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Termin</legend>
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={fid("date")}>Datum</Label>
            <Input
              id={fid("date")}
              type="date"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              aria-invalid={Boolean(errors["times.date"]) || undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fid("start")}>Beginn</Label>
            <Input
              id={fid("start")}
              type="time"
              step={300}
              value={values.startTime}
              onChange={(e) => setStart(e.target.value)}
              className="w-[6.75rem] tabular-nums"
              aria-invalid={Boolean(errors["times.startTime"]) || undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fid("end")}>Ende</Label>
            <Input
              id={fid("end")}
              type="time"
              step={300}
              value={values.endTime}
              onChange={(e) => set("endTime", e.target.value)}
              className="w-[6.75rem] tabular-nums"
              aria-invalid={Boolean(errors["times.endTime"]) || undefined}
              aria-describedby={errors["times.endTime"] ? `${fid("end")}-error` : undefined}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Dauer</span>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => values.startTime && set("endTime", addMinutes(values.startTime, d))}
              aria-pressed={duration === d}
              className={cn(
                "h-6 rounded-full border px-2.5 text-xs text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35",
                duration === d && "border-transparent bg-accent-blue-soft font-medium text-accent-blue-text",
              )}
            >
              {formatDuration(d)}
            </button>
          ))}
          {duration > 0 && !DURATIONS.includes(duration) && (
            <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(duration)}</span>
          )}
        </div>
        <FieldError id={`${fid("end")}-error`} message={errors["times.endTime"] || errors["times.startTime"] || errors["times.date"]} />
        {browserTz && browserTz !== "Europe/Berlin" && <p className="text-xs text-muted-foreground">{APP_TZ_HINT} (Europe/Berlin).</p>}
      </fieldset>

      <div className="space-y-1.5">
        <Label id={fid("participants-label")}>
          Teilnehmende <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <ParticipantsField
          labelledBy={fid("participants-label")}
          value={values.participantIds}
          onChange={(ids) => set("participantIds", ids)}
          members={members}
          people={people}
        />
        <FieldError id={`${fid("participants")}-error`} message={errors.participantIds} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fid("url")}>
          Meeting-Link <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <div className="relative">
          <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={fid("url")}
            value={values.meetingUrl}
            onChange={(e) => set("meetingUrl", e.target.value)}
            placeholder="Discord, Google Meet, Teams, Zoom …"
            inputMode="url"
            autoComplete="off"
            className="pl-8"
            aria-invalid={Boolean(errors.meetingUrl) || undefined}
            aria-describedby={errors.meetingUrl ? `${fid("url")}-error` : undefined}
          />
          {provider && provider !== "web" && (
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
              {MEETING_PROVIDER_LABEL[provider]}
            </span>
          )}
        </div>
        {!values.meetingUrl && teamMeetingUrl && (
          <Button type="button" variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={() => set("meetingUrl", teamMeetingUrl)}>
            <Plus aria-hidden />
            Team-Raum verwenden ({MEETING_PROVIDER_LABEL[meetingProvider(teamMeetingUrl)]})
          </Button>
        )}
        <FieldError id={`${fid("url")}-error`} message={errors.meetingUrl} />
      </div>

      {showDescription ? (
        <div className="space-y-1.5">
          <Label htmlFor={fid("description")}>
            Beschreibung <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <MarkdownEditor
            id={fid("description")}
            value={values.description}
            onChange={(v) => set("description", v)}
            autoFocus={!meeting}
            placeholder="Ziel des Meetings, Kontext, Links …"
          />
          <FieldError id={`${fid("description")}-error`} message={errors.description} />
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setShowDescription(true)}>
          <Plus aria-hidden />
          Beschreibung hinzufügen
        </Button>
      )}

      <FormAlert message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {meeting ? "Speichern" : "Meeting erstellen"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Button with the chosen people; opens the searchable member list (multi-select). */
function ParticipantsField({
  labelledBy,
  value,
  onChange,
  members,
  people,
}: {
  labelledBy: string;
  value: string[];
  onChange: (ids: string[]) => void;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
}) {
  const allSelected = members.length > 0 && members.every((m) => value.includes(m.userId));
  const former = value.filter((id) => !members.some((m) => m.userId === id));
  const summary =
    value.length === 0
      ? "Personen auswählen"
      : value.length <= 2
        ? value.map((id) => (people.get(id) ? displayName(people.get(id)!) : "Ehemaliges Mitglied")).join(", ")
        : `${value.length} Personen`;
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-labelledby={labelledBy}
            aria-describedby={`${labelledBy}-summary`}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            {value.length ? (
              <span aria-hidden>
                <AvatarStack ids={value} people={people} size="xs" max={5} />
              </span>
            ) : (
              <Users className="size-4 text-muted-foreground" aria-hidden />
            )}
            <span id={`${labelledBy}-summary`} className={cn("min-w-0 flex-1 truncate", value.length === 0 && "text-muted-foreground")}>
              {summary}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-1.5">
          <MemberPicker
            members={members}
            selected={value}
            multiple
            label="Teilnehmende"
            onToggle={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
          />
          {former.length > 0 && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              {former.length === 1 ? "1 ehemaliges Mitglied bleibt" : `${former.length} ehemalige Mitglieder bleiben`} eingetragen.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => onChange(value.filter((id) => !former.includes(id)))}>
                Entfernen
              </button>
            </p>
          )}
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground"
        onClick={() => onChange(allSelected ? [] : [...new Set([...value, ...members.map((m) => m.userId)])])}
      >
        {allSelected ? "Keine" : "Alle"}
      </Button>
    </div>
  );
}
