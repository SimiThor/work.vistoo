"use client";

import { Check, Flag, FolderKanban, UserRound, UserRoundCheck } from "lucide-react";
import { useMemo } from "react";
import { ListToolbar, ToolbarChevron, ToolbarReset, ToolbarToggle, toolbarButtonClass } from "@/components/list-toolbar";
import { MemberAvatar } from "@/components/member-avatar";
import { ProjectDot } from "@/components/project-dot";
import { SearchField } from "@/components/search-field";
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
import { displayName } from "@vistoo/domain";
import { cn } from "@/lib/utils";
import { hasActiveFilters, NO_MILESTONE, UNASSIGNED, type WorkUrlState } from "./filters";
import { useWork } from "./work-context";

type Option = { value: string; label: string; icon?: React.ReactNode; group?: string };

function MultiSelectFilter({
  label,
  icon,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  icon: React.ReactNode;
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
        <Button variant="ghost" size="sm" className={toolbarButtonClass(active)} aria-label={active ? `${label}: ${selected.length} ausgewählt` : label}>
          {icon}
          {label}
          {active && <span className="tabular-nums">· {selected.length}</span>}
          <ToolbarChevron />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
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

export function FilterBar({
  filters,
  onChange,
  children,
}: {
  filters: WorkUrlState;
  onChange: (patch: Partial<WorkUrlState>, mode?: "push" | "replace") => void;
  /** View switches of the page, shown after the filters. */
  children?: React.ReactNode;
}) {
  const { scope, projects, milestones, members, me } = useWork();
  const activeProjects = projects.filter((p) => !p.archived);

  const projectOptions: Option[] = activeProjects.map((p) => ({
    value: p.id,
    label: p.name,
    icon: <ProjectDot color={p.color} />,
  }));

  // Open milestones first; completed ones stay filterable under their own heading.
  const milestoneOptions: Option[] = [
    { value: NO_MILESTONE, label: "Ohne Meilenstein" },
    ...milestones.map((m) => ({
      value: m.id,
      label: m.name,
      icon: <Flag className="size-3.5 text-muted-foreground" aria-hidden />,
      group: m.completed ? "Abgeschlossen" : undefined,
    })),
  ];

  const assigneeOptions: Option[] = [
    { value: UNASSIGNED, label: "Nicht zugewiesen", icon: <UserRound className="size-4 text-muted-foreground" aria-hidden /> },
    ...members.map((m) => ({
      value: m.userId,
      label: m.userId === me.userId ? `${displayName(m)} (ich)` : displayName(m),
      icon: <MemberAvatar member={m} size="xs" />,
    })),
  ];

  const mine = filters.assignees.length === 1 && filters.assignees[0] === me.userId;
  const active = hasActiveFilters(filters);

  return (
    <ListToolbar
      label="Aufgaben filtern"
      search={<SearchField value={filters.q} onChange={(q) => onChange({ q }, "replace")} label="Aufgaben nach Titel suchen" debounceMs={200} />}
    >
      <ToolbarToggle pressed={mine} onPressedChange={(on) => onChange({ assignees: on ? [me.userId] : [] })} icon={<UserRoundCheck aria-hidden />}>
        Meine Aufgaben
      </ToolbarToggle>
      {scope.kind !== "project" && (
        <MultiSelectFilter
          label="Projekt"
          icon={<FolderKanban aria-hidden />}
          options={projectOptions}
          selected={filters.projects}
          onChange={(v) => onChange({ projects: v })}
          searchable={projectOptions.length > 6}
        />
      )}
      {scope.kind !== "milestone" && (
        <MultiSelectFilter
          label="Meilenstein"
          icon={<Flag aria-hidden />}
          options={milestoneOptions}
          selected={filters.milestones}
          onChange={(v) => onChange({ milestones: v })}
          searchable={milestoneOptions.length > 8}
        />
      )}
      <MultiSelectFilter
        label="Person"
        icon={<UserRound aria-hidden />}
        options={assigneeOptions}
        selected={filters.assignees}
        onChange={(v) => onChange({ assignees: v })}
        searchable={assigneeOptions.length > 8}
      />
      {active && <ToolbarReset onClick={() => onChange(CLEARED_FILTERS)} />}
      {children && <div className="ml-1 flex shrink-0 items-center gap-2">{children}</div>}
    </ListToolbar>
  );
}

/** URL patch that clears every filter (search included). */
export const CLEARED_FILTERS: Partial<WorkUrlState> = { q: "", projects: [], milestones: [], assignees: [] };
