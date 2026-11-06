"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectDot } from "@/components/project-dot";
import { cn } from "@/lib/utils";
import { navItemClass } from "./nav";

export function SidebarProjectLinks({ projects }: { projects: { id: string; name: string; color: string }[] }) {
  const pathname = usePathname();
  return (
    <div>
      <h2 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">Projekte</h2>
      {projects.length === 0 ? (
        <p className="px-2.5 text-sm text-muted-foreground">Noch keine Projekte.</p>
      ) : (
        <ul className="space-y-0.5">
          {projects.map((p) => {
            const href = `/projects/${p.id}`;
            const active = pathname === href;
            return (
              <li key={p.id}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(navItemClass, active && "bg-sidebar-accent font-medium text-foreground")}
                >
                  <ProjectDot color={p.color} className="mx-1" />
                  <span className="truncate">{p.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
