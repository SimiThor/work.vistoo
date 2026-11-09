import type { Metadata } from "next";
import { Suspense } from "react";
import { MilestoneList } from "@/components/milestones/milestone-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getMilestonesForViewer } from "@/server/queries";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Meilensteine" };

export default function MilestonesPage() {
  return (
    <PageShell>
      <Suspense fallback={<MilestonesSkeleton />}>
        <Milestones />
      </Suspense>
    </PageShell>
  );
}

async function Milestones() {
  return <MilestoneList milestones={await getMilestonesForViewer()} />;
}

function MilestonesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Meilensteine werden geladen">
      <div className="flex h-8 items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Meilensteine</h1>
        <Skeleton className="h-8 w-44" />
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
