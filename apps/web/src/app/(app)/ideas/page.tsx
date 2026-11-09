import type { Metadata } from "next";
import { Suspense } from "react";
import { IdeasView } from "@/components/ideas/ideas-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { listIdeas } from "@vistoo/backend/services/ideas";
import { uuid } from "@vistoo/domain/validation";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Ideen" };

export default function IdeasPage({ searchParams }: PageProps<"/ideas">) {
  return (
    <PageShell>
      <Suspense fallback={<IdeasSkeleton />}>
        <Ideas searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Ideas({ searchParams }: { searchParams: PageProps<"/ideas">["searchParams"] }) {
  // ?idea=<id> opens that idea (links from Decisions).
  const { idea } = await searchParams;
  const openId = typeof idea === "string" && uuid.safeParse(idea).success ? idea : null;
  const { ctx } = await getViewer();
  const [ideas, people, projects] = await Promise.all([listIdeas(ctx), getPeopleForViewer(), getProjectsForViewer()]);
  return <IdeasView initial={ideas} initialOpenId={openId} members={people.members} former={people.former} projects={projects} />;
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
