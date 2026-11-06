"use client";

import { MemberAvatar } from "@/components/member-avatar";
import { ProjectDot } from "@/components/project-dot";
import { displayName, type TaskDTO } from "@vistoo/domain";
import { formatShortDate } from "@vistoo/domain/dates";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { useWork } from "./work-context";

/** Card content: title, assignee, optional end date, project/group when helpful. Nothing else. */
export function TaskCardBody({ task }: { task: TaskDTO }) {
  const { scope, projectById, people } = useWork();
  const project = projectById.get(task.projectId);
  const group = project?.groups.find((g) => g.id === task.groupId);
  const assignee = task.assigneeId ? people.get(task.assigneeId) : null;
  const today = useToday();
  const overdue = today !== null && task.endDate !== null && task.status !== "done" && task.endDate < today;
  const refYear = Number((today ?? task.endDate ?? "").slice(0, 4)) || undefined;
  const showProject = scope.kind === "all" && project;

  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-snug font-medium break-words text-foreground line-clamp-4 pr-5">{task.title}</p>
      {(showProject || group) && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {showProject && <ProjectDot color={project.color} />}
          <span className="truncate">
            {showProject ? project.name : null}
            {showProject && group ? " · " : null}
            {group?.name}
          </span>
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {task.endDate ? (
          <span className={cn("text-xs tabular-nums text-muted-foreground", overdue && "font-medium text-destructive")}>
            <span className="sr-only">{overdue ? "Überfällig, fällig am " : "Fällig am "}</span>
            {formatShortDate(task.endDate, refYear)}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1.5">
          <span className="sr-only">
            {assignee ? `Verantwortlich: ${displayName(assignee)}` : "Nicht zugewiesen"}
          </span>
          <MemberAvatar member={assignee} size="sm" />
        </span>
      </div>
    </div>
  );
}

export const cardClass =
  "rounded-lg border bg-background p-3 shadow-card transition-[box-shadow,border-color] hover:border-border-strong";
