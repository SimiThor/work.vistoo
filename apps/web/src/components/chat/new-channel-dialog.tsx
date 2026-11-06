"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createChannelAction } from "@/app/actions/chat";
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
import { CHAT_LIMITS } from "@vistoo/domain/chat-config";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";
import { MemberPicker } from "./member-picker";

export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <Form onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Form({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { members, me, reload } = useChat();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"open" | "private">("open");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const descId = useId();
  const others = members.filter((m) => m.userId !== me?.userId);

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setErrors({ name: "Bitte gib einen Namen ein." });
        setErrors({});
        setFormError(null);
        startTransition(async () => {
          const res = await createChannelAction({ name, description, visibility, memberIds });
          if (!res.ok) {
            if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
            else setFormError(res.error.message);
            return;
          }
          await reload();
          onDone();
          router.push(`/chat/${res.data.id}`);
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Neuer Kanal</DialogTitle>
        <DialogDescription>Kanäle bündeln Gespräche zu einem Thema.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={name}
          maxLength={CHAT_LIMITS.channelNameMax}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Website-Launch"
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          autoFocus
        />
        <FieldError id={`${nameId}-error`} message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={descId}>
          Beschreibung <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={descId}
          rows={2}
          value={description}
          maxLength={CHAT_LIMITS.channelDescriptionMax}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sichtbarkeit</legend>
        <div className="grid gap-2" role="radiogroup" aria-label="Sichtbarkeit">
          {(
            [
              ["open", "Offen im Workspace", "Alle Mitglieder des Workspaces können lesen und schreiben."],
              ["private", "Geschlossen", "Nur ausdrücklich hinzugefügte Mitglieder haben Zugriff."],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={visibility === value}
              onClick={() => setVisibility(value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35",
                visibility === value && "border-accent-blue bg-accent-blue-soft",
              )}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Die Sichtbarkeit lässt sich später nicht ändern.</p>
      </fieldset>
      {visibility === "private" && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Mitglieder</p>
          <MemberPicker
            label="Mitglieder auswählen"
            members={others}
            selected={memberIds}
            multiple
            onToggle={(id) => setMemberIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          />
          <p className="text-xs text-muted-foreground">Du bist automatisch Mitglied und verantwortlich.</p>
        </div>
      )}
      <FormAlert message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          Kanal erstellen
        </Button>
      </DialogFooter>
    </form>
  );
}
