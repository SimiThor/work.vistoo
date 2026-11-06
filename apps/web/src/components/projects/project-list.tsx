"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setProjectArchivedAction } from "@/app/actions/projects";
import { ProjectDot } from "@/components/project-dot";
import { Button } from "@/components/ui/button";
import type { ProjectDTO } from "@/lib/domain";
import { ProjectDialog } from "./project-dialog";

type Stats = Record<string, { total: number; done: number }>;

export function ProjectList({ projects, stats }: { projects: ProjectDTO[]; stats: Stats }) {
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [showArchived, setShowArchived] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Projekte</h1>
        <Button className="h-8" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Projekt erstellen
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed px-6 py-12 text-center">
          <h2 className="font-semibold">Noch keine aktiven Projekte</h2>
          <p className="mt-1 text-sm text-muted-foreground">Projekte bündeln Aufgaben, Gruppen und Termine.</p>
          <Button className="mt-5" onClick={() => setCreating(true)}>
            Erstes Projekt erstellen
          </Button>
        </div>
      ) : (
        <ul className="mt-6 divide-y rounded-xl border">
          {active.map((p) => (
            <ProjectRow key={p.id} project={p} stats={stats[p.id]} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="mt-8">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            aria-expanded={showArchived}
            aria-controls="archived-projects"
            onClick={() => setShowArchived((v) => !v)}
          >
            <ChevronRight className={showArchived ? "rotate-90 transition-transform" : "transition-transform"} aria-hidden />
            Archivierte Projekte ({archived.length})
          </Button>
          {showArchived && (
            <ul id="archived-projects" className="mt-2 divide-y rounded-xl border">
              {archived.map((p) => (
                <ProjectRow key={p.id} project={p} stats={stats[p.id]} />
              ))}
            </ul>
          )}
        </div>
      )}

      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function ProjectRow({ project, stats }: { project: ProjectDTO; stats?: { total: number; done: number } }) {
  const [pending, startTransition] = useTransition();
  const total = stats?.total ?? 0;
  const done = stats?.done ?? 0;
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3.5 hover:bg-surface-subtle">
      <ProjectDot color={project.color} className="size-2.5" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${project.id}`}
          className="block truncate text-[15px] font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/35"
        >
          {project.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {project.description || (project.groups.length ? project.groups.map((g) => g.name).join(" · ") : "Keine Beschreibung")}
        </p>
      </div>
      <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:block">
        {total === 0 ? "Keine Aufgaben" : `${done} von ${total} erledigt`}
      </span>
      {project.archived && (
        <Button
          variant="outline"
          size="sm"
          className="relative z-10 shrink-0"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setProjectArchivedAction({ id: project.id, archived: false });
              if (!res.ok) toast.error(res.error.message);
              else toast.success("Projekt wiederhergestellt");
            })
          }
        >
          Wiederherstellen
        </Button>
      )}
    </li>
  );
}
