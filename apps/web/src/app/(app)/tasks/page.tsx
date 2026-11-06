import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkProvider } from "@/components/work/work-context";
import { WorkSkeleton } from "@/components/work/work-skeleton";
import { WorkView } from "@/components/work/work-view";
import { getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { listTasks } from "@/server/services/tasks";

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
  const [tasks, projects, people] = await Promise.all([listTasks(ctx), getProjectsForViewer(), getPeopleForViewer()]);
  return (
    <WorkProvider
      scope={{ kind: "all" }}
      me={me}
      workspaceId={ctx.workspaceId}
      initialTasks={tasks}
      projects={projects}
      members={people.members}
      formerMembers={people.former}
    >
      <WorkView title="Alle Aufgaben" />
    </WorkProvider>
  );
}
