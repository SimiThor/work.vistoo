"use client";

import { MoreHorizontal } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setProjectArchivedAction } from "@/app/actions/projects";
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
import { ProjectDialog } from "./project-dialog";

/** Header actions on a project page: edit, archive / restore. */
export function ProjectActions({ projectId }: { projectId: string }) {
  const { projectById } = useWork();
  const project = projectById.get(projectId);
  const [dialog, setDialog] = useState<"edit" | "archive" | null>(null);
  const [pending, startTransition] = useTransition();

  if (!project) return null;

  const setArchived = (archived: boolean) =>
    startTransition(async () => {
      const res = await setProjectArchivedAction({ id: project.id, archived });
      if (!res.ok) toast.error(res.error.message);
      else toast.success(archived ? "Projekt archiviert" : "Projekt wiederhergestellt");
    });

  if (project.archived) {
    return (
      <Button variant="outline" className="h-8" onClick={() => setArchived(false)} disabled={pending}>
        Wiederherstellen
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" aria-label="Projektaktionen">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Projekt bearbeiten</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog("archive")}>Archivieren …</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectDialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} project={project} />
      <AlertDialog open={dialog === "archive"} onOpenChange={(o) => setDialog(o ? "archive" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{project.name}“ archivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Projekt und seine Aufgaben werden ausgeblendet und schreibgeschützt. Du kannst es jederzeit
              unter „Projekte“ wiederherstellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => setArchived(true)}>Archivieren</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
