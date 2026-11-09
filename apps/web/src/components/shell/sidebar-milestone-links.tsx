"use client";

import { Flag, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MilestoneDialog } from "@/components/milestones/milestone-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@vistoo/domain/dates";
import { navItemClass } from "./nav";

/** Open milestones in the sidebar; the heading leads to the overview (incl. completed). */
export function SidebarMilestoneLinks({
  milestones,
}: {
  milestones: { id: string; name: string; dueDate: string | null }[];
}) {
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const overview = pathname === "/milestones";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between pr-1">
        <h2>
          <Link
            href="/milestones"
            aria-current={overview ? "page" : undefined}
            title="Alle Meilensteine"
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              overview && "text-foreground",
            )}
          >
            Meilensteine
          </Link>
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setCreating(true)}
          aria-label="Meilenstein erstellen"
          title="Meilenstein erstellen"
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <MilestoneDialog open={creating} onOpenChange={setCreating} />
      {milestones.length === 0 ? (
        <p className="px-2.5 text-sm text-muted-foreground">Keine offenen Meilensteine.</p>
      ) : (
        <ul className="space-y-0.5">
          {milestones.map((m) => {
            const href = `/milestones/${m.id}`;
            const active = pathname === href;
            return (
              <li key={m.id}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(navItemClass, active && "bg-sidebar-accent font-medium text-foreground")}
                >
                  <Flag className="mx-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.dueDate && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatShortDate(m.dueDate)}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
