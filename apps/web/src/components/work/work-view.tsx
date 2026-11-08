"use client";

import { Columns3, GanttChart, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Board } from "./board";
import { applyFilters, hasActiveFilters, NO_GROUP, UNASSIGNED, useWorkUrl, type View } from "./filters";
import { FilterBar } from "./filter-bar";
import type { QuickAddDefaults } from "./quick-add";
import { TaskPanel, type PanelTarget } from "./task-panel";
import { Timeline } from "./timeline";
import { useWork } from "./work-context";

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 pb-16">
      <div className="max-w-sm text-center" role="status">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function WorkView({
  title,
  subtitle,
  headerActions,
}: {
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
}) {
  const work = useWork();
  const { scope, projects, projectById, tasks } = work;
  const { state: url, update } = useWorkUrl();

  const filters = useMemo(
    () => ({ ...url, projects: scope.kind === "all" ? url.projects : [] }),
    [url, scope.kind],
  );
  const filtered = useMemo(() => applyFilters(tasks, filters), [tasks, filters]);
  const filtering = hasActiveFilters(filters);

  const scopeProject = scope.kind === "project" ? projectById.get(scope.projectId) : undefined;
  const readOnly = Boolean(scopeProject?.archived);
  const noProjects = projects.filter((p) => !p.archived).length === 0;

  // New tasks inherit unambiguous filter values, so they stay visible.
  const defaults: QuickAddDefaults = useMemo(() => {
    const projectId =
      scope.kind === "project" ? scope.projectId : filters.projects.length === 1 ? filters.projects[0] : null;
    const groupId =
      projectId && filters.groups.length === 1 && filters.groups[0] !== NO_GROUP ? filters.groups[0] : null;
    const assigneeId =
      filters.assignees.length === 1 && filters.assignees[0] !== UNASSIGNED ? filters.assignees[0] : null;
    return { projectId, groupId, assigneeId };
  }, [scope, filters]);

  // ---- Panel state (URL is the source of truth; guarded on back navigation) ----
  const [focusDates, setFocusDates] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const [closeRequest, setCloseRequest] = useState(0);
  const lastTaskParam = useRef(url.task);
  useEffect(() => {
    const prev = lastTaskParam.current;
    lastTaskParam.current = url.task;
    if (prev && prev !== url.task && dirtyRef.current) {
      // Back/forward left an edited panel: restore it and ask first.
      update({ task: prev }, "push");
      lastTaskParam.current = prev;
      setCloseRequest((n) => n + 1);
    }
  }, [url.task, update]);

  const openTask = (id: string, focus?: "dates") => {
    setFocusDates(focus === "dates" ? id : null);
    update({ task: id, newStatus: null });
  };
  const openNew = (status = url.newStatus ?? "open") => update({ task: "new", newStatus: status === "open" ? null : status });
  const closePanel = () => {
    dirtyRef.current = false;
    update({ task: null, newStatus: null });
  };

  const target: PanelTarget | null = !url.task
    ? null
    : url.task === "new"
      ? { kind: "new", status: url.newStatus ?? "open" }
      : { kind: "task", id: url.task, focus: focusDates === url.task ? "dates" : undefined };

  const setView = (view: View) => update({ view });

  let content: React.ReactNode;
  if (tasks.length === 0) {
    content = noProjects && scope.kind === "all" ? (
      <EmptyState
        title="Noch keine Projekte"
        text="Aufgaben gehören immer zu einem Projekt. Lege zuerst ein Projekt an."
        action={
          <Button asChild>
            <Link href="/projects?new=1">Projekt erstellen</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="Noch keine Aufgaben"
        text={readOnly ? "Dieses archivierte Projekt enthält keine Aufgaben." : "Erstelle die erste Aufgabe, um loszulegen."}
        action={
          !readOnly && (
            <Button onClick={() => openNew()}>
              <Plus aria-hidden /> Aufgabe erstellen
            </Button>
          )
        }
      />
    );
  } else if (filtered.length === 0 && filtering) {
    content = (
      <EmptyState
        title="Keine passenden Aufgaben"
        text="Keine Aufgabe passt zu den aktiven Filtern."
        action={
          <Button variant="outline" onClick={() => update({ q: "", projects: [], groups: [], assignees: [], statuses: [] })}>
            Filter zurücksetzen
          </Button>
        }
      />
    );
  } else if (url.view === "timeline") {
    content = <Timeline tasks={filtered} scale={url.scale} onOpen={openTask} />;
  } else {
    content = <Board tasks={filtered} onOpen={(id) => openTask(id)} quickAddDefaults={defaults} readOnly={readOnly} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-4 px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            {!readOnly && (
              <Button onClick={() => openNew()} disabled={noProjects} className="h-8">
                <Plus aria-hidden />
                <span className="hidden sm:inline">Aufgabe erstellen</span>
                <span className="sm:hidden">Neu</span>
              </Button>
            )}
          </div>
        </div>
        {readOnly && (
          <p className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-muted-foreground" role="note">
            Dieses Projekt ist archiviert und schreibgeschützt.
          </p>
        )}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <FilterBar filters={filters} onChange={update} />
          <div className="flex shrink-0 items-center gap-2">
            <Segmented
              label="Ansicht"
              value={url.view}
              onChange={setView}
              options={[
                { value: "board", label: "Board", icon: <Columns3 className="size-3.5" aria-hidden /> },
                { value: "timeline", label: "Timeline", icon: <GanttChart className="size-3.5" aria-hidden /> },
              ]}
            />
            {url.view === "timeline" && (
              <Segmented
                label="Zeitskala"
                value={url.scale}
                onChange={(scale) => update({ scale })}
                options={[
                  { value: "day", label: "Tage" },
                  { value: "week", label: "Wochen" },
                ]}
              />
            )}
          </div>
        </div>
        {filtering && url.view === "board" && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Gefilterte Ansicht: Beim Umsortieren wird eine Aufgabe zwischen die sichtbaren Nachbarn eingeordnet; ausgeblendete Aufgaben behalten ihre Position.
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{content}</div>

      {target && (
        <TaskPanel
          key={target.kind === "task" ? target.id : "new"}
          target={target}
          defaults={defaults}
          onClose={closePanel}
          onCreated={(task) => {
            update({ task: null, newStatus: null });
            const visible = applyFilters([task], filters).length > 0;
            toast.success("Aufgabe erstellt", {
              description: visible ? undefined : "Sie ist wegen der aktiven Filter ausgeblendet.",
              action: { label: "Öffnen", onClick: () => update({ task: task.id }) },
            });
          }}
          dirtyRef={dirtyRef}
          externalCloseRequest={closeRequest}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {filtering ? `${filtered.length} von ${tasks.length} Aufgaben sichtbar` : ""}
      </span>
    </div>
  );
}
