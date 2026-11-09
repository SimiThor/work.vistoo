import type { Metadata } from "next";
import { Suspense } from "react";
import { DecisionsView } from "@/components/decisions/decisions-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getViewer } from "@/server/queries";
import { listDecisions } from "@vistoo/backend/services/decisions";
import { listDecisionsSchema } from "@vistoo/domain/decisions";
import { uuid } from "@vistoo/domain/validation";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Entscheidungen" };

export default function DecisionsPage({ searchParams }: PageProps<"/decisions">) {
  return (
    <PageShell>
      <Suspense fallback={<DecisionsSkeleton />}>
        <Decisions searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Decisions({ searchParams }: { searchParams: PageProps<"/decisions">["searchParams"] }) {
  const { id } = await searchParams;
  const openId = typeof id === "string" && uuid.safeParse(id).success ? id : null;
  const { ctx, me } = await getViewer();
  const [items, people] = await Promise.all([listDecisions(ctx, listDecisionsSchema.parse({ sort: "created" })), getPeopleForViewer()]);
  return (
    <DecisionsView
      initial={items}
      initialOpenId={openId}
      members={people.members}
      former={people.former}
      meId={me.userId}
    />
  );
}

function DecisionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Decisions werden geladen">
      <h1 className="text-xl font-semibold tracking-tight">Entscheidungen</h1>
      <Skeleton className="mt-6 h-11 w-full rounded-xl" />
      <Skeleton className="mt-5 h-8 w-full max-w-xl rounded-full" />
      <div className="mt-4 divide-y rounded-xl border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
