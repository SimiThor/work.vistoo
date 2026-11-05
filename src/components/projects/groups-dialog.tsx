"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { createGroupAction, deleteGroupAction, renameGroupAction } from "@/app/actions/projects";
import { FieldError } from "@/components/form-feedback";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GroupDTO, ProjectDTO } from "@/lib/domain";

/** Create, rename and delete the groups of one project. */
export function GroupsDialog({
  open,
  onOpenChange,
  project,
  taskCountByGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDTO;
  taskCountByGroup: Map<string, number>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [toDelete, setToDelete] = useState<GroupDTO | null>(null);
  const inputId = useId();

  const add = () => {
    if (!name.trim()) {
      setError("Bitte gib einen Namen ein.");
      return;
    }
    startTransition(async () => {
      const res = await createGroupAction({ projectId: project.id, name });
      if (res.ok) {
        setName("");
        setError(null);
      } else setError(res.error.fieldErrors?.name ?? res.error.message);
    });
  };

  const affected = toDelete ? (taskCountByGroup.get(toDelete.id) ?? 0) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gruppen</DialogTitle>
            <DialogDescription>
              Gruppen ordnen Aufgaben innerhalb von „{project.name}“, z. B. Produkt, Design oder Launch. Sie sind kein Status.
            </DialogDescription>
          </DialogHeader>
          {project.groups.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {project.groups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  count={taskCountByGroup.get(g.id) ?? 0}
                  onDelete={() => setToDelete(g)}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Noch keine Gruppen.
            </p>
          )}
          <form
            noValidate
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor={inputId} className="text-sm font-medium">
              Neue Gruppe
            </label>
            <div className="flex gap-2">
              <Input
                id={inputId}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Engineering"
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
              />
              <Button type="submit" disabled={pending}>
                Hinzufügen
              </Button>
            </div>
            <FieldError id={`${inputId}-error`} message={error} />
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gruppe „{toDelete?.name}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {affected === 0
                ? "Der Gruppe sind keine Aufgaben zugeordnet."
                : `${affected === 1 ? "1 Aufgabe verliert" : `${affected} Aufgaben verlieren`} nur die Gruppenzuordnung. Die Aufgaben selbst bleiben erhalten.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!toDelete) return;
                const res = await deleteGroupAction({ id: toDelete.id });
                if (!res.ok) toast.error(res.error.message);
              }}
            >
              Gruppe löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GroupRow({ group, count, onDelete }: { group: GroupDTO; count: number; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  if (editing) {
    return (
      <li className="p-2">
        <form
          noValidate
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError("Bitte gib einen Namen ein.");
            startTransition(async () => {
              const res = await renameGroupAction({ id: group.id, name });
              if (res.ok) {
                setEditing(false);
                setError(null);
              } else setError(res.error.fieldErrors?.name ?? res.error.message);
            });
          }}
        >
          <label htmlFor={id} className="sr-only">
            Name der Gruppe
          </label>
          <Input
            id={id}
            value={name}
            maxLength={80}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
                setName(group.name);
              }
            }}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <Button type="submit" size="sm" className="h-8" disabled={pending}>
            Sichern
          </Button>
        </form>
        <FieldError id={`${id}-error`} message={error} />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} {count === 1 ? "Aufgabe" : "Aufgaben"}
      </span>
      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label={`„${group.name}“ umbenennen`}>
        <Pencil aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`„${group.name}“ löschen`}>
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}
