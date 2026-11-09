import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamView } from "@/components/team/team-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/server/queries";
import { listTeam } from "@vistoo/backend/services/team";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Einstellungen" };

/** Settings: team management and workspace links (rarely used, so not in the main navigation). */
export default function SettingsPage() {
  return (
    <PageShell>
      <Suspense fallback={<TeamSkeleton />}>
        <Team />
      </Suspense>
    </PageShell>
  );
}

async function Team() {
  const { ctx, me, meetingUrl } = await getViewer();
  const team = await listTeam(ctx);
  return <TeamView me={me} members={team.members} invitations={team.invitations} meetingUrl={meetingUrl} />;
}

function TeamSkeleton() {
  return (
    <div aria-busy="true" aria-label="Einstellungen werden geladen">
      <div className="flex h-8 items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Einstellungen</h1>
      </div>
      <div className="mt-6 flex h-8 items-center justify-between">
        <h2 className="text-base font-semibold">Team</h2>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="mt-4 divide-y rounded-xl border">
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
