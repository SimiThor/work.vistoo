"use client";

import { ChevronRight, Landmark, Plus } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createAttractionAction, updateAttractionAction } from "@/app/actions/crm";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberSelect, peopleMap } from "@/components/member-select";
import { SearchField } from "@/components/search-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import {
  ATTRACTION_STATUS_COLOR,
  ATTRACTION_STATUS_LABEL,
  ATTRACTION_STATUSES,
  isContacted,
  isInterested,
  type AttractionDTO,
  type AttractionStatus,
} from "@vistoo/domain/crm";
import { formatInstantDate, formatShortDate } from "@vistoo/domain/dates";
import { isOverdueDay } from "@vistoo/domain/todos";
import { AttractionPanel } from "./attraction-panel";
import { AttractionStatusSelect } from "./crm-shared";

type Sort = "name" | "created" | "lastContact" | "followUp";
const SORT_LABEL: Record<Sort, string> = {
  name: "Name",
  created: "Neueste",
  lastContact: "Letzter Kontakt",
  followUp: "Nächstes Follow-up",
};
const ALL = "__all__";
const UNASSIGNED = "__none__";

/** Nulls always last. */
function compareNullable(a: string | null, b: string | null, dir: 1 | -1) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -dir : dir;
}

export const placeOf = (a: Pick<AttractionDTO, "city" | "country">) => [a.city, a.country].filter(Boolean).join(", ");

/**
 * CRM main view ("Attraktionen"): key figures, search, filters, sortable
 * table with inline status change; a click opens the detail panel.
 */
export function AttractionsView({
  initial,
  members,
  former,
  meId,
}: {
  initial: AttractionDTO[];
  members: MemberDTO[];
  former: MemberDTO[];
  meId: string;
}) {
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [owner, setOwner] = useState<string>(ALL);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const people = useMemo(() => peopleMap(members, former), [members, former]);
  const today = useToday();

  const upsert = (a: AttractionDTO) =>
    setItems((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a]));

  const overdueCount = items.filter((a) => isOverdueDay(a.nextFollowUp, today)).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter(
      (a) =>
        (!q || a.name.toLowerCase().includes(q) || placeOf(a).toLowerCase().includes(q)) &&
        (status === ALL || a.status === status) &&
        (owner === ALL || (owner === UNASSIGNED ? a.ownerId === null : a.ownerId === owner)) &&
        (!overdueOnly || isOverdueDay(a.nextFollowUp, today)),
    );
    const byName = (a: AttractionDTO, b: AttractionDTO) => a.name.localeCompare(b.name, "de");
    return list.sort((a, b) => {
      switch (sort) {
        case "created":
          return b.createdAt.localeCompare(a.createdAt);
        case "lastContact":
          return compareNullable(a.lastContactAt, b.lastContactAt, -1) || byName(a, b);
        case "followUp":
          return compareNullable(a.nextFollowUp, b.nextFollowUp, 1) || byName(a, b);
        default:
          return byName(a, b);
      }
    });
  }, [items, query, status, owner, overdueOnly, sort, today]);

  const changeStatus = async (a: AttractionDTO, next: AttractionStatus) => {
    if (next === a.status) return;
    upsert({ ...a, status: next });
    const res = await updateAttractionAction({ id: a.id, patch: { status: next } });
    if (res.ok) upsert(res.data);
    else {
      upsert(a);
      toast.error(res.error.message);
    }
  };

  const open = items.find((a) => a.id === openId);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Attraktionen</h1>
          <p className="mt-1 text-sm text-muted-foreground">Potenzielle Partner, Kontakte und Follow-ups.</p>
        </div>
        <Button className="h-8 shrink-0" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          <span className="hidden sm:inline">Attraktion hinzufügen</span>
          <span className="sm:hidden">Neu</span>
        </Button>
      </div>

      <dl className="mt-5 flex gap-8">
        {[
          { label: "Gesamt", value: items.length },
          { label: "Kontaktiert", value: items.filter((a) => isContacted(a.status)).length },
          { label: "Interessiert", value: items.filter((a) => isInterested(a.status)).length },
        ].map((k) => (
          <div key={k.label}>
            <dt className="text-xs text-muted-foreground">{k.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums tracking-tight">{k.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField value={query} onChange={setQuery} label="Nach Name oder Standort suchen" placeholder="Name oder Standort …" />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" aria-label="Nach Status filtern" className={cn("rounded-full", status !== ALL && "border-accent-blue/40 bg-accent-blue-soft text-accent-blue-text")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Status</SelectItem>
              {ATTRACTION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: ATTRACTION_STATUS_COLOR[s] }} />
                  {ATTRACTION_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger size="sm" aria-label="Nach Verantwortlichen filtern" className={cn("rounded-full", owner !== ALL && "border-accent-blue/40 bg-accent-blue-soft text-accent-blue-text")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Personen</SelectItem>
              <SelectItem value={meId}>Mir zugewiesen</SelectItem>
              {members
                .filter((m) => m.userId !== meId)
                .map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {displayName(m)}
                  </SelectItem>
                ))}
              <SelectItem value={UNASSIGNED}>Nicht zugewiesen</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={overdueOnly}
            onClick={() => setOverdueOnly((v) => !v)}
            className={cn("h-7 rounded-full font-normal", overdueOnly && "border-destructive/30 bg-destructive/8 text-destructive hover:bg-destructive/10 hover:text-destructive")}
          >
            Überfällig{overdueCount > 0 && <span className="tabular-nums">· {overdueCount}</span>}
          </Button>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" aria-label="Sortierung" className="rounded-full border-transparent text-muted-foreground shadow-none">
              <span className="text-muted-foreground">Sortieren:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" role="status">
          <Landmark className="mx-auto mb-2 size-5" aria-hidden />
          {items.length === 0 ? "Noch keine Attraktionen. Füge die erste hinzu." : "Keine Attraktionen für diese Auswahl."}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Attraktionen</caption>
            <thead className="border-b bg-surface-subtle/60 text-left text-xs whitespace-nowrap text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="hidden w-[18%] px-3 py-2 font-medium lg:table-cell">Standort</th>
                <th scope="col" className="w-36 px-3 py-2 font-medium">Status</th>
                <th scope="col" className="hidden w-[16%] px-3 py-2 font-medium md:table-cell">Verantwortlich</th>
                <th scope="col" className="hidden w-32 px-3 py-2 font-medium xl:table-cell">Letzter Kontakt</th>
                <th scope="col" className="hidden w-28 px-3 py-2 font-medium sm:table-cell">Follow-up</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((a) => {
                const ownerMember = a.ownerId ? people.get(a.ownerId) : undefined;
                const overdue = isOverdueDay(a.nextFollowUp, today);
                return (
                  <tr key={a.id} className="cursor-pointer hover:bg-surface-subtle/60" onClick={() => setOpenId(a.id)}>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => (e.stopPropagation(), setOpenId(a.id))}
                        className="block max-w-full truncate rounded text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
                      >
                        {a.name}
                      </button>
                      <span className="block truncate text-xs text-muted-foreground lg:hidden">
                        {placeOf(a) || a.contactName || " "}
                      </span>
                      {a.nextFollowUp && (
                        <span className={cn("block text-xs sm:hidden", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {overdue ? "Überfällig · " : "Follow-up "}
                          {formatShortDate(a.nextFollowUp)}
                        </span>
                      )}
                    </td>
                    <td className="hidden truncate px-3 py-2.5 text-muted-foreground lg:table-cell">{placeOf(a) || "–"}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <AttractionStatusSelect
                        value={a.status}
                        onChange={(s) => void changeStatus(a, s)}
                        label={`Status von ${a.name}`}
                        className="h-7 max-w-full rounded-full border-0 bg-surface-subtle text-xs"
                      />
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {ownerMember ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <MemberAvatar member={ownerMember} size="xs" />
                          <span className="truncate">{displayName(ownerMember)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground tabular-nums xl:table-cell">
                      {a.lastContactAt ? formatInstantDate(a.lastContactAt) : "–"}
                    </td>
                    <td className={cn("hidden px-3 py-2.5 tabular-nums sm:table-cell", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {a.nextFollowUp ? (
                        <>
                          {overdue && <span className="sr-only">Überfällig: </span>}
                          {formatShortDate(a.nextFollowUp)}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateAttractionDialog
        open={creating}
        onOpenChange={setCreating}
        members={members}
        onCreated={(a) => {
          upsert(a);
          setOpenId(a.id);
        }}
      />

      {open && (
        <AttractionPanel
          key={open.id}
          attraction={open}
          members={members}
          people={people}
          onChange={upsert}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((x) => x.id !== id));
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Quick create: only the name is required; more fields on demand. */
function CreateAttractionDialog({
  open,
  onOpenChange,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberDTO[];
  onCreated: (a: AttractionDTO) => void;
}) {
  const empty = {
    name: "",
    city: "",
    country: "",
    website: "",
    email: "",
    contactName: "",
    status: "new" as AttractionStatus,
    ownerId: null as string | null,
    nextFollowUp: null as string | null,
    notes: "",
  };
  const [v, setV] = useState(empty);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const id = useId();
  const set = <K extends keyof typeof empty>(k: K, value: (typeof empty)[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };
  const reset = () => {
    setV(empty);
    setMore(false);
    setErrors({});
    setFormError(null);
    setClientId(crypto.randomUUID());
  };

  const field = (k: "city" | "country" | "website" | "email" | "contactName", label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-${k}`}>{label}</Label>
      <Input
        id={`${id}-${k}`}
        value={v[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={Boolean(errors[k]) || undefined}
        aria-describedby={errors[k] ? `${id}-${k}-error` : undefined}
        {...props}
      />
      <FieldError id={`${id}-${k}-error`} message={errors[k]} />
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!v.name.trim()) return setErrors({ name: "Bitte gib einen Namen ein." });
            startTransition(async () => {
              const res = await createAttractionAction({ id: clientId, ...v });
              if (!res.ok) {
                if (res.error.fieldErrors) {
                  setErrors(res.error.fieldErrors);
                  if (Object.keys(res.error.fieldErrors).some((k) => k !== "name" && k !== "city" && k !== "country")) setMore(true);
                } else setFormError(res.error.message);
                return;
              }
              toast.success("Attraktion hinzugefügt");
              onCreated(res.data);
              reset();
              onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Attraktion hinzufügen</DialogTitle>
            <DialogDescription>Nur der Name ist nötig – alles andere kannst du später ergänzen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              autoFocus
              value={v.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z. B. Festung Hohensalzburg"
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
            />
            <FieldError id={`${id}-name-error`} message={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("city", "Stadt")}
            {field("country", "Land")}
          </div>
          {!more ? (
            <button
              type="button"
              onClick={() => setMore(true)}
              className="flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
            >
              <ChevronRight className="size-4" aria-hidden />
              Weitere Angaben
            </button>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {field("contactName", "Ansprechpartner")}
                {field("email", "E-Mail", { type: "email", inputMode: "email" })}
              </div>
              {field("website", "Website", { type: "url", inputMode: "url", placeholder: "https://…" })}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-status`}>Status</Label>
                  <AttractionStatusSelect id={`${id}-status`} size="default" value={v.status} onChange={(s) => set("status", s)} className="w-full" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-owner`}>Verantwortlich</Label>
                  <MemberSelect id={`${id}-owner`} value={v.ownerId} onChange={(o) => set("ownerId", o)} members={members} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-follow`}>Follow-up</Label>
                  <Input id={`${id}-follow`} type="date" value={v.nextFollowUp ?? ""} onChange={(e) => set("nextFollowUp", e.target.value || null)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-notes`}>Notizen</Label>
                <textarea
                  id={`${id}-notes`}
                  value={v.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={3}
                  className="block w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
                />
              </div>
            </div>
          )}
          <FormAlert message={formError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
