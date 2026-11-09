"use client";

import { ArrowDownUp, Lightbulb, Plus, SquareKanban } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createIdeaAction, updateIdeaAction } from "@/app/actions/ideas";
import { MemberAvatar } from "@/components/member-avatar";
import { peopleMap } from "@/components/member-select";
import { SearchField } from "@/components/search-field";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO, type ProjectDTO } from "@vistoo/domain";
import { formatInstantDate } from "@vistoo/domain/dates";
import { IDEA_LIMITS, IDEA_STATUS_LABEL, IDEA_STATUSES, type IdeaDTO, type IdeaStatus } from "@vistoo/domain/ideas";
import { IdeaPanel } from "./idea-panel";
import { IdeaStatusSelect } from "./idea-status";

type Filter = "all" | IdeaStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Alle" },
  ...IDEA_STATUSES.map((s) => ({ value: s as Filter, label: IDEA_STATUS_LABEL[s] })),
];

/**
 * "Ideen": shared backlog. Quick add on top, searchable list with status
 * filter; clicking an idea opens the side panel.
 */
export function IdeasView({
  initial,
  initialOpenId = null,
  members,
  former,
  projects,
}: {
  initial: IdeaDTO[];
  initialOpenId?: string | null;
  members: MemberDTO[];
  former: MemberDTO[];
  projects: ProjectDTO[];
}) {
  const [ideas, setIdeas] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const people = useMemo(() => peopleMap(members, former), [members, former]);

  const upsert = (idea: IdeaDTO) =>
    setIdeas((prev) => (prev.some((i) => i.id === idea.id) ? prev.map((i) => (i.id === idea.id ? idea : i)) : [idea, ...prev]));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ideas
      .filter((i) => (filter === "all" || i.status === filter))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
      .sort((a, b) => (newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  }, [ideas, query, filter, newestFirst]);

  const setStatus = async (idea: IdeaDTO, status: IdeaStatus) => {
    upsert({ ...idea, status });
    const res = await updateIdeaAction({ id: idea.id, patch: { status } });
    if (res.ok) upsert(res.data);
    else {
      upsert(idea);
      toast.error(res.error.message);
    }
  };

  const openIdea = ideas.find((i) => i.id === openId);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Ideen</h1>
      <p className="mt-1 text-sm text-muted-foreground">Gemeinsame Sammlung für Features, Verbesserungen und Geschäftsideen.</p>

      <QuickAddIdea onCreated={upsert} />

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchField value={query} onChange={setQuery} label="Ideen durchsuchen" />
        <div className="flex items-center gap-2 overflow-x-auto">
          <Segmented label="Status" value={filter} onChange={setFilter} options={FILTERS} />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => setNewestFirst((v) => !v)}
            aria-label={newestFirst ? "Sortiert: neueste zuerst. Umschalten" : "Sortiert: älteste zuerst. Umschalten"}
          >
            <ArrowDownUp aria-hidden />
            {newestFirst ? "Neueste" : "Älteste"}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" role="status">
          <Lightbulb className="mx-auto mb-2 size-5" aria-hidden />
          {ideas.length === 0 ? "Noch keine Ideen. Schreib oben die erste auf." : "Keine Ideen für diese Auswahl."}
        </div>
      ) : (
        <ul className="mt-4 divide-y rounded-xl border" aria-label="Ideen">
          {visible.map((idea) => {
            const assignee = idea.assigneeId ? people.get(idea.assigneeId) : null;
            return (
              <li key={idea.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle/60">
                <button
                  type="button"
                  onClick={() => setOpenId(idea.id)}
                  className="min-w-0 flex-1 rounded py-0.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
                >
                  <span className={cn("block truncate text-sm font-medium", idea.status === "irrelevant" && "text-muted-foreground")}>
                    {idea.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatInstantDate(idea.createdAt)}
                    {idea.description && ` · ${idea.description.split("\n")[0]}`}
                  </span>
                </button>
                {idea.task && (
                  <SquareKanban className="size-4 shrink-0 text-muted-foreground" aria-label="Issue erstellt" role="img" />
                )}
                {assignee && (
                  <span title={displayName(assignee)} className="hidden sm:inline-flex">
                    <MemberAvatar member={assignee} size="sm" />
                  </span>
                )}
                <IdeaStatusSelect
                  value={idea.status}
                  onChange={(s) => void setStatus(idea, s)}
                  label={`Status von „${idea.title}“`}
                  className="h-7 shrink-0 rounded-full border-0 bg-surface-subtle text-xs"
                />
              </li>
            );
          })}
        </ul>
      )}

      {openIdea && (
        <IdeaPanel
          key={openIdea.id}
          idea={openIdea}
          members={members}
          people={people}
          projects={projects}
          onChange={upsert}
          onDeleted={(id) => {
            setIdeas((prev) => prev.filter((i) => i.id !== id));
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function QuickAddIdea({ onCreated }: { onCreated: (i: IdeaDTO) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const submit = () => {
    const value = title.trim();
    if (!value) return;
    const description = body.trim();
    // Clear right away so the next idea can be typed while this one saves.
    setTitle("");
    setBody("");
    ref.current?.focus();
    startTransition(async () => {
      const res = await createIdeaAction({ id: crypto.randomUUID(), title: value, description });
      if (res.ok) return onCreated(res.data);
      toast.error(res.error.fieldErrors?.title ?? res.error.fieldErrors?.description ?? res.error.message);
      setTitle((current) => current || value);
      setBody((current) => current || description);
    });
  };
  // The text field shows up once a title is typed (or text is already there),
  // so the quick "type + Enter" flow stays a single line.
  const expanded = title.trim() !== "" || body !== "";
  return (
    <form
      noValidate
      className="mt-5 rounded-xl border bg-background px-3 py-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={ref}
          aria-label="Neue Idee"
          autoComplete="off"
          value={title}
          maxLength={IDEA_LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Neue Idee – mit Enter hinzufügen"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Hinzufügen
        </Button>
      </div>
      {expanded && (
        <textarea
          aria-label="Text der neuen Idee"
          value={body}
          maxLength={IDEA_LIMITS.descriptionMax}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Text (optional) – Details, Begründung, offene Fragen … ⌘↵ zum Hinzufügen"
          className="field-sizing-content mt-1 mb-1 block max-h-80 min-h-16 w-full resize-none border-t bg-transparent pt-2 pl-6 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      )}
    </form>
  );
}
