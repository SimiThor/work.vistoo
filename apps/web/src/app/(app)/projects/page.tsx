import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectList } from "@/components/projects/project-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getProjectsForViewer, getViewer } from "@/server/queries";
import { projectStats } from "@vistoo/backend/services/projects";

export const metadata: Metadata = { title: "Projekte" };

export default function ProjectsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<ProjectsSkeleton />}>
          <Projects />
        </Suspense>
      </div>
    </div>
  );
}

async function Projects() {
  const { ctx } = await getViewer();
  const [projects, stats] = await Promise.all([getProjectsForViewer(), projectStats(ctx)]);
  return <ProjectList projects={projects} stats={stats} />;
}

function ProjectsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Projekte werden geladen">
      <div className="flex h-8 items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Projekte</h1>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="mt-6 divide-y rounded-xl border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        ))}
      </div>
    </div>
  );
}
