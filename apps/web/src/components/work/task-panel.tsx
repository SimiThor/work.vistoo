"use client";

import { AlertTriangle, Flag, Link2, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { getTaskAction, setTaskChecklistItemAction } from "@/app/actions/tasks";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { setChecklistItem, type ChecklistItem } from "@vistoo/domain/markdown";
import { FormAlert } from "@/components/form-feedback";
import { MemberMultiSelect } from "@/components/member-multi-select";
import { ProjectDot } from "@/components/project-dot";
import { StatusIcon } from "@/components/status-icon";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { durationDays, formatInstantDate, formatLongDate } from "@vistoo/domain/dates";
import { displayName, STATUS_LABEL, TASK_STATUSES, type TaskDTO, type TaskStatus } from "@vistoo/domain";
import type { TaskDTO as T } from "@vistoo/domain";
import { cn } from "@/lib/utils";
import { rememberProject, readLastProject, type QuickAddDefaults } from "./quick-add";
import { TaskLinks } from "./task-links";
import { CopyIssueNumber } from "./issue-number";
import { formatIssueNumber } from "@vistoo/domain/issue-refs";
import { DeleteTaskDialog } from "./task-menu";
import { useWork } from "./work-context";

type FormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  projectId: string;
  milestoneId: string | null;
  assigneeIds: string[];
  startDate: string | null;
  endDate: string | null;
};

const NONE = "__none__";

function valuesFrom(t: TaskDTO): FormValues {
  return {
    title: t.title,
    description: t.description,
    status: t.status,
    projectId: t.projectId,
    milestoneId: t.milestoneId,
    assigneeIds: t.assigneeIds,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}

function diff(base: FormValues, next: FormValues): Partial<FormValues> {
  const out: Partial<FormValues> = {};
  for (const k of Object.keys(next) as (keyof FormValues)[]) {
    const a = k === "title" ? base[k].trim() : base[k];
    const b = k === "title" ? next[k].trim() : next[k];
    const same = Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
    if (!same) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

function validate(v: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.title.trim()) errors.title = "Bitte gib einen Titel ein.";
  else if (v.title.trim().length > 300) errors.title = "Der Titel darf höchstens 300 Zeichen lang sein.";
  if (v.startDate && v.endDate && v.endDate < v.startDate)
    errors.endDate = "Das Enddatum darf nicht vor dem Startdatum liegen.";
  return errors;
}

export type PanelTarget = { kind: "task"; id: string; focus?: "dates" } | { kind: "new"; status: TaskStatus };

/**
 * Task details: side panel on desktop, full screen on small screens.
 * Explicit save. Guards unsaved changes on close (button, Escape, overlay,
 * browser back via `externalCloseRequest`).
 */
export function TaskPanel({
  target,
  defaults,
  onClose,
  onCreated,
  dirtyRef,
  externalCloseRequest,
}: {
  target: PanelTarget;
  defaults: QuickAddDefaults;
  onClose: () => void;
  onCreated: (task: T) => void;
  dirtyRef: React.RefObject<boolean>;
  externalCloseRequest: number;
}) {
  const { taskById, acceptServerTask } = useWork();
  const task = target.kind === "task" ? taskById(target.id) : undefined;
  const [loadState, setLoadState] = useState<"idle" | "loading" | "missing">(
    target.kind === "task" && !task ? "loading" : "idle",
  );

  // Deep link to a task not in the current list (e.g. archived project): fetch it.
  useEffect(() => {
    if (target.kind !== "task" || task) return;
    let cancelled = false;
    getTaskAction({ id: target.id }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        acceptServerTask(res.data);
        setLoadState("idle");
      } else setLoadState("missing");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (dirtyRef.current) setConfirmClose(true);
    else onClose();
  };

  // Browser back/forward while editing: ask before discarding.
  const [seenCloseRequest, setSeenCloseRequest] = useState(externalCloseRequest);
  if (externalCloseRequest !== seenCloseRequest) {
    setSeenCloseRequest(externalCloseRequest);
    setConfirmClose(true);
  }

  const titleId = useId();

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-labelledby={titleId}
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]"
        onEscapeKeyDown={(e) => {
          // Escape inside an inline editor (attachments) only cancels that editor.
          if ((e.target as Element | null)?.closest?.("[data-local-escape]")) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          // Focus the first field instead of the first button.
          e.preventDefault();
          const root = e.currentTarget as HTMLElement | null;
          const el =
            target.kind === "task" && target.focus === "dates"
              ? root?.querySelector<HTMLElement>("[data-field=startDate]")
              : root?.querySelector<HTMLElement>("[data-autofocus]");
          el?.focus();
        }}
      >
        {target.kind === "new" ? (
          <TaskForm
            mode="create"
            titleId={titleId}
            initial={{
              title: "",
              description: "",
              status: target.status,
              projectId: "",
              milestoneId: defaults.milestoneId,
              assigneeIds: defaults.assigneeId ? [defaults.assigneeId] : [],
              startDate: null,
              endDate: null,
            }}
            defaults={defaults}
            onRequestClose={requestClose}
            onDone={onClose}
            onCreated={onCreated}
            dirtyRef={dirtyRef}
          />
        ) : task ? (
          <TaskForm
            key={task.id}
            mode="edit"
            titleId={titleId}
            task={task}
            initial={valuesFrom(task)}
            defaults={defaults}
            onRequestClose={requestClose}
            onDone={onClose}
            onCreated={onCreated}
            dirtyRef={dirtyRef}
          />
        ) : (
          <div className="flex h-full flex-col">
            <PanelHeader titleId={titleId} title="Aufgabe" onClose={onClose} />
            {loadState === "loading" ? (
              <div className="space-y-4 p-6" aria-busy="true" aria-label="Wird geladen">
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground" role="status">
                Diese Aufgabe gibt es nicht (mehr) oder du hast keinen Zugriff darauf.
              </div>
            )}
          </div>
        )}
      </SheetContent>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>Deine Änderungen an dieser Aufgabe gehen verloren.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                dirtyRef.current = false;
                onClose();
              }}
            >
              Verwerfen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function PanelHeader({
  titleId,
  title,
  number,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  /** Issue number of an existing task (`#24`, click copies it). */
  number?: number;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-4 sm:pl-6">
      <div className="flex min-w-0 items-baseline gap-2 text-[13px]">
        <SheetTitle id={titleId} className="text-[13px] font-medium text-muted-foreground">
          {title}
          {number !== undefined && <span className="sr-only"> {formatIssueNumber(number)}</span>}
        </SheetTitle>
        {number !== undefined && <CopyIssueNumber number={number} />}
      </div>
      <SheetDescription className="sr-only">Details der Aufgabe bearbeiten</SheetDescription>
      <div className="flex items-center gap-0.5">
        {children}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schließen">
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-x-3 sm:grid-cols-[128px_1fr]">
      <label htmlFor={htmlFor} className="pt-2 text-[13px] text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function DateInput({
  id,
  value,
  onChange,
  disabled,
  label,
  invalid,
  describedBy,
  field,
}: {
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  field: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        data-field={field}
        type="date"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:opacity-60 aria-invalid:border-destructive"
      />
      {value && !disabled && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label={`${label} entfernen`}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

function TaskForm({
  mode,
  task,
  initial,
  defaults,
  titleId,
  onRequestClose,
  onDone,
  onCreated,
  dirtyRef,
}: {
  mode: "create" | "edit";
  task?: TaskDTO;
  initial: FormValues;
  defaults: QuickAddDefaults;
  titleId: string;
  onRequestClose: () => void;
  onDone: () => void;
  onCreated: (task: T) => void;
  dirtyRef: React.RefObject<boolean>;
}) {
  const { projects, projectById, milestones, members, people, isReadOnly, createTask, updateTask, acceptServerTask } =
    useWork();
  const activeProjects = projects.filter((p) => !p.archived);

  const [base, setBase] = useState<{ values: FormValues; version: number }>(() => {
    if (mode === "create") {
      const last = readLastProject();
      const projectId =
        defaults.projectId ?? activeProjects.find((p) => p.id === last)?.id ?? activeProjects[0]?.id ?? "";
      return { values: { ...initial, projectId }, version: 0 };
    }
    return { values: initial, version: task!.version };
  });
  const [values, setValues] = useState<FormValues>(base.values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = {
    title: useId(),
    status: useId(),
    assignee: useId(),
    project: useId(),
    milestone: useId(),
    start: useId(),
    end: useId(),
    description: useId(),
  };

  const changes = useMemo(() => diff(base.values, values), [base.values, values]);
  const dirty = Object.keys(changes).length > 0 || (mode === "create" && values.title.trim() !== "");
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);
  useEffect(() => () => void (dirtyRef.current = false), [dirtyRef]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Someone else changed the task while it is open.
  const remoteChanged = mode === "edit" && task !== undefined && task.version > base.version && !pending;
  const [lastSeenVersion, setLastSeenVersion] = useState(task?.version);
  if (mode === "edit" && task && task.version !== lastSeenVersion) {
    setLastSeenVersion(task.version);
    if (!dirty && task.version > base.version) {
      // No local edits: silently adopt the latest version.
      setBase({ values: valuesFrom(task), version: task.version });
      setValues(valuesFrom(task));
    }
  }

  const readOnly = mode === "edit" && task ? isReadOnly(task) : false;
  const project = projectById.get(values.projectId);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => {
      return { ...v, [key]: value };
    });
    setSavedAt(null);
    if (errors[key as string] || (key === "startDate" && errors.endDate)) {
      setErrors((prev) => {
        const nextErrors = validate({ ...values, [key]: value });
        return Object.fromEntries(Object.entries(nextErrors).filter(([k]) => k in prev));
      });
    }
  };

  const loadLatest = () => {
    if (!task) return;
    setBase({ values: valuesFrom(task), version: task.version });
    setValues(valuesFrom(task));
    setConflict(false);
    setErrors({});
    setFormError(null);
  };

  const save = (opts: { overwrite?: boolean } = {}) => {
    if (pending || readOnly || toggling > 0) return;
    const v = validate(values);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) {
      document.querySelector<HTMLElement>(`[aria-invalid="true"]`)?.focus();
      return;
    }
    startTransition(async () => {
      if (mode === "create") {
        if (!values.projectId) {
          setErrors({ projectId: "Bitte wähle ein Projekt." });
          return;
        }
        const res = await createTask({ ...values, title: values.title.trim() });
        if (!res.ok) {
          setErrors(res.error.fieldErrors ?? {});
          if (!res.error.fieldErrors) setFormError(res.error.message);
          return;
        }
        rememberProject(values.projectId);
        dirtyRef.current = false;
        onCreated(res.data);
        return;
      }
      const version = opts.overwrite && task ? task.version : base.version;
      const patch = diff(base.values, values);
      if (opts.overwrite && task) {
        // Re-apply my edits on top of the latest version.
        Object.assign(patch, diff(valuesFrom(task), values));
      }
      if (patch.title !== undefined) patch.title = patch.title.trim();
      if (Object.keys(patch).length === 0) return;
      const res = await updateTask(task!.id, version, patch);
      if (res.ok) {
        setBase({ values: valuesFrom(res.data), version: res.data.version });
        setValues(valuesFrom(res.data));
        setConflict(false);
        setSavedAt(Date.now());
        if (res.data.description.trim()) setDescEditing(false);
        return;
      }
      if (res.error.code === "CONFLICT") {
        if (res.error.current) acceptServerTask(res.error.current as TaskDTO);
        setConflict(true);
        return;
      }
      if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
      else setFormError(res.error.message);
    });
  };

  const copyLink = async () => {
    if (!task) return;
    const url = new URL(window.location.href);
    url.searchParams.set("task", task.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success("Link kopiert");
    } catch {
      toast.error("Link konnte nicht kopiert werden.");
    }
  };

  // ---- Description: rendered Markdown by default, editor on demand --------
  const [descEditing, setDescEditing] = useState(mode === "create" || initial.description.trim() === "");
  const [descAutoFocus, setDescAutoFocus] = useState(false);
  const [toggling, setToggling] = useState(0);
  const toggleQueue = useRef<Promise<void>>(Promise.resolve());
  const baseVersion = useRef(base.version);
  useEffect(() => {
    baseVersion.current = base.version;
  }, [base.version]);

  /**
   * Tick a checklist item in the rendered description and save it right away
   * (without the Save button). The server applies it to the latest text, so
   * nothing else is overwritten. Clicks are sent one after another.
   */
  const toggleChecklist = (item: ChecklistItem, checked: boolean) => {
    if (!task || readOnly) return;
    const before = values.description;
    const optimistic = setChecklistItem(before, item.index, checked, item.text);
    if (optimistic === null || optimistic === before) return;
    // Optimistic, without making the form dirty.
    setBase((b) => ({ ...b, values: { ...b.values, description: optimistic } }));
    setValues((v) => ({ ...v, description: optimistic }));
    setToggling((n) => n + 1);
    toggleQueue.current = toggleQueue.current.then(async () => {
      try {
        const res = await setTaskChecklistItemAction({ id: task.id, index: item.index, checked, text: item.text });
        if (res.ok) {
          const t = res.data;
          // Only my toggle happened since the form's base: rebase, keep other local edits.
          if (t.version === baseVersion.current + 1) {
            baseVersion.current = t.version;
            setBase((b) => ({ values: { ...b.values, description: t.description }, version: t.version }));
            setValues((v) => ({ ...v, description: t.description }));
          }
          acceptServerTask(t);
          return;
        }
        setBase((b) =>
          b.values.description === optimistic ? { ...b, values: { ...b.values, description: before } } : b,
        );
        setValues((v) => (v.description === optimistic ? { ...v, description: before } : v));
        if (res.error.code === "CONFLICT" && res.error.current) acceptServerTask(res.error.current as TaskDTO);
        toast.error(res.error.message);
      } finally {
        setToggling((n) => n - 1);
      }
    });
  };

  const creator = task ? people.get(task.createdBy) : undefined;
  const disabled = readOnly || pending;

  return (
    <form
      noValidate
      className="flex h-full min-h-0 flex-col"
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
      <PanelHeader
        titleId={titleId}
        title={mode === "create" ? "Neue Aufgabe" : "Aufgabe"}
        number={task?.number}
        onClose={onRequestClose}
      >
        {task && (
          <Button type="button" variant="ghost" size="icon" onClick={copyLink} aria-label="Link zur Aufgabe kopieren" title="Link kopieren">
            <Link2 aria-hidden />
          </Button>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        {readOnly && (
          <p className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-muted-foreground" role="note">
            Das Projekt ist archiviert. Aufgaben sind schreibgeschützt.
          </p>
        )}
        {(conflict || remoteChanged) && (
          <div role="alert" className="space-y-2 rounded-lg bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {conflict
                ? "Jemand anderes hat diese Aufgabe inzwischen geändert. Deine Änderungen wurden nicht gespeichert."
                : "Diese Aufgabe wurde gerade von jemand anderem geändert."}
            </p>
            <div className="flex flex-wrap gap-2 pl-6">
              <Button type="button" size="sm" variant="outline" className="bg-background" onClick={loadLatest}>
                Aktuelle Version laden
              </Button>
              {conflict && (
                <Button type="button" size="sm" variant="ghost" onClick={() => save({ overwrite: true })}>
                  Meine Änderungen trotzdem speichern
                </Button>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor={ids.title} className="sr-only">
            Titel
          </label>
          <textarea
            id={ids.title}
            data-autofocus
            rows={1}
            value={values.title}
            disabled={disabled}
            placeholder="Titel der Aufgabe"
            onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
            onBlur={() => values.title.trim() === "" && mode === "edit" && setErrors((x) => ({ ...x, ...validate(values) }))}
            onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.preventDefault()}
            aria-invalid={Boolean(errors.title) || undefined}
            aria-describedby={errors.title ? `${ids.title}-error` : undefined}
            className="field-sizing-content block w-full resize-none rounded-md bg-transparent px-1 py-0.5 -mx-1 text-lg leading-snug font-semibold outline-none placeholder:text-muted-foreground/70 focus-visible:ring-3 focus-visible:ring-ring/35 aria-invalid:ring-2 aria-invalid:ring-destructive/40 disabled:opacity-70"
          />
          {errors.title && (
            <p id={`${ids.title}-error`} role="alert" className="mt-1 text-xs text-destructive">
              {errors.title}
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          <Field label="Status" htmlFor={ids.status}>
            <Select value={values.status} onValueChange={(v) => set("status", v as TaskStatus)} disabled={disabled}>
              <SelectTrigger id={ids.status} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <StatusIcon status={s} />
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Verantwortlich" htmlFor={ids.assignee}>
            <MemberMultiSelect
              id={ids.assignee}
              value={values.assigneeIds}
              onChange={(v) => set("assigneeIds", v)}
              members={members}
              people={people}
              disabled={disabled}
            />
          </Field>

          <Field label="Projekt" htmlFor={ids.project} error={errors.projectId} errorId={`${ids.project}-error`}>
            <Select value={values.projectId || undefined} onValueChange={(v) => set("projectId", v)} disabled={disabled}>
              <SelectTrigger
                id={ids.project}
                className="w-full"
                aria-invalid={Boolean(errors.projectId) || undefined}
                aria-describedby={errors.projectId ? `${ids.project}-error` : undefined}
              >
                <SelectValue placeholder="Projekt wählen" />
              </SelectTrigger>
              <SelectContent>
                {(readOnly && project ? [project] : activeProjects).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot color={p.color} />
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Meilenstein" htmlFor={ids.milestone}>
            <Select
              value={values.milestoneId ?? NONE}
              onValueChange={(v) => set("milestoneId", v === NONE ? null : v)}
              disabled={disabled}
            >
              <SelectTrigger id={ids.milestone} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Meilenstein</SelectItem>
                {milestones
                  .filter((m) => !m.completed || m.id === values.milestoneId)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <Flag className="size-3.5 text-muted-foreground" aria-hidden />
                      {m.name}
                      {m.completed && <span className="text-muted-foreground">(abgeschlossen)</span>}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Start" htmlFor={ids.start}>
            <DateInput
              id={ids.start}
              field="startDate"
              label="Startdatum"
              value={values.startDate}
              onChange={(v) => set("startDate", v)}
              disabled={disabled}
            />
          </Field>

          <Field label="Ende" htmlFor={ids.end} error={errors.endDate} errorId={`${ids.end}-error`}>
            <DateInput
              id={ids.end}
              field="endDate"
              label="Enddatum"
              value={values.endDate}
              onChange={(v) => set("endDate", v)}
              disabled={disabled}
              invalid={Boolean(errors.endDate)}
              describedBy={errors.endDate ? `${ids.end}-error` : undefined}
            />
          </Field>
          {values.startDate && values.endDate && values.endDate >= values.startDate && (
            <p className="pl-[122px] text-xs text-muted-foreground sm:pl-[140px]">
              {values.startDate === values.endDate
                ? `1 Tag · ${formatLongDate(values.startDate)}`
                : `${durationDays(values.startDate, values.endDate)} Tage`}
            </p>
          )}
        </div>

        <div className="space-y-1.5" data-testid="task-description">
          <div className="flex min-h-7 items-center justify-between gap-2">
            {descEditing ? (
              <label htmlFor={ids.description} className="text-[13px] text-muted-foreground">
                Beschreibung
              </label>
            ) : (
              <h3 className="text-[13px] font-normal text-muted-foreground">Beschreibung</h3>
            )}
            {!descEditing && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={toggling > 0}
                onClick={() => {
                  setDescAutoFocus(true);
                  setDescEditing(true);
                }}
              >
                <Pencil aria-hidden />
                Bearbeiten
              </Button>
            )}
          </div>
          {descEditing && !readOnly ? (
            <MarkdownEditor
              id={ids.description}
              value={values.description}
              disabled={disabled}
              autoFocus={descAutoFocus}
              onChange={(v) => set("description", v)}
              placeholder="Details, Kontext, Links … Markdown und Checklisten (- [ ]) werden unterstützt."
            />
          ) : values.description.trim() ? (
            <MarkdownView
              source={values.description}
              onToggle={toggleChecklist}
              disabled={readOnly || pending}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Keine Beschreibung.</p>
          )}
        </div>

        {task && <TaskLinks taskId={task.id} readOnly={readOnly} />}

        {task && (
          <p className="text-xs text-muted-foreground">
            Erstellt von {creator ? displayName(creator) : "ehemaligem Mitglied"} am{" "}
            {formatInstantDate(task.createdAt, "long")}
          </p>
        )}
        <FormAlert message={formError} />
      </div>

      {!readOnly && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">
          {task ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/8 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <span aria-live="polite" className="text-xs text-muted-foreground">
              {savedAt && !dirty ? "Gespeichert" : ""}
            </span>
            <Button type="button" variant="outline" onClick={onRequestClose}>
              {mode === "create" ? "Abbrechen" : "Schließen"}
            </Button>
            <Button type="submit" disabled={pending || toggling > 0 || (mode === "edit" && !dirty)} className={cn("min-w-24")}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {mode === "create" ? "Erstellen" : "Speichern"}
            </Button>
          </div>
        </div>
      )}
      {task && (
        <DeleteTaskDialog
          task={task}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onDeleted={() => {
            dirtyRef.current = false;
            onDone();
          }}
        />
      )}
    </form>
  );
}
