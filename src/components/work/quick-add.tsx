"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ProjectDot } from "@/components/project-dot";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_LABEL, type TaskStatus } from "@/lib/domain";
import { useWork } from "./work-context";

/** Values derived from scope + active filters, so a new task stays visible. */
export type QuickAddDefaults = {
  projectId: string | null;
  groupId: string | null;
  assigneeId: string | null;
};

const LAST_PROJECT_KEY = "vistoo:last-project";

export function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
export function rememberProject(id: string) {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* storage unavailable: ignore */
  }
}

export function QuickAdd({
  status,
  defaults,
  onDone,
}: {
  status: TaskStatus;
  defaults: QuickAddDefaults;
  onDone: () => void;
}) {
  const { scope, projects, createTask } = useWork();
  const active = projects.filter((p) => !p.archived);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (defaults.projectId) return defaults.projectId;
    const last = readLastProject();
    return active.find((p) => p.id === last)?.id ?? active[0]?.id ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const submit = () => {
    if (pending) return;
    if (!title.trim()) {
      setError("Bitte gib einen Titel ein.");
      return;
    }
    if (!projectId) {
      setError("Bitte wähle ein Projekt.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTask({
        projectId,
        title,
        status,
        groupId: projectId === defaults.projectId ? defaults.groupId : null,
        assigneeId: defaults.assigneeId,
      });
      if (res.ok) {
        rememberProject(projectId);
        setTitle("");
        inputRef.current?.focus();
      } else {
        setError(res.error.fieldErrors?.title ?? res.error.message);
      }
    });
  };

  return (
    <form
      className="rounded-lg border bg-background p-2 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Titel der neuen Aufgabe in „{STATUS_LABEL[status]}“
      </label>
      <textarea
        id={id}
        ref={inputRef}
        autoFocus
        rows={2}
        value={title}
        placeholder="Titel der Aufgabe"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        className="block w-full resize-none bg-transparent px-1 text-[13px] leading-snug outline-none placeholder:text-muted-foreground"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="px-1 pt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {scope.kind === "all" ? (
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger size="sm" className="h-7 max-w-[60%] text-xs" aria-label="Projekt">
              <SelectValue placeholder="Projekt" />
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
        ) : (
          <span />
        )}
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Fertig
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            Hinzufügen
          </Button>
        </div>
      </div>
    </form>
  );
}
