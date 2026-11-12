"use client";

import { Loader2, Scale, SquareKanban, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addAgendaRelationAction,
  createDecisionFromAgendaItemAction,
  createIssueFromAgendaItemAction,
  listAgendaRelationCandidatesAction,
  removeAgendaRelationAction,
} from "@/app/actions/meetings";
import { StatusBadge } from "@/components/decisions/decision-status";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { MemberSelect } from "@/components/member-select";
import { ProjectDot } from "@/components/project-dot";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readLastProject, rememberProject } from "@/components/work/quick-add";
import type { MemberDTO, ProjectDTO, TaskStatus } from "@vistoo/domain";
import type { DecisionStatus } from "@vistoo/domain/decisions";
import { formatIssueNumber } from "@vistoo/domain/issue-refs";
import {
  agendaHandoffText,
  type AgendaItemDTO,
  type AgendaRelationCandidateDTO,
  type AgendaRelationDTO,
  type AgendaRelationKind,
  type MeetingSummaryDTO,
} from "@vistoo/domain/meetings";

export const relationHref = (r: Pick<AgendaRelationDTO, "kind" | "targetId" | "projectId">) =>
  r.kind === "issue" ? `/projects/${r.projectId}?task=${r.targetId}` : `/decisions?id=${r.targetId}`;

/** "#42 – Implement new pricing page" / decision title, as a link; × removes only the link. */
export function RelationChips({
  item,
  onChange,
}: {
  item: AgendaItemDTO;
  onChange: (item: AgendaItemDTO) => void;
}) {
  const [, startTransition] = useTransition();
  if (item.relations.length === 0) return null;
  const remove = (r: AgendaRelationDTO) =>
    startTransition(async () => {
      const res = await removeAgendaRelationAction({ id: r.id });
      if (!res.ok) return void toast.error(res.error.message);
      onChange(res.data);
    });
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Verknüpft">
      {item.relations.map((r) => (
        <li key={r.id} className="group/chip flex max-w-full items-center rounded-lg border bg-background text-[13px]">
          <Link
            href={relationHref(r)}
            className="flex min-w-0 items-center gap-1.5 rounded-l-lg py-1 pr-1 pl-2 outline-none hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            {r.kind === "issue" ? (
              <StatusIcon status={r.status as TaskStatus} />
            ) : (
              <Scale className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="sr-only">{r.kind === "issue" ? "Issue" : "Entscheidung"}:</span>
            {r.number !== null && <span className="shrink-0 text-muted-foreground tabular-nums">{formatIssueNumber(r.number)} –</span>}
            <span className="truncate">{r.title}</span>
            {r.kind === "decision" && <StatusBadge status={r.status as DecisionStatus} className="ml-0.5 hidden h-5 px-2 text-[11px] sm:inline-flex" />}
          </Link>
          <button
            type="button"
            onClick={() => remove(r)}
            aria-label={`Verknüpfung mit „${r.title}“ entfernen`}
            title="Verknüpfung entfernen"
            className="grid size-6 shrink-0 place-items-center rounded-r-lg text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 sm:opacity-0 sm:group-hover/chip:opacity-100 sm:focus-visible:opacity-100"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Search popover for an existing issue ("#42" or words of the title) or
 * decision. Anchored to `anchor`; results come from the server.
 */
export function LinkExistingPopover({
  item,
  kind,
  open,
  onOpenChange,
  anchor,
  onChange,
}: {
  item: AgendaItemDTO;
  kind: AgendaRelationKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.ReactNode;
  onChange: (item: AgendaItemDTO) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AgendaRelationCandidateDTO[] | null>(null);
  const [adding, startAdding] = useTransition();
  const ticket = useRef(0);

  useEffect(() => {
    if (!open) return;
    const t = ++ticket.current;
    const timer = setTimeout(async () => {
      const res = await listAgendaRelationCandidatesAction({ itemId: item.id, kind, query });
      if (t !== ticket.current) return;
      if (res.ok) setResults(res.data);
      else toast.error(res.error.message);
    }, query ? 180 : 0);
    return () => clearTimeout(timer);
  }, [open, query, kind, item.id]);

  const pick = (c: AgendaRelationCandidateDTO) =>
    startAdding(async () => {
      const res = await addAgendaRelationAction({ itemId: item.id, kind, targetId: c.targetId });
      if (!res.ok) return void toast.error(res.error.message);
      onChange(res.data);
      onOpenChange(false);
      setQuery("");
    });

  const label = kind === "issue" ? "Issue verknüpfen" : "Entscheidung verknüpfen";
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setQuery("");
          setResults(null);
        }
      }}
    >
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-1.5">
        <Command shouldFilter={false} label={label} className="rounded-lg">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={kind === "issue" ? "#42 oder Titel suchen …" : "Entscheidung suchen …"}
          />
          <CommandList className="max-h-64">
            {results === null ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Suchen …
              </div>
            ) : (
              <CommandEmpty>{kind === "issue" ? "Kein passendes Issue." : "Keine passende Entscheidung."}</CommandEmpty>
            )}
            {results?.map((c) => (
              <CommandItem key={c.targetId} value={c.targetId} onSelect={() => pick(c)} disabled={adding}>
                {c.kind === "issue" ? (
                  <StatusIcon status={c.status as TaskStatus} />
                ) : (
                  <Scale className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                {c.number !== null && <span className="text-muted-foreground tabular-nums">{formatIssueNumber(c.number)}</span>}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.kind === "decision" && <StatusBadge status={c.status as DecisionStatus} className="h-5 px-2 text-[11px]" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Issue erstellen": the regular task creation with title, description
 * (agenda description + outcome) and responsible person prefilled; the
 * project is chosen here. The new issue is linked to the agenda point.
 */
export function CreateIssueDialog({
  open,
  onOpenChange,
  item,
  meeting,
  projects,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AgendaItemDTO;
  meeting: Pick<MeetingSummaryDTO, "title" | "startsAt">;
  projects: ProjectDTO[];
  members: MemberDTO[];
  onCreated: (item: AgendaItemDTO) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <IssueForm
            item={item}
            meeting={meeting}
            projects={projects}
            members={members}
            onDone={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IssueForm({
  item,
  meeting,
  projects,
  members,
  onDone,
  onCreated,
}: {
  item: AgendaItemDTO;
  meeting: Pick<MeetingSummaryDTO, "title" | "startsAt">;
  projects: ProjectDTO[];
  members: MemberDTO[];
  onDone: () => void;
  onCreated: (item: AgendaItemDTO) => void;
}) {
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(() => {
    const last = readLastProject();
    return active.find((p) => p.id === last)?.id ?? active[0]?.id ?? "";
  });
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(() => agendaHandoffText(item, meeting));
  const [assigneeId, setAssigneeId] = useState<string | null>(
    item.assignedTo && members.some((m) => m.userId === item.assignedTo) ? item.assignedTo : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [taskId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  const uid = useId();

  const submit = () => {
    if (!title.trim()) return setErrors({ title: "Bitte gib einen Titel ein." });
    if (!projectId) return setErrors({ projectId: "Bitte wähle ein Projekt." });
    startTransition(async () => {
      const res = await createIssueFromAgendaItemAction({ itemId: item.id, id: taskId, projectId, title, description, assigneeId });
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        return setFormError(res.error.message);
      }
      rememberProject(projectId);
      onCreated(res.data.item);
      onDone();
      toast.success(`Issue ${formatIssueNumber(res.data.task.number)} erstellt`, {
        action: { label: "Öffnen", onClick: () => router.push(`/projects/${projectId}?task=${res.data.task.id}`) },
      });
    });
  };

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
        <DialogTitle>Issue erstellen</DialogTitle>
        <DialogDescription>Wird als neue Aufgabe angelegt und mit diesem Agenda-Punkt verknüpft.</DialogDescription>
      </DialogHeader>
      {active.length === 0 ? (
        <p className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-muted-foreground">Lege zuerst ein Projekt an.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>Titel</Label>
            <Input
              id={`${uid}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              autoFocus
              aria-invalid={Boolean(errors.title) || undefined}
            />
            <FieldError id={`${uid}-title-error`} message={errors.title} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-project`}>Projekt</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id={`${uid}-project`} className="w-full" aria-invalid={Boolean(errors.projectId) || undefined}>
                  <SelectValue placeholder="Projekt wählen" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <ProjectDot color={p.color} />
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id={`${uid}-project-error`} message={errors.projectId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-assignee`}>Zuständig</Label>
              <MemberSelect id={`${uid}-assignee`} value={assigneeId} onChange={setAssigneeId} members={members} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-description`}>Beschreibung</Label>
            <MarkdownEditor id={`${uid}-description`} value={description} onChange={setDescription} />
            <FieldError id={`${uid}-description-error`} message={errors.description} />
          </div>
        </>
      )}
      <FormAlert message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending || active.length === 0}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          <SquareKanban aria-hidden />
          Issue erstellen
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Entscheidung erstellen": a regular decision ("Offen") with title and context prefilled, linked to the point. */
export function CreateDecisionDialog({
  open,
  onOpenChange,
  item,
  meeting,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AgendaItemDTO;
  meeting: Pick<MeetingSummaryDTO, "title" | "startsAt">;
  onCreated: (item: AgendaItemDTO) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && <DecisionForm item={item} meeting={meeting} onDone={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({
  item,
  meeting,
  onDone,
  onCreated,
}: {
  item: AgendaItemDTO;
  meeting: Pick<MeetingSummaryDTO, "title" | "startsAt">;
  onDone: () => void;
  onCreated: (item: AgendaItemDTO) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(() => agendaHandoffText(item, meeting));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [decisionId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  const uid = useId();

  const submit = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    startTransition(async () => {
      const res = await createDecisionFromAgendaItemAction({ itemId: item.id, id: decisionId, title, description });
      if (!res.ok) return setError(res.error.fieldErrors?.title ?? res.error.message);
      onCreated(res.data.item);
      onDone();
      toast.success("Entscheidung angelegt", {
        action: { label: "Dokumentieren", onClick: () => router.push(`/decisions?id=${res.data.decisionId}`) },
      });
    });
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Entscheidung erstellen</DialogTitle>
        <DialogDescription>
          Wird unter „Entscheidungen“ als offene Entscheidung angelegt und mit diesem Agenda-Punkt verknüpft. Optionen und
          Begründung dokumentiert ihr dort.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-title`}>Titel</Label>
        <Input id={`${uid}-title`} value={title} onChange={(e) => (setTitle(e.target.value), setError(null))} maxLength={300} autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-description`}>Kontext</Label>
        <MarkdownEditor id={`${uid}-description`} value={description} onChange={setDescription} />
      </div>
      <FormAlert message={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          <Scale aria-hidden />
          Entscheidung erstellen
        </Button>
      </DialogFooter>
    </form>
  );
}
