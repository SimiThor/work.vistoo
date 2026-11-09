import { getMilestonesForViewer, getProjectsForViewer } from "@/server/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarMilestoneLinks } from "./sidebar-milestone-links";
import { SidebarProjectLinks } from "./sidebar-project-links";

/** Sidebar sections "Projekte" and "Meilensteine" (active / open ones only). */
export async function SidebarProjects() {
  const [projects, milestones] = await Promise.all([getProjectsForViewer(), getMilestonesForViewer()]);
  return (
    <div className="space-y-6">
      <SidebarProjectLinks
        projects={projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      />
      <SidebarMilestoneLinks
        milestones={milestones.filter((m) => !m.completed).map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate }))}
      />
    </div>
  );
}

export function SidebarProjectsSkeleton() {
  return (
    <div className="space-y-2 px-2.5" aria-hidden>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}
