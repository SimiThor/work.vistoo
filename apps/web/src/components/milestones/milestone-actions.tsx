"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteMilestoneAction, setMilestoneCompletedAction } from "@/app/actions/milestones";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWork } from "@/components/work/work-context";
import { MilestoneDialog } from "./milestone-dialog";

/** Header actions on a milestone page: edit, complete / reopen, delete. */
export function MilestoneActions({ milestoneId }: { milestoneId: string }) {
  const router = useRouter();
  const { milestoneById, tasks } = useWork();
  const milestone = milestoneById.get(milestoneId);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  if (!milestone) return null;

  const setCompleted = (completed: boolean) =>
    startTransition(async () => {
      const res = await setMilestoneCompletedAction({ id: milestone.id, completed });
      if (!res.ok) toast.error(res.error.message);
      else toast.success(completed ? "Meilenstein abgeschlossen" : "Meilenstein wieder geöffnet");
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteMilestoneAction({ id: milestone.id });
      if (!res.ok) return void toast.error(res.error.message);
      toast.success("Meilenstein gelöscht");
      router.push("/milestones");
    });

  return (
    <>
      {milestone.completed && (
        <Button variant="outline" className="h-8" onClick={() => setCompleted(false)} disabled={pending}>
          Wieder öffnen
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" aria-label="Meilensteinaktionen">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Bearbeiten</DropdownMenuItem>
          {!milestone.completed && (
            <DropdownMenuItem onSelect={() => setCompleted(true)}>Abschließen</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            Löschen …
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MilestoneDialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} milestone={milestone} />
      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{milestone.name}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {tasks.length === 0
                ? "Der Meilenstein wird gelöscht."
                : `Die ${tasks.length === 1 ? "zugeordnete Aufgabe bleibt" : `${tasks.length} zugeordneten Aufgaben bleiben`} erhalten und verlieren nur die Zuordnung.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
