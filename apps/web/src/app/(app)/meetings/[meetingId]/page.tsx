import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MeetingDetail } from "@/components/meetings/meeting-detail";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { AppError } from "@vistoo/backend/errors";
import { getMeeting } from "@vistoo/backend/services/meetings";
import { uuid } from "@vistoo/domain/validation";

export const metadata: Metadata = { title: "Meeting" };

export default function MeetingPage({ params }: PageProps<"/meetings/[meetingId]">) {
  return (
    <PageShell>
      <Suspense fallback={<MeetingSkeleton />}>
        <MeetingContent params={params} />
      </Suspense>
    </PageShell>
  );
}

async function MeetingContent({ params }: { params: PageProps<"/meetings/[meetingId]">["params"] }) {
  const { meetingId } = await params;
  if (!uuid.safeParse(meetingId).success) notFound();
  const { ctx, me, meetingUrl } = await getViewer();
  const [detail, people, projects] = await Promise.all([
    getMeeting(ctx, meetingId).catch((err) => {
      if (err instanceof AppError && err.code === "NOT_FOUND") return null;
      throw err;
    }),
    getPeopleForViewer(),
    getProjectsForViewer(),
  ]);
  if (!detail) notFound();
  return (
    <MeetingDetail
      key={detail.meeting.id}
      initial={detail}
      serverNow={new Date().toISOString()}
      workspaceId={ctx.workspaceId}
      members={people.members}
      former={people.former}
      projects={projects}
      meId={me.userId}
      teamMeetingUrl={meetingUrl}
    />
  );
}

function MeetingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Meeting wird geladen">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-5 h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-4 w-72" />
      <div className="mt-4 flex gap-1.5">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-10 h-5 w-20" />
      <div className="mt-3 space-y-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
