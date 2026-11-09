"use client";

import { ArrowRight, ArrowRightLeft, CornerDownRight, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteDecisionAction, getDecisionAction, updateDecisionAction } from "@/app/actions/decisions";
import { FormAlert } from "@/components/form-feedback";
import { MemberSelect } from "@/components/member-select";
import { PanelField, SidePanel } from "@/components/side-panel";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { formatInstantDate, formatLongDate } from "@vistoo/domain/dates";
import {
  completionErrors,
  DECISION_LIMITS,
  DECISION_TYPE_LABEL,
  DECISION_TYPES,
  fieldLabel,
  FIELDS_BY_TYPE,
  isConcluded,
  statusForType,
  summaryOf,
  teamToday,
  type DecisionDetailDTO,
  type DecisionDTO,
  type DecisionRef,
  type DecisionStatus,
  type DecisionSummaryDTO,
  type DecisionTextField,
  type DecisionType,
} from "@vistoo/domain/decisions";
import { DecisionHistory } from "./decision-history";
import { DecisionStatusSelect, StatusBadge, TypeIcon } from "./decision-status";
import { SupersedeDialog } from "./supersede-dialog";

type Values = Pick<DecisionDTO, "type" | "title" | "status" | "assigneeId" | "concludedOn" | DecisionTextField>;

const valuesOf = (d: DecisionDTO): Values => ({
  type: d.type,
  title: d.title,
  status: d.status,
  assigneeId: d.assigneeId,
  concludedOn: d.concludedOn,
  description: d.description,
  optionsConsidered: d.optionsConsidered,
  objective: d.objective,
  testDescription: d.testDescription,
  results: d.results,
  outcome: d.outcome,
  reasoning: d.reasoning,
});

/** Guidance per section (placeholder), short enough to stay out of the way. */
const PLACEHOLDER: Record<DecisionType, Partial<Record<DecisionTextField, string>>> = {
  decision: {
    description: "Worum geht es, und warum müssen wir das entscheiden?",
    optionsConsidered: "Eine Option pro Zeile – z. B.\nRailway\nHetzner\nAWS",
    outcome: "Wofür haben wir uns entschieden?",
    reasoning: "Warum? Welche Abwägungen waren ausschlaggebend?",
  },
  experiment: {
    description: "Was testen wir und warum? Umfang, Setup, Kriterien",
    results: "Beobachtungen, Messwerte und Fazit",
  },
};

/** Loads the full entry, then shows the editor. */
export function DecisionPanel({
  id,
  members,
  people,
  onChange,
  onCreated,
  onDeleted,
  onOpen,
  onClose,
}: {
  id: string;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  onChange: (row: DecisionSummaryDTO) => void;
  onCreated: (row: DecisionSummaryDTO) => void;
  onDeleted: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DecisionDetailDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDecisionAction({ id }).then((res) => {
      if (cancelled) return;
      if (res.ok) return setDetail(res.data);
      toast.error(res.error.code === "NOT_FOUND" ? "Diesen Eintrag gibt es nicht (mehr)." : res.error.message);
      onClose();
    });
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  if (!detail) {
    return (
      <SidePanel title="Entscheidung" description="Eintrag wird geladen" onClose={onClose}>
        <div className="space-y-4" aria-busy="true" aria-label="Eintrag wird geladen">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </SidePanel>
    );
  }
  return (
    <DecisionEditor
      detail={detail}
      setDetail={setDetail}
      members={members}
      people={people}
      onChange={onChange}
      onCreated={onCreated}
      onDeleted={onDeleted}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}

function DecisionEditor({
  detail,
  setDetail,
  members,
  people,
  onChange,
  onCreated,
  onDeleted,
  onOpen,
  onClose,
}: {
  detail: DecisionDetailDTO;
  setDetail: (d: DecisionDetailDTO) => void;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  onChange: (row: DecisionSummaryDTO) => void;
  onCreated: (row: DecisionSummaryDTO) => void;
  onDeleted: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const decision = detail.decision;
  const [base, setBase] = useState(() => valuesOf(decision));
  const [values, setValues] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [superseding, setSuperseding] = useState(false);
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;

  const patch = useMemo(() => {
    const p: Record<string, unknown> = {};
    for (const k of Object.keys(values) as (keyof Values)[]) {
      const a = k === "title" ? base[k].trim() : base[k];
      const b = k === "title" ? values[k].trim() : values[k];
      if (a !== b && !(k === "concludedOn" && b === null)) p[k] = b;
    }
    return p;
  }, [base, values]);
  const dirty = Object.keys(patch).length > 0;

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
    setFormError(null);
  };

  const setStatus = (status: DecisionStatus) =>
    setValues((prev) => ({
      ...prev,
      status,
      // Concluding: the day is set automatically and stays editable.
      concludedOn: isConcluded(status) ? (prev.concludedOn ?? base.concludedOn ?? teamToday()) : null,
    }));

  const setType = (type: DecisionType) =>
    setValues((prev) => ({ ...prev, type, status: statusForType(type, prev.status) }));

  const applySaved = (next: DecisionDetailDTO) => {
    setDetail(next);
    onChange(summaryOf(next.decision));
    setBase(valuesOf(next.decision));
    setValues(valuesOf(next.decision));
  };

  const save = () => {
    if (!values.title.trim()) return setErrors({ title: "Bitte gib einen Titel ein." });
    if (!dirty || pending) return;
    const missing = completionErrors(values);
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      setFormError(
        values.type === "decision"
          ? "Für „Decided“ brauchen wir die finale Entscheidung und eine Begründung."
          : "Zum Abschluss brauchen wir ein Ergebnis.",
      );
      document.getElementById(fid(missing.results ? "results" : missing.outcome ? "outcome" : "reasoning"))?.focus();
      return;
    }
    startTransition(async () => {
      const res = await updateDecisionAction({ id: decision.id, patch });
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        return setFormError(res.error.message);
      }
      setErrors({});
      setFormError(null);
      applySaved(res.data);
      toast.success("Gespeichert");
    });
  };

  const concludedNow = isConcluded(values.status);
  const concludedBefore = isConcluded(base.status);
  const required = (k: DecisionTextField) =>
    concludedNow &&
    (values.type === "decision" ? k === "outcome" || k === "reasoning" : k === "results");
  const creator = people.get(decision.createdBy);
  const canSupersede = decision.type === "decision" && base.status === "decided";

  return (
    <SidePanel
      title={DECISION_TYPE_LABEL[decision.type]}
      description="Eintrag ansehen und dokumentieren"
      dirty={dirty}
      onClose={onClose}
      headerActions={
        canSupersede && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={dirty}
            title={dirty ? "Bitte zuerst speichern" : "Durch eine neuere Entscheidung ersetzen"}
            onClick={() => setSuperseding(true)}
          >
            <ArrowRightLeft aria-hidden />
            Ersetzen
          </Button>
        )
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/8 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            <span className="hidden sm:inline">Löschen</span>
            <span className="sr-only sm:hidden">Löschen</span>
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Schließen
            </Button>
            <Button type="button" onClick={save} disabled={!dirty || pending} className="min-w-24">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Speichern
            </Button>
          </div>
        </>
      }
    >
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        {/* Header: title, then the traceability chain right where it matters. */}
        <div className="space-y-3">
          <div>
            <label htmlFor={fid("title")} className="sr-only">
              Titel
            </label>
            <textarea
              id={fid("title")}
              data-autofocus
              rows={1}
              value={values.title}
              maxLength={DECISION_LIMITS.titleMax}
              onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.preventDefault()}
              aria-invalid={Boolean(errors.title) || undefined}
              className="field-sizing-content -mx-1 block w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-lg leading-snug font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
            />
            {errors.title && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {errors.title}
              </p>
            )}
          </div>
          {decision.supersededBy && (
            <ChainNote
              label="Ersetzt durch"
              target={decision.supersededBy}
              onOpen={onOpen}
              className="border-amber-500/25 bg-amber-500/6"
              icon={<ArrowRight className="size-4 text-amber-700 dark:text-amber-400" aria-hidden />}
            />
          )}
          {decision.supersedes.map((p) => (
            <ChainNote
              key={p.id}
              label="Ersetzt die frühere Entscheidung"
              target={p}
              onOpen={onOpen}
              icon={<CornerDownRight className="size-4 text-muted-foreground" aria-hidden />}
            />
          ))}
        </div>

        <div className="space-y-2.5">
          <PanelField label="Typ" htmlFor={fid("type")}>
            <Select value={values.type} onValueChange={(v) => setType(v as DecisionType)} disabled={concludedBefore}>
              <SelectTrigger id={fid("type")} className="w-full" title={concludedBefore ? "Abgeschlossene Einträge behalten ihren Typ" : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    <TypeIcon type={t} decorative />
                    {DECISION_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PanelField>
          <PanelField label="Status" htmlFor={fid("status")} error={errors.status}>
            {values.status === "superseded" ? (
              <div className="flex h-8 items-center justify-between gap-2">
                <StatusBadge status="superseded" />
                <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setStatus("decided")}>
                  Wieder gültig machen
                </Button>
              </div>
            ) : (
              <DecisionStatusSelect id={fid("status")} type={values.type} value={values.status} onChange={setStatus} />
            )}
          </PanelField>
          <PanelField label="Verantwortlich" htmlFor={fid("assignee")}>
            <MemberSelect id={fid("assignee")} value={values.assigneeId} onChange={(v) => set("assigneeId", v)} members={members} />
          </PanelField>
          {concludedNow && (
            <PanelField label={fieldLabel(values.type, "concludedOn")} htmlFor={fid("concludedOn")} error={errors.concludedOn}>
              <Input
                id={fid("concludedOn")}
                type="date"
                value={values.concludedOn ?? ""}
                onChange={(e) => set("concludedOn", e.target.value || (base.concludedOn ?? teamToday()))}
              />
            </PanelField>
          )}
        </div>

        {concludedBefore && (
          <p className="rounded-lg bg-surface-subtle/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {decision.type === "decision" ? "Entschieden" : "Abgeschlossen"}
            {decision.concludedOn && ` am ${formatLongDate(decision.concludedOn)}`}. Korrekturen sind möglich – Änderungen
            werden mit der vorherigen Fassung im Verlauf festgehalten.
            {canSupersede && " Hat sich die Entscheidung geändert? Dann besser „Ersetzen“."}
          </p>
        )}

        <div className="space-y-5">
          {FIELDS_BY_TYPE[values.type].map((k) => (
            <TextSection
              key={k}
              id={fid(k)}
              label={fieldLabel(values.type, k)}
              value={values[k]}
              placeholder={PLACEHOLDER[values.type][k]}
              required={required(k)}
              error={errors[k]}
              prominent={k === (values.type === "decision" ? "outcome" : "results")}
              onChange={(v) => set(k, v)}
            />
          ))}
        </div>
        <FormAlert message={formError} />
      </form>

      <div className="mt-8 space-y-6 border-t pt-6">
        <DecisionHistory history={detail.history} type={decision.type} people={people} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Erstellt von {creator ? displayName(creator) : "ehemaligem Mitglied"} am {formatInstantDate(decision.createdAt, "long")}
        {decision.updatedAt !== decision.createdAt && ` · geändert am ${formatInstantDate(decision.updatedAt, "long")}`}
      </p>

      {canSupersede && (
        <SupersedeDialog
          decision={decision}
          open={superseding}
          onOpenChange={setSuperseding}
          onDone={({ decision: next, successor, created }) => {
            applySaved(next);
            onCreated(successor);
            if (created) {
              toast.success("Ersetzt – jetzt die neue Entscheidung dokumentieren");
              onOpen(successor.id);
            } else {
              toast.success("Entscheidung ersetzt", { action: { label: "Öffnen", onClick: () => onOpen(successor.id) } });
            }
          }}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{DECISION_TYPE_LABEL[decision.type]} löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{decision.title}“ wird mit Verlauf für alle gelöscht.
              {decision.supersedes.length > 0 && " Die ersetzte frühere Entscheidung gilt danach wieder."}
              {concludedBefore && " Statt zu löschen kannst du eine Entscheidung auch ersetzen – dann bleibt die Historie erhalten."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const res = await deleteDecisionAction({ id: decision.id });
                if (!res.ok && res.error.code !== "NOT_FOUND") return void toast.error(res.error.message);
                toast.success("Gelöscht");
                onDeleted(decision.id);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePanel>
  );
}

function TextSection({
  id,
  label,
  value,
  placeholder,
  required,
  error,
  prominent,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  required: boolean;
  error?: string;
  prominent?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-[13px] font-medium text-foreground/80">
        {label}
        {required && <span className="text-xs font-normal text-muted-foreground">· erforderlich</span>}
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={DECISION_LIMITS.textMax}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-required={required || undefined}
        className={cn(
          "field-sizing-content block min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 aria-invalid:border-destructive/60",
          prominent && value && "bg-surface-subtle/50 font-medium",
        )}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Ersetzt durch …" / "Ersetzt die frühere Entscheidung …": opens the other entry. */
function ChainNote({
  label,
  target,
  onOpen,
  icon,
  className,
}: {
  label: string;
  target: DecisionRef;
  onOpen: (id: string) => void;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(target.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm outline-none hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/35",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate font-medium">{target.title}</span>
      </span>
      <StatusBadge status={target.status} className="hidden sm:inline-flex" />
    </button>
  );
}
