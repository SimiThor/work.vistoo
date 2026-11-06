"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusIcon } from "@/components/status-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayName, STATUS_LABEL, TASK_STATUSES, type TaskDTO, type TaskStatus } from "@/lib/domain";
import { UNASSIGNED } from "./filters";
import { useWork } from "./work-context";

/** Keyboard-accessible alternative to drag & drop: status, assignee, delete. */
export function TaskMenu({
  task,
  onOpen,
  className,
}: {
  task: TaskDTO;
  onOpen: () => void;
  className?: string;
}) {
  const { members, setStatus, setAssignee, isReadOnly } = useWork();
  const readOnly = isReadOnly(task);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={className} aria-label={`Aktionen für „${task.title}“`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onOpen}>Öffnen</DropdownMenuItem>
          {!readOnly && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Status ändern</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={task.status} onValueChange={(v) => setStatus(task.id, v as TaskStatus)}>
                    {TASK_STATUSES.map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>
                        <StatusIcon status={s} />
                        {STATUS_LABEL[s]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Zuweisen</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={task.assigneeId ?? UNASSIGNED}
                    onValueChange={(v) => setAssignee(task.id, v === UNASSIGNED ? null : v)}
                  >
                    <DropdownMenuRadioItem value={UNASSIGNED}>
                      <MemberAvatar member={null} size="xs" />
                      Nicht zugewiesen
                    </DropdownMenuRadioItem>
                    {members.map((m) => (
                      <DropdownMenuRadioItem key={m.userId} value={m.userId}>
                        <MemberAvatar member={m} size="xs" />
                        <span className="truncate">{displayName(m)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                Löschen …
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteTaskDialog task={task} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </>
  );
}

export function DeleteTaskDialog({
  task,
  open,
  onOpenChange,
  onDeleted,
}: {
  task: TaskDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { deleteTask } = useWork();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aufgabe löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            „{task.title}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onDeleted?.();
              void deleteTask(task.id);
            }}
          >
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
