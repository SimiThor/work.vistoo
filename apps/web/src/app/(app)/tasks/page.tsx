import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkProvider } from "@/components/work/work-context";
import { WorkSkeleton } from "@/components/work/work-skeleton";
import { WorkView } from "@/components/work/work-view";
import { getMilestonesForViewer, getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { listTasks } from "@vistoo/backend/services/tasks";

export const metadata: Metadata = { title: "Alle Aufgaben" };

export default function AllTasksPage() {
  return (
    <Suspense fallback={<WorkSkeleton title="Alle Aufgaben" />}>
      <AllTasks />
    </Suspense>
  );
}

async function AllTasks() {
  const { ctx, me } = await getViewer();
  const [tasks, projects, milestones, people] = await Promise.all([
    listTasks(ctx),
    getProjectsForViewer(),
    getMilestonesForViewer(),
    getPeopleForViewer(),
  ]);
  return (
    <WorkProvider
      scope={{ kind: "all" }}
      me={me}
      workspaceId={ctx.workspaceId}
      initialTasks={tasks}
      projects={projects}
      milestones={milestones}
      members={people.members}
      formerMembers={people.former}
    >
      <WorkView title="Alle Aufgaben" />
    </WorkProvider>
  );
}
