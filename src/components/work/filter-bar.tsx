"use client";

import { Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { ProjectDot } from "@/components/project-dot";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayName, STATUS_LABEL, TASK_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { hasActiveFilters, NO_GROUP, UNASSIGNED, type Filters, type WorkUrlState } from "./filters";
import { useWork } from "./work-context";

type Option = { value: string; label: string; icon?: React.ReactNode; group?: string };

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const active = selected.length > 0;
  const groups = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of options) {
      const g = o.group ?? "";
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    return [...m.entries()];
  }, [options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 shrink-0 gap-1 rounded-full px-3 font-normal",
            active && "border-accent-blue/40 bg-accent-blue-soft text-accent-blue-text hover:bg-accent-blue-soft",
          )}
          aria-label={active ? `${label}: ${selected.length} ausgewählt` : label}
        >
          {label}
          {active && <span className="tabular-nums">· {selected.length}</span>}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          {searchable && <CommandInput placeholder={`${label} suchen …`} />}
          <CommandList>
            <CommandEmpty>Keine Treffer.</CommandEmpty>
            {groups.map(([group, opts]) => (
              <CommandGroup key={group || "_"} heading={group || undefined}>
                {opts.map((o) => {
                  const checked = selected.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.label} ${o.group ?? ""} ${o.value}`}
                      onSelect={() => toggle(o.value)}
                      aria-checked={checked}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-[4px] border border-border-strong",
                          checked && "border-accent-blue bg-accent-blue text-white",
                        )}
                        aria-hidden
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      {o.icon}
                      <span className="truncate">{o.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          {active && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => onChange([])}>
                Auswahl aufheben
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // External change (reset, back/forward)
    setLastValue(value);
    setLocal(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const id = useId();
  return (
    <div className="relative w-full shrink-0 md:w-52">
      <label htmlFor={id} className="sr-only">
        Aufgaben nach Titel suchen
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        value={local}
        placeholder="Suchen …"
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v), 200);
        }}
        className="h-8 w-full rounded-full border border-input bg-background pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label="Suche leeren"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (patch: Partial<WorkUrlState>, mode?: "push" | "replace") => void;
}) {
  const { scope, projects, members, me } = useWork();
  const activeProjects = projects.filter((p) => !p.archived);

  const projectOptions: Option[] = activeProjects.map((p) => ({
    value: p.id,
    label: p.name,
    icon: <ProjectDot color={p.color} />,
  }));

  // Groups: in the global view, scoped to the selected projects (or all).
  const groupOptions: Option[] = useMemo(() => {
    const source =
      scope.kind === "project"
        ? projects.filter((p) => p.id === scope.projectId)
        : activeProjects.filter((p) => !filters.projects.length || filters.projects.includes(p.id));
    const showProject = scope.kind === "all" && source.length > 1;
    return [
      { value: NO_GROUP, label: "Ohne Gruppe" },
      ...source.flatMap((p) =>
        p.groups.map((g) => ({ value: g.id, label: g.name, group: showProject ? p.name : undefined })),
      ),
    ];
  }, [scope, projects, activeProjects, filters.projects]);

  const assigneeOptions: Option[] = [
    { value: UNASSIGNED, label: "Nicht zugewiesen", icon: <UserRound className="size-4 text-muted-foreground" aria-hidden /> },
    ...members.map((m) => ({
      value: m.userId,
      label: m.userId === me.userId ? `${displayName(m)} (ich)` : displayName(m),
      icon: <MemberAvatar member={m} size="xs" />,
    })),
  ];

  const statusOptions: Option[] = TASK_STATUSES.map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
    icon: <StatusIcon status={s} />,
  }));

  const mine = filters.assignees.length === 1 && filters.assignees[0] === me.userId;
  const active = hasActiveFilters(filters);

  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center" role="search" aria-label="Aufgaben filtern">
      <SearchField value={filters.q} onChange={(q) => onChange({ q }, "replace")} />
      {/* Chips scroll horizontally inside this row on small screens */}
      <div className="-mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6 md:mx-0 md:px-0 xl:flex-wrap xl:overflow-visible xl:pb-0">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mine}
          onClick={() => onChange({ assignees: mine ? [] : [me.userId] })}
          className={cn(
            "h-8 shrink-0 rounded-full px-3 font-normal",
            mine && "border-accent-blue/40 bg-accent-blue-soft text-accent-blue-text hover:bg-accent-blue-soft",
          )}
        >
          Meine Aufgaben
        </Button>
        {scope.kind === "all" && (
          <MultiSelectFilter
            label="Projekt"
            options={projectOptions}
            selected={filters.projects}
            onChange={(v) => onChange({ projects: v })}
            searchable={projectOptions.length > 6}
          />
        )}
        <MultiSelectFilter
          label="Gruppe"
          options={groupOptions}
          selected={filters.groups}
          onChange={(v) => onChange({ groups: v })}
          searchable={groupOptions.length > 8}
        />
        <MultiSelectFilter
          label="Person"
          options={assigneeOptions}
          selected={filters.assignees}
          onChange={(v) => onChange({ assignees: v })}
          searchable={assigneeOptions.length > 8}
        />
        <MultiSelectFilter
          label="Status"
          options={statusOptions}
          selected={filters.statuses}
          onChange={(v) => onChange({ statuses: v as Filters["statuses"] })}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-muted-foreground"
            onClick={() => onChange({ q: "", projects: [], groups: [], assignees: [], statuses: [] })}
          >
            Filter zurücksetzen
          </Button>
        )}
      </div>
    </div>
  );
}
