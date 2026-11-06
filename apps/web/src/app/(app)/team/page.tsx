import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamView } from "@/components/team/team-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/server/queries";
import { listTeam } from "@vistoo/backend/services/team";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<TeamSkeleton />}>
          <Team />
        </Suspense>
      </div>
    </div>
  );
}

async function Team() {
  const { ctx, me } = await getViewer();
  const team = await listTeam(ctx);
  return <TeamView me={me} members={team.members} invitations={team.invitations} />;
}

function TeamSkeleton() {
  return (
    <div aria-busy="true" aria-label="Team wird geladen">
      <div className="flex h-8 items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="mt-6 divide-y rounded-xl border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
