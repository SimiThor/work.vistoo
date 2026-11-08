import type { Metadata } from "next";
import { Suspense } from "react";
import { IdeasView } from "@/components/ideas/ideas-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { listIdeas } from "@vistoo/backend/services/ideas";

export const metadata: Metadata = { title: "Ideen" };

export default function IdeasPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<IdeasSkeleton />}>
          <Ideas />
        </Suspense>
      </div>
    </div>
  );
}

async function Ideas() {
  const { ctx } = await getViewer();
  const [ideas, people, projects] = await Promise.all([listIdeas(ctx), getPeopleForViewer(), getProjectsForViewer()]);
  return <IdeasView initial={ideas} members={people.members} former={people.former} projects={projects} />;
}

function IdeasSkeleton() {
  return (
    <div aria-busy="true" aria-label="Ideen werden geladen">
      <h1 className="text-xl font-semibold tracking-tight">Ideen</h1>
      <Skeleton className="mt-6 h-12 w-full rounded-xl" />
      <div className="mt-5 divide-y rounded-xl border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 px-4 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
