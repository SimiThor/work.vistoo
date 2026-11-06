"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createProjectAction, updateProjectAction } from "@/app/actions/projects";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_COLOR_KEYS, PROJECT_COLORS, type ProjectColor, type ProjectDTO } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Pick<ProjectDTO, "id" | "name" | "description" | "color">;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <ProjectForm project={project} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  onDone,
}: {
  project?: Pick<ProjectDTO, "id" | "name" | "description" | "color">;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState<ProjectColor>((project?.color as ProjectColor) ?? "blue");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const descId = useId();

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setErrors({ name: "Bitte gib einen Namen ein." });
          return;
        }
        setErrors({});
        setFormError(null);
        startTransition(async () => {
          const input = { name, description, color };
          const res = project
            ? await updateProjectAction({ ...input, id: project.id })
            : await createProjectAction(input);
          if (!res.ok) {
            if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
            else setFormError(res.error.message);
            return;
          }
          onDone();
          if (!project) router.push(`/projects/${res.data.id}`);
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{project ? "Projekt bearbeiten" : "Neues Projekt"}</DialogTitle>
        <DialogDescription className="sr-only">Name, Beschreibung und Kennfarbe des Projekts</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          maxLength={120}
          autoFocus
        />
        <FieldError id={`${nameId}-error`} message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={descId}>
          Kurzbeschreibung <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          aria-invalid={Boolean(errors.description) || undefined}
        />
        <FieldError id={`${descId}-error`} message={errors.description} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Kennfarbe</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kennfarbe">
          {PROJECT_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={color === key}
              aria-label={PROJECT_COLORS[key].label}
              title={PROJECT_COLORS[key].label}
              onClick={() => setColor(key)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2 border-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
                color === key && "border-foreground/70",
              )}
            >
              <span className="flex size-5 items-center justify-center rounded-full" style={{ backgroundColor: PROJECT_COLORS[key].hex }}>
                {color === key && <Check className="size-3 text-white" aria-hidden />}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <FormAlert message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {project ? "Speichern" : "Projekt erstellen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
