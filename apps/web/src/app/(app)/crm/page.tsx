import type { Metadata } from "next";
import { Suspense } from "react";
import { AttractionsView } from "@/components/crm/attractions-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getViewer } from "@/server/queries";
import { listAttractions } from "@vistoo/backend/services/crm";

export const metadata: Metadata = { title: "CRM · Attraktionen" };

export default function CrmPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<CrmSkeleton />}>
          <Crm />
        </Suspense>
      </div>
    </div>
  );
}

async function Crm() {
  const { ctx, me } = await getViewer();
  const [attractions, people] = await Promise.all([listAttractions(ctx), getPeopleForViewer()]);
  return <AttractionsView initial={attractions} members={people.members} former={people.former} meId={me.userId} />;
}

function CrmSkeleton() {
  return (
    <div aria-busy="true" aria-label="Attraktionen werden geladen">
      <h1 className="text-xl font-semibold tracking-tight">Attraktionen</h1>
      <div className="mt-5 flex gap-8">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-16" />
        ))}
      </div>
      <Skeleton className="mt-5 h-64 w-full rounded-xl" />
    </div>
  );
}
