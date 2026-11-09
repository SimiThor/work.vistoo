import type { Metadata } from "next";
import { Suspense } from "react";
import { MilestoneList } from "@/components/milestones/milestone-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getMilestonesForViewer } from "@/server/queries";

export const metadata: Metadata = { title: "Meilensteine" };

export default function MilestonesPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<MilestonesSkeleton />}>
          <Milestones />
        </Suspense>
      </div>
    </div>
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
