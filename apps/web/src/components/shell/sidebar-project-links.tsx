"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ProjectDot } from "@/components/project-dot";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { navItemClass } from "./nav";

export function SidebarProjectLinks({ projects }: { projects: { id: string; name: string; color: string }[] }) {
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const overview = pathname === "/projects";
  return (
    <div>
      {/* The heading leads to the overview (progress, archive); "+" creates a project. */}
      <div className="mb-1 flex items-center justify-between pr-1">
        <h2>
          <Link
            href="/projects"
            aria-current={overview ? "page" : undefined}
            title="Alle Projekte und Archiv"
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              overview && "text-foreground",
            )}
          >
            Projekte
          </Link>
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setCreating(true)}
          aria-label="Projekt erstellen"
          title="Projekt erstellen"
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <ProjectDialog open={creating} onOpenChange={setCreating} />
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
