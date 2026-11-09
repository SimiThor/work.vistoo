"use client";

import { ArrowDownUp, Plus, Scale, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createDecisionAction, listDecisionsAction } from "@/app/actions/decisions";
import { MemberAvatar } from "@/components/member-avatar";
import { peopleMap } from "@/components/member-select";
import { ListToolbar, ToolbarReset, ToolbarSelect, toolbarButtonClass } from "@/components/list-toolbar";
import { SearchField } from "@/components/search-field";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { formatInstantDate, formatShortDate } from "@vistoo/domain/dates";
import {
  DECISION_LIMITS,
  DECISION_TYPE_LABEL,
  DECISION_TYPES,
  type DecisionSort,
  type DecisionStatus,
  type DecisionSummaryDTO,
  type DecisionType,
} from "@vistoo/domain/decisions";
import { DecisionPanel } from "./decision-panel";
import { StatusBadge, TYPE_ICON, TypeIcon } from "./decision-status";

const ALL = "__all__";
const UNASSIGNED = "none";

type Filters = { query: string; type: DecisionType | null; status: DecisionStatus | null; assignee: string | null; sort: DecisionSort };
const DEFAULT_FILTERS: Filters = { query: "", type: null, status: null, assignee: null, sort: "created" };


function compareBy(sort: DecisionSort) {
  return (a: DecisionSummaryDTO, b: DecisionSummaryDTO) =>
    sort === "created"
      ? b.createdAt.localeCompare(a.createdAt)
      : sort === "created_asc"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt);
}

/** Keeps the current URL in sync with the open entry, so it can be shared. */
function replaceEntryParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState(window.history.state, "", url);
}

const TYPE_PLURAL: Record<DecisionType, string> = { decision: "Entscheidungen", experiment: "Experimente" };

/**
 * "Decisions": decisions and experiments in one list. Capture on top (title
 * only), full-text search, filters and sort run on the server; a click opens
 * the detail panel.
 */
export function DecisionsView({
  initial,
  initialOpenId,
  members,
  former,
  meId,
}: {
  initial: DecisionSummaryDTO[];
  initialOpenId: string | null;
  members: MemberDTO[];
  former: MemberDTO[];
  meId: string;
}) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initial.length);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loading, startLoading] = useTransition();
  const [openId, setOpenIdState] = useState<string | null>(initialOpenId);
  const people = useMemo(() => peopleMap(members, former), [members, former]);
  const filtered = filters.query.trim() !== "" || filters.type !== null || filters.status !== null || filters.assignee !== null;

  const setOpenId = useCallback((id: string | null) => {
    setOpenIdState(id);
    replaceEntryParam(id);
  }, []);

  // Server-side search and filters. The query is debounced; only the latest answer counts.
  const request = useRef(0);
  const firstRun = useRef(true);
  const refresh = useCallback((f: Filters) => {
    const ticket = ++request.current;
    startLoading(async () => {
      const res = await listDecisionsAction({
        query: f.query,
        type: f.type,
        status: f.status,
        assigneeId: f.assignee,
        sort: f.sort,
      });
      if (ticket !== request.current) return;
      if (res.ok) setItems(res.data);
      else toast.error(res.error.message);
    });
  }, []);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => refresh(filters), filters.query ? 200 : 0);
    return () => clearTimeout(t);
  }, [filters, refresh]);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  /** After a local change: replace the row and keep the chosen order. */
  const upsert = (row: DecisionSummaryDTO) =>
    setItems((prev) => {
      const exists = prev.some((d) => d.id === row.id);
      const next = exists ? prev.map((d) => (d.id === row.id ? row : d)) : [row, ...prev];
      return next.sort(compareBy(filters.sort));
    });

  const onCreated = (row: DecisionSummaryDTO, open: boolean) => {
    setTotal((n) => n + 1);
    if (filtered) refresh(filters);
    else upsert(row);
    if (open) setOpenId(row.id);
    else
      toast.success(`${DECISION_TYPE_LABEL[row.type]} erfasst`, {
        action: { label: "Öffnen", onClick: () => setOpenId(row.id) },
      });
  };


  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Entscheidungen</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Entscheidungen und Experimente – was wir abgewogen, getestet und warum wir uns so entschieden haben.
      </p>

      <QuickCapture onCreated={onCreated} />

      <ListToolbar
        className="mt-5"
        label="Entscheidungen filtern"
        search={
          <SearchField
            value={filters.query}
            onChange={(query) => update({ query })}
            label="Entscheidungen durchsuchen"
          />
        }
      >
        <Segmented
          label="Typ"
          value={filters.type ?? ALL}
          onChange={(v) => update({ type: v === ALL ? null : (v as DecisionType) })}
          options={[
            { value: ALL, label: "Alle" },
            ...DECISION_TYPES.map((t) => {
              const Icon = TYPE_ICON[t];
              return { value: t, label: TYPE_PLURAL[t], icon: <Icon className="size-3.5" aria-hidden /> };
            }),
          ]}
        />
        <ToolbarSelect
          label="Verantwortlich"
          icon={<UserRound aria-hidden />}
          value={filters.assignee ?? ALL}
          defaultValue={ALL}
          defaultLabel="Person"
          onChange={(v) => update({ assignee: v === ALL ? null : v })}
          options={[
            { value: ALL, label: "Alle Personen" },
            { value: meId, label: "Mir zugewiesen" },
            ...members.filter((m) => m.userId !== meId).map((m) => ({ value: m.userId, label: displayName(m) })),
            { value: UNASSIGNED, label: "Nicht zugewiesen" },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          className={toolbarButtonClass()}
          onClick={() => update({ sort: filters.sort === "created_asc" ? "created" : "created_asc" })}
          aria-label={filters.sort === "created_asc" ? "Sortiert: älteste zuerst. Umschalten" : "Sortiert: neueste zuerst. Umschalten"}
        >
          <ArrowDownUp aria-hidden />
          {filters.sort === "created_asc" ? "Älteste" : "Neueste"}
        </Button>
        {filtered && <ToolbarReset onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} />}
      </ListToolbar>

      <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
        {items.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" role="status">
            <Scale className="mx-auto mb-2 size-5" aria-hidden />
            {total === 0 && !filtered ? (
              <>
                Noch nichts dokumentiert. Halte oben die erste Entscheidung oder ein geplantes Experiment fest –
                <br className="hidden sm:inline" /> der Titel genügt, Details folgen später.
              </>
            ) : filters.query.trim() ? (
              <>Nichts zu „{filters.query.trim()}“ gefunden – dazu gibt es wohl noch keine Entscheidung und keinen Test.</>
            ) : (
              "Keine Einträge für diese Auswahl."
            )}
          </div>
        ) : (
          <DecisionTable items={items} people={people} onOpen={setOpenId} />
        )}
      </div>

      {openId && (
        <DecisionPanel
          key={openId}
          id={openId}
          members={members}
          people={people}
          onChange={upsert}
          onCreated={() => {
            setTotal((n) => n + 1);
            refresh(filters);
          }}
          onDeleted={() => {
            setTotal((n) => n - 1);
            setOpenId(null);
            refresh(filters);
          }}
          onOpen={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function DecisionTable({
  items,
  people,
  onOpen,
}: {
  items: DecisionSummaryDTO[];
  people: Map<string, MemberDTO>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Entscheidungen</caption>
        <thead className="border-b bg-surface-subtle/60 text-left text-xs whitespace-nowrap text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Titel</th>
            <th scope="col" className="hidden w-28 px-3 py-2 font-medium md:table-cell">Typ</th>
            <th scope="col" className="w-32 px-3 py-2 font-medium sm:w-36">Status</th>
            <th scope="col" className="hidden w-[18%] px-3 py-2 font-medium lg:table-cell">Verantwortlich</th>
            <th scope="col" className="hidden w-28 px-3 py-2 font-medium xl:table-cell">Abgeschlossen</th>
            <th scope="col" className="hidden w-28 px-3 py-2 font-medium sm:table-cell">Geändert</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((d) => {
            const owner = d.assigneeId ? people.get(d.assigneeId) : undefined;
            return (
              <tr key={d.id} className="cursor-pointer hover:bg-surface-subtle/60" onClick={() => onOpen(d.id)}>
                <td className="px-4 py-2.5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <TypeIcon type={d.type} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => (e.stopPropagation(), onOpen(d.id))}
                        className={cn(
                          "block max-w-full truncate rounded text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
                          d.status === "superseded" && "text-muted-foreground",
                        )}
                      >
                        {d.title}
                      </button>
                      {d.outcomePreview && (
                        <span className="block truncate text-xs text-muted-foreground">
                          <span aria-hidden>→ </span>
                          <span className="sr-only">{d.type === "decision" ? "Entscheidung: " : "Ergebnis: "}</span>
                          {d.outcomePreview}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{DECISION_TYPE_LABEL[d.type]}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={d.status} />
                </td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  {owner ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <MemberAvatar member={owner} size="xs" />
                      <span className="truncate">{displayName(owner)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-muted-foreground tabular-nums xl:table-cell">
                  {d.concludedOn ? formatShortDate(d.concludedOn) : "–"}
                </td>
                <td className="hidden px-3 py-2.5 text-muted-foreground tabular-nums sm:table-cell">{formatInstantDate(d.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Capture in seconds: pick the type, type a title, Enter. ⌘↵ creates and
 * opens the entry for documenting right away.
 */
function QuickCapture({ onCreated }: { onCreated: (row: DecisionSummaryDTO, open: boolean) => void }) {
  const [type, setType] = useState<DecisionType>("decision");
  const [title, setTitle] = useState("");
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);

  const submit = (open: boolean) => {
    const value = title.trim();
    if (!value) return;
    // Clear right away so the next entry can be typed while this one saves.
    setTitle("");
    ref.current?.focus();
    startTransition(async () => {
      const res = await createDecisionAction({ id: crypto.randomUUID(), type, title: value });
      if (res.ok) return onCreated(res.data, open);
      toast.error(res.error.fieldErrors?.title ?? res.error.message);
      setTitle((current) => current || value);
    });
  };

  return (
    <form
      noValidate
      className="mt-5 flex items-center gap-2 rounded-xl border bg-background py-1.5 pr-1.5 pl-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <div role="radiogroup" aria-label="Typ des neuen Eintrags" className="inline-flex shrink-0 rounded-lg bg-surface-subtle p-0.5">
        {DECISION_TYPES.map((t) => {
          const Icon = TYPE_ICON[t];
          const active = type === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              title={DECISION_TYPE_LABEL[t]}
              onClick={() => (setType(t), ref.current?.focus())}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35",
                active && "bg-background font-medium text-foreground shadow-card",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{DECISION_TYPE_LABEL[t]}</span>
            </button>
          );
        })}
      </div>
      <input
        ref={ref}
        aria-label={type === "decision" ? "Neue Entscheidung" : "Neues Experiment"}
        autoComplete="off"
        value={title}
        maxLength={DECISION_LIMITS.titleMax}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit(true);
          }
        }}
        placeholder={type === "decision" ? "Welche Entscheidung steht an?" : "Was wollen wir testen?"}
        className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <span className="hidden shrink-0 text-xs text-muted-foreground/80 md:inline">↵ erfassen · ⌘↵ öffnen</span>
      <Button type="submit" size="sm" disabled={!title.trim()} className="shrink-0">
        <Plus aria-hidden />
        <span className="hidden sm:inline">Erfassen</span>
        <span className="sr-only sm:hidden">Erfassen</span>
      </Button>
    </form>
  );
}
