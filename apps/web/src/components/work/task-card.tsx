"use client";

import { Flag } from "lucide-react";
import { AssigneeStack, assigneesLabel } from "@/components/assignee-stack";
import { ProjectDot } from "@/components/project-dot";
import type { TaskDTO } from "@vistoo/domain";
import { formatShortDate } from "@vistoo/domain/dates";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { useWork } from "./work-context";
import { IssueNumber } from "./issue-number";

/** Card content: title, assignees, optional end date, project/milestone when helpful. Nothing else. */
export function TaskCardBody({ task }: { task: TaskDTO }) {
  const { scope, projectById, milestoneById, people } = useWork();
  const project = projectById.get(task.projectId);
  const today = useToday();
  const overdue = today !== null && task.endDate !== null && task.status !== "done" && task.endDate < today;
  const refYear = Number((today ?? task.endDate ?? "").slice(0, 4)) || undefined;
  const showProject = scope.kind !== "project" && project;
  const milestone = scope.kind !== "milestone" && task.milestoneId ? milestoneById.get(task.milestoneId) : undefined;

  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-snug font-medium break-words text-foreground line-clamp-4 pr-5">
        <IssueNumber number={task.number} className="mr-1.5" />
        {task.title}
      </p>
      {showProject && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ProjectDot color={project.color} />
          <span className="truncate">{project.name}</span>
        </p>
      )}
      {milestone && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Flag className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">Meilenstein: </span>
          <span className="truncate">{milestone.name}</span>
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
          <span className="sr-only">{assigneesLabel(task.assigneeIds, people)}</span>
          <AssigneeStack ids={task.assigneeIds} people={people} size="sm" />
        </span>
      </div>
    </div>
  );
}

export const cardClass =
  "rounded-lg border bg-background p-3 shadow-card transition-[box-shadow,border-color] hover:border-border-strong";
