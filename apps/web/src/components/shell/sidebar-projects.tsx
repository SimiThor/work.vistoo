import { getProjectsForViewer } from "@/server/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProjectLinks } from "./sidebar-project-links";

export async function SidebarProjects() {
  const projects = (await getProjectsForViewer()).filter((p) => !p.archived);
  return <SidebarProjectLinks projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))} />;
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
