import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MilestoneActions } from "@/components/milestones/milestone-actions";
import { WorkProvider } from "@/components/work/work-context";
import { WorkSkeleton } from "@/components/work/work-skeleton";
import { WorkView } from "@/components/work/work-view";
import { uuid } from "@vistoo/domain/validation";
import { formatShortDate } from "@vistoo/domain/dates";
import { getMilestonesForViewer, getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { listTasks } from "@vistoo/backend/services/tasks";

export const metadata: Metadata = { title: "Meilenstein" };

export default function MilestonePage({ params }: PageProps<"/milestones/[milestoneId]">) {
  return (
    <Suspense fallback={<WorkSkeleton />}>
      <MilestoneContent params={params} />
    </Suspense>
  );
}

async function MilestoneContent({ params }: { params: PageProps<"/milestones/[milestoneId]">["params"] }) {
  const { milestoneId } = await params;
  if (!uuid.safeParse(milestoneId).success) notFound();
  const { ctx, me } = await getViewer();
  const [milestones, tasks, projects, people] = await Promise.all([
    getMilestonesForViewer(),
    listTasks(ctx, { milestoneId }),
    getProjectsForViewer(),
    getPeopleForViewer(),
  ]);
  const milestone = milestones.find((m) => m.id === milestoneId);
  if (!milestone) notFound();

  const facts = [
    milestone.completed ? "Abgeschlossen" : null,
    milestone.dueDate ? `Zieldatum ${formatShortDate(milestone.dueDate)}` : null,
    milestone.total ? `${milestone.done} von ${milestone.total} erledigt` : null,
    milestone.description || null,
  ].filter(Boolean);

  return (
    <WorkProvider
      scope={{ kind: "milestone", milestoneId }}
      me={me}
      workspaceId={ctx.workspaceId}
      initialTasks={tasks}
      projects={projects}
      milestones={milestones}
      members={people.members}
      formerMembers={people.former}
    >
      <WorkView
        title={milestone.name}
        subtitle={facts.join(" · ") || undefined}
        headerActions={<MilestoneActions milestoneId={milestoneId} />}
      />
    </WorkProvider>
  );
}
