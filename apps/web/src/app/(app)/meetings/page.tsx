import type { Metadata } from "next";
import { Suspense } from "react";
import { MeetingsView } from "@/components/meetings/meetings-view";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getViewer } from "@/server/queries";
import { listMeetings } from "@vistoo/backend/services/meetings";

export const metadata: Metadata = { title: "Meetings" };

export default function MeetingsPage() {
  return (
    <PageShell>
      <Suspense fallback={<MeetingsSkeleton />}>
        <Meetings />
      </Suspense>
    </PageShell>
  );
}

async function Meetings() {
  const { ctx, me, meetingUrl } = await getViewer();
  const [items, people] = await Promise.all([listMeetings(ctx), getPeopleForViewer()]);
  return (
    <MeetingsView
      initial={items}
      serverNow={new Date().toISOString()}
      workspaceId={ctx.workspaceId}
      members={people.members}
      former={people.former}
      meId={me.userId}
      teamMeetingUrl={meetingUrl}
    />
  );
}

function MeetingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Meetings werden geladen">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Meetings</h1>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <Skeleton className="mt-6 h-8 w-full max-w-xs rounded-full" />
      <Skeleton className="mt-8 h-4 w-24" />
      <div className="mt-2 divide-y rounded-xl border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3.5 px-4 py-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
