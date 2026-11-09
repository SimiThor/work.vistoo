"use client";

import { ArrowUpRight, Loader2, Mail, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addActivityAction,
  deleteActivityAction,
  deleteAttractionAction,
  listActivitiesAction,
  updateActivityAction,
  updateAttractionAction,
} from "@/app/actions/crm";
import { FormAlert } from "@/components/form-feedback";
import { MemberSelect } from "@/components/member-select";
import { Segmented } from "@/components/segmented";
import { PanelField, SidePanel } from "@/components/side-panel";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import {
  CRM_LIMITS,
  MANUAL_ACTIVITY_LABEL,
  MANUAL_ACTIVITY_TYPES,
  type ActivityDTO,
  type AttractionDTO,
  type AttractionStatus,
  type ManualActivityType,
} from "@vistoo/domain/crm";
import { isOverdueDay } from "@vistoo/domain/todos";
import { ACTIVITY_ICON, AttractionStatusSelect, formatDateTime, systemActivityText, toLocalInput } from "./crm-shared";

type Values = {
  name: string;
  status: AttractionStatus;
  ownerId: string | null;
  nextFollowUp: string | null;
  contactName: string;
  email: string;
  website: string;
  city: string;
  country: string;
  notes: string;
};

const valuesOf = (a: AttractionDTO): Values => ({
  name: a.name,
  status: a.status,
  ownerId: a.ownerId,
  nextFollowUp: a.nextFollowUp,
  contactName: a.contactName ?? "",
  email: a.email ?? "",
  website: a.website ?? "",
  city: a.city ?? "",
  country: a.country ?? "",
  notes: a.notes,
});

export function AttractionPanel({
  attraction,
  members,
  people,
  onChange,
  onDeleted,
  onClose,
}: {
  attraction: AttractionDTO;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  onChange: (a: AttractionDTO) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [base, setBase] = useState(() => valuesOf(attraction));
  const [values, setValues] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activities, setActivities] = useState<ActivityDTO[] | null>(null);
  const [revision, setRevision] = useState(0);
  const reloadTimeline = useCallback(() => setRevision((r) => r + 1), []);
  const today = useToday();
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    listActivitiesAction({ attractionId: attraction.id }).then((res) => {
      if (!cancelled && res.ok) setActivities(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [attraction.id, revision]);

  const patch = useMemo(() => {
    const p: Partial<Values> = {};
    for (const k of Object.keys(values) as (keyof Values)[]) {
      const a = typeof base[k] === "string" ? (base[k] as string).trim() : base[k];
      const b = typeof values[k] === "string" ? (values[k] as string).trim() : values[k];
      if (a !== b) (p as Record<string, unknown>)[k] = values[k];
    }
    return p;
  }, [base, values]);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  /** Server state changed (save, activity): adopt it, keep fields the user is still editing. */
  const rebase = (next: AttractionDTO) => {
    const nb = valuesOf(next);
    setValues((prev) => {
      const out = { ...prev };
      for (const k of Object.keys(nb) as (keyof Values)[]) if (prev[k] === base[k]) (out as Record<string, unknown>)[k] = nb[k];
      return out;
    });
    setBase(nb);
    onChange(next);
  };

  const save = () => {
    if (!values.name.trim()) return setErrors({ name: "Bitte gib einen Namen ein." });
    if (!dirty || pending) return;
    startTransition(async () => {
      const res = await updateAttractionAction({ id: attraction.id, patch });
      if (!res.ok) {
        if (res.error.fieldErrors) {
          setErrors(Object.fromEntries(Object.entries(res.error.fieldErrors).map(([k, m]) => [k.replace(/^patch\./, ""), m])));
        } else setFormError(res.error.message);
        return;
      }
      setErrors({});
      setFormError(null);
      const nb = valuesOf(res.data);
      setBase(nb);
      setValues(nb);
      onChange(res.data);
      reloadTimeline();
      toast.success("Gespeichert");
    });
  };

  const overdue = isOverdueDay(values.nextFollowUp, today);
  const text = (k: "contactName" | "email" | "website" | "city" | "country", label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <PanelField label={label} htmlFor={`${id}-${k}`} error={errors[k]}>
      <Input
        id={`${id}-${k}`}
        value={values[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={Boolean(errors[k]) || undefined}
        {...props}
      />
    </PanelField>
  );

  return (
    <SidePanel
      title="Attraktion"
      description="Attraktion ansehen und bearbeiten"
      dirty={dirty}
      onClose={onClose}
      headerActions={
        <>
          {attraction.email && (
            <Button variant="ghost" size="icon" asChild>
              <a href={`mailto:${attraction.email}`} aria-label={`E-Mail an ${attraction.email}`} title="E-Mail schreiben">
                <Mail aria-hidden />
              </a>
            </Button>
          )}
          {attraction.website && (
            <Button variant="ghost" size="icon" asChild>
              <a href={attraction.website} target="_blank" rel="noopener noreferrer" aria-label="Website öffnen (neuer Tab)" title="Website öffnen">
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
          )}
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/8 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            Löschen
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Schließen
            </Button>
            <Button type="button" onClick={save} disabled={!dirty || pending} className="min-w-24">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Speichern
            </Button>
          </div>
        </>
      }
    >
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <div>
          <label htmlFor={`${id}-name`} className="sr-only">
            Name
          </label>
          <textarea
            id={`${id}-name`}
            data-autofocus
            rows={1}
            value={values.name}
            maxLength={CRM_LIMITS.nameMax}
            onChange={(e) => set("name", e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.preventDefault()}
            aria-invalid={Boolean(errors.name) || undefined}
            className="field-sizing-content -mx-1 block w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-lg leading-snug font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/35 aria-invalid:ring-2 aria-invalid:ring-destructive/40"
          />
          {errors.name && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          <PanelField label="Status" htmlFor={`${id}-status`}>
            <AttractionStatusSelect id={`${id}-status`} size="default" value={values.status} onChange={(s) => set("status", s)} className="w-full" />
          </PanelField>
          <PanelField label="Verantwortlich" htmlFor={`${id}-owner`}>
            <MemberSelect id={`${id}-owner`} value={values.ownerId} onChange={(v) => set("ownerId", v)} members={members} />
          </PanelField>
          <PanelField label="Nächstes Follow-up" htmlFor={`${id}-follow`}>
            <div className="flex items-center gap-1">
              <input
                id={`${id}-follow`}
                type="date"
                value={values.nextFollowUp ?? ""}
                onChange={(e) => set("nextFollowUp", e.target.value || null)}
                className={cn(
                  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35",
                  overdue && "border-destructive/40 text-destructive",
                )}
              />
              {values.nextFollowUp && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => set("nextFollowUp", null)} aria-label="Follow-up entfernen">
                  <X aria-hidden />
                </Button>
              )}
            </div>
            {overdue && <p className="mt-1 text-xs text-destructive">Überfällig</p>}
          </PanelField>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[13px] font-semibold text-muted-foreground">Kontakt</h3>
          {text("contactName", "Ansprechpartner")}
          {text("email", "E-Mail", { type: "email", inputMode: "email" })}
          {text("website", "Website", { type: "url", inputMode: "url", placeholder: "https://…" })}
          {text("city", "Stadt")}
          {text("country", "Land")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="text-[13px] text-muted-foreground">
            Notizen
          </label>
          <textarea
            id={`${id}-notes`}
            value={values.notes}
            maxLength={CRM_LIMITS.notesMax}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Allgemeines zur Attraktion …"
            className="field-sizing-content block min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          />
        </div>
        <FormAlert message={formError} />
      </form>

      <Timeline
        attractionId={attraction.id}
        activities={activities}
        people={people}
        onChanged={(next) => {
          if (next) rebase(next);
          reloadTimeline();
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Attraktion löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{attraction.name}“ wird mit allen Kontaktdaten und dem gesamten Verlauf für alle gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const res = await deleteAttractionAction({ id: attraction.id });
                if (!res.ok && res.error.code !== "NOT_FOUND") return void toast.error(res.error.message);
                toast.success("Attraktion gelöscht");
                onDeleted(attraction.id);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePanel>
  );
}

/** Activity timeline: automatic and manual entries together, newest first. */
function Timeline({
  attractionId,
  activities,
  people,
  onChanged,
}: {
  attractionId: string;
  activities: ActivityDTO[] | null;
  people: Map<string, MemberDTO>;
  onChanged: (attraction?: AttractionDTO) => void;
}) {
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-8 border-t pt-5">
      <div className="mb-3 flex h-7 items-center justify-between">
        <h3 id={headingId} className="text-[13px] font-semibold text-muted-foreground">
          Verlauf
        </h3>
        {editing !== "new" && (
          <Button type="button" variant="ghost" size="xs" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            Aktivität hinzufügen
          </Button>
        )}
      </div>

      {editing === "new" && (
        <ActivityForm
          attractionId={attractionId}
          onDone={(a) => {
            setEditing(null);
            if (a) onChanged(a);
          }}
        />
      )}

      {activities === null ? (
        <div className="space-y-3" aria-label="Verlauf wird geladen">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <ol className="space-y-0.5">
          {activities.map((a, i) =>
            editing === a.id ? (
              <li key={a.id}>
                <ActivityForm
                  attractionId={attractionId}
                  activity={a}
                  onDone={(next) => {
                    setEditing(null);
                    if (next) onChanged(next);
                  }}
                />
              </li>
            ) : (
              <ActivityItem
                key={a.id}
                activity={a}
                people={people}
                latest={i === 0}
                onEdit={() => setEditing(a.id)}
                onDeleted={(next) => onChanged(next)}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function ActivityItem({
  activity: a,
  people,
  latest,
  onEdit,
  onDeleted,
}: {
  activity: ActivityDTO;
  people: Map<string, MemberDTO>;
  /** Newest entry (the list is sorted newest first): gets a quiet highlight. */
  latest: boolean;
  onEdit: () => void;
  onDeleted: (attraction: AttractionDTO) => void;
}) {
  const Icon = ACTIVITY_ICON[a.type];
  const actor = people.get(a.actorId);
  const remove = async () => {
    const res = await deleteActivityAction({ id: a.id });
    if (!res.ok) return void toast.error(res.error.message);
    toast.success("Aktivität gelöscht");
    onDeleted(res.data.attraction);
  };
  return (
    <li
      className={cn(
        "group relative flex gap-3 rounded-lg px-1 py-2",
        latest && "bg-surface-subtle/70 ring-1 ring-border/60 ring-inset",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          a.system ? "text-muted-foreground" : "text-foreground/80",
          !a.system && (latest ? "bg-background" : "bg-surface-subtle"),
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {a.system ? (
          <p className="text-sm text-muted-foreground">{systemActivityText(a, people)}</p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-medium">{MANUAL_ACTIVITY_LABEL[a.type as ManualActivityType]}</span>
              <span className="text-muted-foreground"> · {actor ? displayName(actor) : "Ehemaliges Mitglied"}</span>
            </p>
            {a.description && <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground/90">{a.description}</p>}
          </>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          <time dateTime={a.occurredAt}>{formatDateTime(a.occurredAt)}</time>
        </p>
      </div>
      {!a.system && (
        <div className="flex shrink-0 items-start [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Button type="button" variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Aktivität bearbeiten">
            <Pencil aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => void remove()} aria-label="Aktivität löschen">
            <X aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

const TYPE_OPTIONS = MANUAL_ACTIVITY_TYPES.map((t) => {
  const Icon = ACTIVITY_ICON[t];
  return { value: t, label: MANUAL_ACTIVITY_LABEL[t], icon: <Icon className="size-3.5" aria-hidden /> };
});

/** Add (or edit) a call / e-mail / meeting / note; optionally sets the next follow-up. */
function ActivityForm({
  attractionId,
  activity,
  onDone,
}: {
  attractionId: string;
  activity?: ActivityDTO;
  onDone: (attraction?: AttractionDTO) => void;
}) {
  const [type, setType] = useState<ManualActivityType>((activity?.type as ManualActivityType) ?? "call");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [when, setWhen] = useState(() => toLocalInput(activity?.occurredAt ?? new Date().toISOString()));
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [clientId] = useState(() => crypto.randomUUID());
  const id = useId();

  const save = () => {
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return setError("Bitte gib Datum und Uhrzeit an.");
    startTransition(async () => {
      const occurredAt = date.toISOString();
      const res = activity
        ? await updateActivityAction({ id: activity.id, patch: { type, description, occurredAt } })
        : await addActivityAction({
            id: clientId,
            attractionId,
            type,
            description,
            occurredAt,
            ...(followUp ? { nextFollowUp: followUp } : {}),
          });
      if (!res.ok) return setError(res.error.message);
      onDone(res.data.attraction);
    });
  };

  return (
    <div
      className="mb-3 space-y-3 rounded-lg border p-3"
      data-local-escape
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="overflow-x-auto">
        <Segmented label="Art der Aktivität" value={type} onChange={setType} options={TYPE_OPTIONS} />
      </div>
      <div>
        <label htmlFor={`${id}-desc`} className="sr-only">
          Beschreibung
        </label>
        <textarea
          id={`${id}-desc`}
          autoFocus
          value={description}
          maxLength={CRM_LIMITS.activityMax}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Was wurde besprochen?"
          rows={3}
          className="block w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-when`} className="text-xs text-muted-foreground">
            Datum und Uhrzeit
          </label>
          <input
            id={`${id}-when`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          />
        </div>
        {!activity && (
          <div className="space-y-1">
            <label htmlFor={`${id}-follow`} className="text-xs text-muted-foreground">
              Nächstes Follow-up (optional)
            </label>
            <input
              id={`${id}-follow`}
              type="date"
              value={followUp ?? ""}
              onChange={(e) => setFollowUp(e.target.value || null)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
            />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone()} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {activity ? "Aktualisieren" : "Hinzufügen"}
        </Button>
      </div>
    </div>
  );
}

