import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProjectActions } from "@/components/projects/project-actions";
import { WorkProvider } from "@/components/work/work-context";
import { WorkSkeleton } from "@/components/work/work-skeleton";
import { WorkView } from "@/components/work/work-view";
import { uuid } from "@vistoo/domain/validation";
import { AppError } from "@vistoo/backend/errors";
import { getPeopleForViewer, getProjectsForViewer, getViewer } from "@/server/queries";
import { getProject } from "@vistoo/backend/services/projects";
import { listTasks } from "@vistoo/backend/services/tasks";

export const metadata: Metadata = { title: "Projekt" };

export default function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  return (
    <Suspense fallback={<WorkSkeleton />}>
      <ProjectContent params={params} />
    </Suspense>
  );
}

async function ProjectContent({ params }: { params: PageProps<"/projects/[projectId]">["params"] }) {
  const { projectId } = await params;
  if (!uuid.safeParse(projectId).success) notFound();
  const { ctx, me } = await getViewer();
  const project = await getProject(ctx, projectId).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [tasks, projects, people] = await Promise.all([
    listTasks(ctx, { projectId }),
    getProjectsForViewer(),
    getPeopleForViewer(),
  ]);
  return (
    <WorkProvider
      scope={{ kind: "project", projectId }}
      me={me}
      workspaceId={ctx.workspaceId}
      initialTasks={tasks}
      projects={projects}
      members={people.members}
      formerMembers={people.former}
    >
      <WorkView
        title={project.name}
        subtitle={project.description || undefined}
        headerActions={<ProjectActions projectId={projectId} />}
      />
    </WorkProvider>
  );
}
