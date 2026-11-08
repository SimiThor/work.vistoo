"use client";

import { ArrowUpRight, Loader2, SquareKanban, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createIssueFromIdeaAction, deleteIdeaAction, updateIdeaAction } from "@/app/actions/ideas";
import { FormAlert } from "@/components/form-feedback";
import { MemberSelect } from "@/components/member-select";
import { ProjectDot } from "@/components/project-dot";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName, type MemberDTO, type ProjectDTO } from "@vistoo/domain";
import { formatInstantDate } from "@vistoo/domain/dates";
import { IDEA_LIMITS, type IdeaDTO, type IdeaStatus } from "@vistoo/domain/ideas";
import { IdeaStatusSelect } from "./idea-status";

type Values = { title: string; description: string; status: IdeaStatus; assigneeId: string | null };
const valuesOf = (i: IdeaDTO): Values => ({
  title: i.title,
  description: i.description,
  status: i.status,
  assigneeId: i.assigneeId,
});

export function IdeaPanel({
  idea,
  members,
  people,
  projects,
  onChange,
  onDeleted,
  onClose,
}: {
  idea: IdeaDTO;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  projects: ProjectDTO[];
  onChange: (i: IdeaDTO) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [base, setBase] = useState(() => valuesOf(idea));
  const [values, setValues] = useState(base);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = { title: useId(), status: useId(), assignee: useId(), description: useId() };

  const patch = useMemo(() => {
    const p: Partial<Values> = {};
    for (const k of Object.keys(values) as (keyof Values)[]) {
      const a = k === "title" ? base[k].trim() : base[k];
      const b = k === "title" ? values[k].trim() : values[k];
      if (a !== b) (p as Record<string, unknown>)[k] = b;
    }
    return p;
  }, [base, values]);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((prev) => ({ ...prev, [k]: v }));

  const save = () => {
    if (!values.title.trim()) return setError("Bitte gib einen Titel ein.");
    if (!dirty || pending) return;
    startTransition(async () => {
      const res = await updateIdeaAction({ id: idea.id, patch });
      if (!res.ok) return setError(res.error.message);
      setError(null);
      onChange(res.data);
      setBase(valuesOf(res.data));
      setValues(valuesOf(res.data));
      toast.success("Idee gespeichert");
    });
  };

  const creator = people.get(idea.createdBy);

  return (
    <SidePanel
      title="Idee"
      description="Idee ansehen und bearbeiten"
      dirty={dirty}
      onClose={onClose}
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
          <label htmlFor={ids.title} className="sr-only">
            Titel
          </label>
          <textarea
            id={ids.title}
            data-autofocus
            rows={1}
            value={values.title}
            maxLength={IDEA_LIMITS.titleMax}
            onChange={(e) => (set("title", e.target.value.replace(/\n/g, " ")), setError(null))}
            onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.preventDefault()}
            className="field-sizing-content -mx-1 block w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-lg leading-snug font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          />
        </div>

        <div className="space-y-2.5">
          <PanelField label="Status" htmlFor={ids.status}>
            <IdeaStatusSelect value={values.status} onChange={(s) => set("status", s)} label="Status" className="h-8 w-full" />
          </PanelField>
          <PanelField label="Verantwortlich" htmlFor={ids.assignee}>
            <MemberSelect id={ids.assignee} value={values.assigneeId} onChange={(v) => set("assigneeId", v)} members={members} />
          </PanelField>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={ids.description} className="text-[13px] text-muted-foreground">
            Beschreibung und Notizen
          </label>
          <textarea
            id={ids.description}
            value={values.description}
            maxLength={IDEA_LIMITS.descriptionMax}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Worum geht es? Warum lohnt es sich? Offene Fragen …"
            className="field-sizing-content block min-h-40 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
          />
        </div>
        <FormAlert message={error} />
      </form>

      <IssueSection idea={idea} projects={projects} dirty={dirty} onChange={onChange} />

      <p className="mt-6 text-xs text-muted-foreground">
        Erstellt von {creator ? displayName(creator) : "ehemaligem Mitglied"} am {formatInstantDate(idea.createdAt, "long")}
        {idea.updatedAt !== idea.createdAt && ` · geändert am ${formatInstantDate(idea.updatedAt, "long")}`}
      </p>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Idee löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{idea.title}“ wird für alle gelöscht.{idea.task && " Das daraus erstellte Issue bleibt erhalten."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const res = await deleteIdeaAction({ id: idea.id });
                if (!res.ok && res.error.code !== "NOT_FOUND") return void toast.error(res.error.message);
                toast.success("Idee gelöscht");
                onDeleted(idea.id);
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

/** Linked issue, or "Issue erstellen" with a project choice (uses the regular task creation). */
function IssueSection({
  idea,
  projects,
  dirty,
  onChange,
}: {
  idea: IdeaDTO;
  projects: ProjectDTO[];
  dirty: boolean;
  onChange: (i: IdeaDTO) => void;
}) {
  const active = projects.filter((p) => !p.archived);
  const [choosing, setChoosing] = useState(false);
  const [projectId, setProjectId] = useState(active[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const selectId = useId();

  if (idea.task) {
    const project = projects.find((p) => p.id === idea.task!.projectId);
    return (
      <section className="mt-6 space-y-1.5" aria-label="Issue">
        <h3 className="text-[13px] text-muted-foreground">Issue</h3>
        <Link
          href={`/projects/${idea.task.projectId}?task=${idea.task.id}`}
          className="group flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm outline-none hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/35"
        >
          <SquareKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{idea.task.title}</span>
          {project && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ProjectDot color={project.color} />
              {project.name}
            </span>
          )}
          <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
        </Link>
      </section>
    );
  }

  const create = () =>
    startTransition(async () => {
      const res = await createIssueFromIdeaAction({ ideaId: idea.id, projectId });
      if (!res.ok) return void toast.error(res.error.message);
      onChange(res.data.idea);
      setChoosing(false);
      toast.success("Issue erstellt");
    });

  return (
    <section className="mt-6 space-y-1.5" aria-label="Issue">
      <h3 className="text-[13px] text-muted-foreground">Issue</h3>
      {!choosing ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setChoosing(true)} disabled={active.length === 0}>
          <SquareKanban aria-hidden />
          Issue erstellen
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            Titel und Beschreibung werden als neue Aufgabe in dieses Projekt übernommen:
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id={selectId} className="w-full sm:flex-1">
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
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setChoosing(false)} disabled={pending}>
                Abbrechen
              </Button>
              <Button type="button" onClick={create} disabled={!projectId || pending}>
                Erstellen
              </Button>
            </div>
          </div>
          {dirty && <p className="text-xs text-muted-foreground">Ungespeicherte Änderungen bitte zuerst speichern.</p>}
        </div>
      )}
      {active.length === 0 && <p className="text-xs text-muted-foreground">Lege zuerst ein Projekt an.</p>}
    </section>
  );
}
