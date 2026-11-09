"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createMilestoneAction, updateMilestoneAction } from "@/app/actions/milestones";
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
import type { MilestoneDTO } from "@vistoo/domain";

type Editable = Pick<MilestoneDTO, "id" | "name" | "description" | "dueDate">;

/** Create or edit a milestone (name, short description, target day). */
export function MilestoneDialog({
  open,
  onOpenChange,
  milestone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestone?: Editable;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <MilestoneForm milestone={milestone} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({ milestone, onDone }: { milestone?: Editable; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(milestone?.name ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const descId = useId();
  const dueId = useId();

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
          const input = { name, description, dueDate: dueDate || null };
          const res = milestone
            ? await updateMilestoneAction({ ...input, id: milestone.id })
            : await createMilestoneAction({ ...input, id: crypto.randomUUID() });
          if (!res.ok) {
            if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
            else setFormError(res.error.message);
            return;
          }
          onDone();
          if (!milestone) router.push(`/milestones/${res.data.id}`);
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{milestone ? "Meilenstein bearbeiten" : "Neuer Meilenstein"}</DialogTitle>
        <DialogDescription>
          Meilensteine bündeln Issues aus beliebigen Projekten, z. B. für einen Launch oder ein Release.
        </DialogDescription>
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
          placeholder="z. B. Launch v1"
          autoFocus
        />
        <FieldError id={`${nameId}-error`} message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={dueId}>
          Zieldatum <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={dueId}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-invalid={Boolean(errors.dueDate) || undefined}
          className="w-44"
        />
        <FieldError id={`${dueId}-error`} message={errors.dueDate} />
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
      <FormAlert message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {milestone ? "Speichern" : "Meilenstein erstellen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
