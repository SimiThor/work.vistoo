"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { listSupersedeCandidatesAction, supersedeDecisionAction } from "@/app/actions/decisions";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DECISION_LIMITS, type DecisionDetailDTO, type DecisionRef, type DecisionSummaryDTO } from "@vistoo/domain/decisions";
import { StatusBadge } from "./decision-status";

type Mode = "new" | "existing";

/**
 * "Ersetzen": the old decision stays as it is, becomes "Superseded" and points
 * to the newer one — a new decision (title only, documented afterwards) or an
 * existing one.
 */
export function SupersedeDialog({
  decision,
  open,
  onOpenChange,
  onDone,
}: {
  decision: { id: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (result: { decision: DecisionDetailDTO; successor: DecisionSummaryDTO; created: boolean }) => void;
}) {
  const [mode, setMode] = useState<Mode>("new");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DecisionRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const id = useId();

  useEffect(() => {
    if (!open || mode !== "existing" || candidates) return;
    listSupersedeCandidatesAction({ id: decision.id }).then((res) => {
      if (res.ok) setCandidates(res.data);
      else setError(res.error.message);
    });
  }, [open, mode, candidates, decision.id]);

  const reset = () => {
    setMode("new");
    setTitle("");
    setSelected(null);
    setCandidates(null);
    setError(null);
    setTitleError(null);
    setClientId(crypto.randomUUID());
  };

  const submit = () => {
    if (mode === "new" && !title.trim()) return setTitleError("Bitte gib einen Titel für die neue Entscheidung ein.");
    if (mode === "existing" && !selected) return setError("Bitte wähle eine Entscheidung.");
    startTransition(async () => {
      const res = await supersedeDecisionAction(
        mode === "new" ? { id: decision.id, newTitle: title.trim(), newId: clientId } : { id: decision.id, successorId: selected },
      );
      if (!res.ok) return setError(res.error.fieldErrors?.newTitle ?? res.error.message);
      onDone({ ...res.data, created: mode === "new" });
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Entscheidung ersetzen</DialogTitle>
            <DialogDescription>
              „{decision.title}“ bleibt vollständig erhalten, wird als Superseded markiert und verweist auf die neue Entscheidung.
            </DialogDescription>
          </DialogHeader>

          <Segmented<Mode>
            label="Ersetzen durch"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: "new", label: "Neue Entscheidung" },
              { value: "existing", label: "Bestehende wählen" },
            ]}
          />

          {mode === "new" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-title`}>Titel der neuen Entscheidung</Label>
              <Input
                id={`${id}-title`}
                autoFocus
                value={title}
                maxLength={DECISION_LIMITS.titleMax}
                placeholder="z. B. Wechseln wir von Railway zu Hetzner?"
                onChange={(e) => (setTitle(e.target.value), setTitleError(null))}
                aria-invalid={Boolean(titleError) || undefined}
                aria-describedby={titleError ? `${id}-title-error` : undefined}
              />
              <FieldError id={`${id}-title-error`} message={titleError} />
              <p className="text-xs text-muted-foreground">Optionen, Entscheidung und Begründung dokumentierst du danach.</p>
            </div>
          ) : (
            <Command className="rounded-lg border" label="Entscheidung wählen">
              <CommandInput placeholder="Entscheidung suchen …" />
              <CommandList className="max-h-60">
                {candidates === null ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Wird geladen" />
                  </div>
                ) : (
                  <>
                    <CommandEmpty>Keine passende Entscheidung.</CommandEmpty>
                    {candidates.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.title} ${c.id}`}
                        onSelect={() => (setSelected(c.id), setError(null))}
                        aria-selected={selected === c.id}
                        className={cn(selected === c.id && "bg-accent-blue-soft text-accent-blue-text data-[selected=true]:bg-accent-blue-soft")}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <StatusBadge status={c.status} className="h-5 bg-transparent px-0" />
                      </CommandItem>
                    ))}
                  </>
                )}
              </CommandList>
            </Command>
          )}

          <FormAlert message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Ersetzen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
