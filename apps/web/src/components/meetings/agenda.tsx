"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Scale,
  SquareKanban,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAgendaItemAction,
  deleteAgendaItemAction,
  reorderAgendaAction,
  updateAgendaItemAction,
} from "@/app/actions/meetings";
import { MemberPicker } from "@/components/chat/member-picker";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberSelect } from "@/components/member-select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO, type ProjectDTO } from "@vistoo/domain";
import { formatInstantDate } from "@vistoo/domain/dates";
import { setChecklistItem } from "@vistoo/domain/markdown";
import {
  AGENDA_TEXT_FIELDS,
  MEETING_LIMITS,
  type AgendaItemDTO,
  type AgendaItemPatch,
  type MeetingSummaryDTO,
} from "@vistoo/domain/meetings";
import { CreateDecisionDialog, CreateIssueDialog, LinkExistingPopover, RelationChips } from "./agenda-relations";

type Ctx = {
  meeting: Pick<MeetingSummaryDTO, "id" | "title" | "startsAt">;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  projects: ProjectDTO[];
  meId: string;
};

const nameOf = (people: Map<string, MemberDTO>, id: string) => {
  const m = people.get(id);
  return m ? displayName(m) : "Ehemaliges Mitglied";
};

/**
 * The shared agenda: numbered points in a calm vertical list. Everyone can
 * add, edit, reorder (drag & drop or menu), assign, mark as discussed and
 * document the outcome. `pendingIds` keeps optimistic points through reloads.
 */
export function Agenda({
  agenda,
  setAgenda,
  pendingIds,
  ...ctx
}: Ctx & {
  agenda: AgendaItemDTO[];
  setAgenda: (update: (prev: AgendaItemDTO[]) => AgendaItemDTO[]) => void;
  pendingIds: React.RefObject<Set<string>>;
}) {
  const discussed = agenda.filter((i) => i.status === "discussed").length;

  const replace = (item: AgendaItemDTO) => setAgenda((prev) => prev.map((i) => (i.id === item.id ? item : i)));
  const remove = (id: string) => setAgenda((prev) => prev.filter((i) => i.id !== id));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistOrder = async (next: AgendaItemDTO[], before: AgendaItemDTO[]) => {
    setAgenda(() => next.map((i, idx) => ({ ...i, position: (idx + 1) * 1024 })));
    const res = await reorderAgendaAction({ meetingId: ctx.meeting.id, ids: next.map((i) => i.id) });
    if (!res.ok) {
      setAgenda(() => before);
      return void toast.error(res.error.message);
    }
    // The server's order (it keeps points added meanwhile by others).
    const order = new Map(res.data.map((r) => [r.id, r.position]));
    setAgenda((prev) =>
      prev.map((i) => ({ ...i, position: order.get(i.id) ?? i.position })).sort((a, b) => a.position - b.position),
    );
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = agenda.map((i) => i.id);
    void persistOrder(arrayMove(agenda, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))), agenda);
  };
  const move = (id: string, delta: -1 | 1) => {
    const from = agenda.findIndex((i) => i.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= agenda.length) return;
    void persistOrder(arrayMove(agenda, from, to), agenda);
  };

  const titleOf = (id: string | number) => agenda.find((i) => i.id === id)?.title ?? "Punkt";

  return (
    <section aria-labelledby="agenda-heading" className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="agenda-heading" className="text-base font-semibold tracking-tight">
          Agenda
        </h2>
        {agenda.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {discussed} von {agenda.length} besprochen
          </span>
        )}
      </div>

      {agenda.length > 0 && (
        <DndContext
          // Stable id: the auto-generated one differs between server and client (hydration).
          id={`agenda-${ctx.meeting.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `„${titleOf(active.id)}“ aufgenommen.`,
              onDragOver: ({ active, over }) => (over ? `„${titleOf(active.id)}“ über „${titleOf(over.id)}“.` : ""),
              onDragEnd: ({ active }) => `„${titleOf(active.id)}“ abgelegt.`,
              onDragCancel: ({ active }) => `Verschieben von „${titleOf(active.id)}“ abgebrochen.`,
            },
            screenReaderInstructions: {
              draggable: "Leertaste zum Aufnehmen, Pfeiltasten zum Verschieben, Leertaste zum Ablegen, Escape zum Abbrechen.",
            },
          }}
        >
          <SortableContext items={agenda.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2.5" aria-label="Agenda-Punkte">
              {agenda.map((item, index) => (
                <SortableItem key={item.id} item={item}>
                  <AgendaItemCard
                    item={item}
                    index={index}
                    count={agenda.length}
                    onChange={replace}
                    onRemove={() => remove(item.id)}
                    onMove={(d) => move(item.id, d)}
                    {...ctx}
                  />
                </SortableItem>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <AddItem
        {...ctx}
        empty={agenda.length === 0}
        full={agenda.length >= MEETING_LIMITS.agendaItemsPerMeeting}
        onAdding={(temp) => {
          pendingIds.current.add(temp.id);
          setAgenda((prev) => [...prev, temp]);
        }}
        onAdded={(item) => {
          pendingIds.current.delete(item.id);
          setAgenda((prev) => (prev.some((i) => i.id === item.id) ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item]));
        }}
        onFailed={(id) => {
          pendingIds.current.delete(id);
          remove(id);
        }}
      />
    </section>
  );
}

function SortableItem({ item, children }: { item: AgendaItemDTO; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/item relative", isDragging && "z-10 [&>div]:shadow-raised")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`„${item.title}“ verschieben`}
        className="absolute top-4 -left-6 hidden size-5 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/35 active:cursor-grabbing sm:flex sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus-visible:opacity-100"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------
// One agenda point
// ---------------------------------------------------------------------------

type Mode = "view" | "edit" | "outcome";
type TextBase = Pick<AgendaItemDTO, "version" | (typeof AGENDA_TEXT_FIELDS)[number]>;

function AgendaItemCard({
  item,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  meeting,
  members,
  people,
  projects,
}: Ctx & {
  item: AgendaItemDTO;
  index: number;
  count: number;
  onChange: (item: AgendaItemDTO) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [conflict, setConflict] = useState<{ current: AgendaItemDTO; patch: AgendaItemPatch } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dialog, setDialog] = useState<"issue" | "decision" | null>(null);
  const [linking, setLinking] = useState<"issue" | "decision" | null>(null);
  const [saving, startSaving] = useTransition();
  const handOff = useRef(false);
  const pendingTemp = item.version === 0;
  const discussed = item.status === "discussed";
  const creator = nameOf(people, item.createdBy);

  /**
   * Saves a patch made from `base`. A conflict on text someone else did not
   * touch is retried transparently (e.g. only the status changed meanwhile);
   * a real conflict keeps the draft and asks what to do.
   */
  const save = (patch: AgendaItemPatch, base: TextBase, after?: () => void) =>
    startSaving(async () => {
      let res = await updateAgendaItemAction({ id: item.id, version: base.version, patch });
      if (!res.ok && res.error.code === "CONFLICT" && res.error.current) {
        const current = res.error.current as AgendaItemDTO;
        const untouched = AGENDA_TEXT_FIELDS.every((f) => patch[f] === undefined || current[f] === base[f]);
        if (!untouched) {
          setConflict({ current, patch });
          return;
        }
        res = await updateAgendaItemAction({ id: item.id, version: current.version, patch });
      }
      if (!res.ok) return void toast.error(res.error.message);
      setConflict(null);
      onChange(res.data);
      after?.();
    });

  /** Status / assignment: always apply, optimistic. */
  const quickPatch = async (patch: Pick<AgendaItemPatch, "status" | "assignedTo">) => {
    const before = item;
    onChange({ ...item, ...patch } as AgendaItemDTO);
    const res = await updateAgendaItemAction({ id: item.id, version: item.version, patch });
    if (!res.ok) {
      onChange(before);
      return void toast.error(res.error.message);
    }
    onChange(res.data);
  };

  /** Ticking a checklist box in the description or outcome. */
  const toggleIn = (field: "description" | "outcome") => (box: { index: number; text: string }, checked: boolean) => {
    const next = setChecklistItem(item[field], box.index, checked, box.text);
    if (next === null) return void toast.error("Die Checkliste wurde inzwischen geändert.");
    save({ [field]: next }, item);
  };

  const anchor = <div className="h-0 w-full" />;

  return (
    <div
      className={cn(
        "rounded-xl border bg-background px-4 py-3.5 transition-colors sm:px-5",
        discussed && mode === "view" && "bg-surface-subtle/40",
        pendingTemp && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <DiscussedToggle
          checked={discussed}
          disabled={pendingTemp}
          label={discussed ? `„${item.title}“ wieder als offen markieren` : `„${item.title}“ als besprochen markieren`}
          onClick={() => void quickPatch({ status: discussed ? "open" : "discussed" })}
        />

        <div className="min-w-0 flex-1">
          {mode === "edit" ? (
            <ItemEditor
              item={item}
              members={members}
              saving={saving}
              onCancel={() => (setMode("view"), setConflict(null))}
              onSave={(patch, base) => save(patch, base, () => setMode("view"))}
            />
          ) : (
            <>
              <h3 className={cn("text-[15px] leading-snug font-medium break-words", discussed && "text-foreground/75")}>
                <span className="mr-1.5 font-normal text-muted-foreground tabular-nums">{index + 1}.</span>
                {item.title}
              </h3>
              {item.description.trim() && (
                <MarkdownView
                  source={item.description}
                  onToggle={toggleIn("description")}
                  disabled={saving || pendingTemp}
                  className="mt-1 text-sm text-muted-foreground"
                />
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <AssigneeButton
                  value={item.assignedTo}
                  members={members}
                  people={people}
                  disabled={pendingTemp}
                  onChange={(assignedTo) => void quickPatch({ assignedTo })}
                />
                <span>
                  Hinzugefügt von {creator}
                  <span className="hidden sm:inline"> · {formatInstantDate(item.createdAt)}</span>
                </span>
              </div>
            </>
          )}

          {mode === "outcome" ? (
            <OutcomeEditor
              item={item}
              saving={saving}
              onCancel={() => (setMode("view"), setConflict(null))}
              onSave={(patch, base) => save(patch, base, () => setMode("view"))}
            />
          ) : (
            mode === "view" &&
            (item.outcome.trim() ? (
              <div className="group/outcome mt-3 rounded-lg bg-surface-subtle/80 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Ergebnis</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground sm:opacity-0 sm:group-hover/outcome:opacity-100 sm:focus-visible:opacity-100"
                    onClick={() => setMode("outcome")}
                    aria-label="Ergebnis bearbeiten"
                    title="Ergebnis bearbeiten"
                  >
                    <Pencil aria-hidden />
                  </Button>
                </div>
                <MarkdownView source={item.outcome} onToggle={toggleIn("outcome")} disabled={saving} className="mt-0.5 text-sm" />
              </div>
            ) : (
              !pendingTemp && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-2 -ml-2 text-muted-foreground"
                  onClick={() => setMode("outcome")}
                >
                  <Plus aria-hidden />
                  Ergebnis festhalten
                </Button>
              )
            ))
          )}

          {conflict && (
            <div role="alert" className="mt-3 rounded-lg border border-warning-fg/25 bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
              Jemand anderes hat diesen Punkt gerade geändert. Deine Fassung ist noch da.
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="xs" onClick={() => save(conflict.patch, conflict.current, () => setMode("view"))} disabled={saving}>
                  Meine Fassung speichern
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    onChange(conflict.current);
                    setConflict(null);
                    setMode("view");
                  }}
                >
                  Verwerfen und neu laden
                </Button>
              </div>
            </div>
          )}

          {item.relations.length > 0 && (
            <div className="mt-3">
              <RelationChips item={item} onChange={onChange} />
            </div>
          )}
          {linking && (
            <LinkExistingPopover
              item={item}
              kind={linking}
              open
              onOpenChange={(o) => !o && setLinking(null)}
              anchor={anchor}
              onChange={onChange}
            />
          )}
        </div>

        {!pendingTemp && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-0.5 -mr-2 shrink-0 text-muted-foreground sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus-visible:opacity-100 sm:data-[state=open]:opacity-100"
                aria-label={`Aktionen für „${item.title}“`}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              // Handing over to the search popover: returning focus to the menu button would close it again.
              onCloseAutoFocus={(e) => {
                if (handOff.current) {
                  e.preventDefault();
                  handOff.current = false;
                }
              }}
            >
              <DropdownMenuItem onSelect={() => setMode("edit")}>
                <Pencil aria-hidden />
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode("outcome")}>
                <Check aria-hidden />
                Ergebnis festhalten
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("issue")}>
                <SquareKanban aria-hidden />
                Issue erstellen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ((handOff.current = true), setLinking("issue"))}>
                <Link2 aria-hidden />
                Issue verknüpfen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("decision")}>
                <Scale aria-hidden />
                Entscheidung erstellen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ((handOff.current = true), setLinking("decision"))}>
                <Link2 aria-hidden />
                Entscheidung verknüpfen
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                <ArrowUp aria-hidden />
                Nach oben
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
                <ArrowDown aria-hidden />
                Nach unten
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <CreateIssueDialog
        open={dialog === "issue"}
        onOpenChange={(o) => !o && setDialog(null)}
        item={item}
        meeting={meeting}
        projects={projects}
        members={members}
        onCreated={onChange}
      />
      <CreateDecisionDialog
        open={dialog === "decision"}
        onOpenChange={(o) => !o && setDialog(null)}
        item={item}
        meeting={meeting}
        onCreated={onChange}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agenda-Punkt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{item.title}“ wird mit Ergebnis für alle gelöscht. Verknüpfte Issues und Entscheidungen bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const res = await deleteAgendaItemAction({ id: item.id });
                if (!res.ok && res.error.code !== "NOT_FOUND") return void toast.error(res.error.message);
                onRemove();
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DiscussedToggle({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={checked ? "Besprochen" : "Als besprochen markieren"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35 disabled:opacity-50",
        checked ? "border-status-done bg-status-done text-white" : "border-border-strong hover:border-status-done",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
    </button>
  );
}

/** Responsible person as a quiet badge; click to change (searchable member list). */
function AssigneeButton({
  value,
  members,
  people,
  disabled,
  onChange,
}: {
  value: string | null;
  members: MemberDTO[];
  people: Map<string, MemberDTO>;
  disabled?: boolean;
  onChange: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const person = value ? people.get(value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={value ? `Zuständig: ${nameOf(people, value)}. Ändern` : "Zuständige Person wählen"}
          className={cn(
            "-ml-1 inline-flex h-6 items-center gap-1.5 rounded-full px-1 pr-2 outline-none hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/35",
            value && "bg-surface-subtle/70 text-foreground/85",
          )}
        >
          {value ? (
            <>
              <MemberAvatar member={person ?? { fullName: "?", email: "?" }} size="xs" />
              <span className="max-w-40 truncate">{nameOf(people, value)}</span>
            </>
          ) : (
            <>
              <UserRound className="size-3.5" aria-hidden />
              Zuständig
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
        <MemberPicker
          members={members}
          selected={value ? [value] : []}
          multiple={false}
          label="Zuständige Person"
          onToggle={(id) => {
            onChange(id === value ? null : id);
            setOpen(false);
          }}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-muted-foreground"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Zuweisung entfernen
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ItemEditor({
  item,
  members,
  saving,
  onCancel,
  onSave,
}: {
  item: AgendaItemDTO;
  members: MemberDTO[];
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: AgendaItemPatch, base: TextBase) => void;
}) {
  // The version and texts this edit started from (conflict detection).
  const [base] = useState<TextBase>(() => ({ version: item.version, title: item.title, description: item.description, outcome: item.outcome }));
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [assignedTo, setAssignedTo] = useState(item.assignedTo);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    const patch: AgendaItemPatch = {};
    if (title.trim() !== base.title) patch.title = title;
    if (description !== base.description) patch.description = description;
    if (assignedTo !== item.assignedTo) patch.assignedTo = assignedTo;
    if (Object.keys(patch).length === 0) return onCancel();
    onSave(patch, base);
  };

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div>
        <label className="sr-only" htmlFor={`${item.id}-title`}>
          Titel
        </label>
        <input
          id={`${item.id}-title`}
          value={title}
          onChange={(e) => (setTitle(e.target.value), setError(null))}
          maxLength={300}
          autoFocus
          aria-invalid={Boolean(error) || undefined}
          className="-mx-1 w-full rounded-md bg-transparent px-1 py-0.5 text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <MarkdownEditor
        id={`${item.id}-description`}
        value={description}
        onChange={setDescription}
        placeholder="Worum geht es? Kontext, Links, offene Fragen … (optional)"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <MemberSelect
          value={assignedTo}
          onChange={setAssignedTo}
          members={members}
          noneLabel="Niemand zuständig"
          ariaLabel="Zuständige Person"
          className="sm:w-56"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Speichern
          </Button>
        </div>
      </div>
    </form>
  );
}

function OutcomeEditor({
  item,
  saving,
  onCancel,
  onSave,
}: {
  item: AgendaItemDTO;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: AgendaItemPatch, base: TextBase) => void;
}) {
  const [base] = useState<TextBase>(() => ({ version: item.version, title: item.title, description: item.description, outcome: item.outcome }));
  const [outcome, setOutcome] = useState(item.outcome);
  // Documenting a result usually means the point was discussed.
  const [markDiscussed, setMarkDiscussed] = useState(true);

  const submit = () => {
    const patch: AgendaItemPatch = {};
    if (outcome !== base.outcome) patch.outcome = outcome;
    if (markDiscussed && item.status !== "discussed" && outcome.trim()) patch.status = "discussed";
    if (Object.keys(patch).length === 0) return onCancel();
    onSave(patch, base);
  };

  return (
    <form
      noValidate
      className="mt-3 space-y-2.5"
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <label htmlFor={`${item.id}-outcome`} className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Ergebnis
      </label>
      <MarkdownEditor
        id={`${item.id}-outcome`}
        value={outcome}
        onChange={setOutcome}
        autoFocus
        placeholder="Was wurde besprochen oder entschieden? Nächste Schritte als Checkliste: - [ ] …"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {item.status !== "discussed" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={markDiscussed}
              onChange={(e) => setMarkDiscussed(e.target.checked)}
              className="size-3.5 accent-[var(--color-status-done)]"
            />
            Als besprochen markieren
          </label>
        ) : (
          <span />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Speichern
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Adding points
// ---------------------------------------------------------------------------

function AddItem({
  meeting,
  members,
  people,
  meId,
  empty,
  full,
  onAdding,
  onAdded,
  onFailed,
}: Ctx & {
  empty: boolean;
  full: boolean;
  onAdding: (temp: AgendaItemDTO) => void;
  onAdded: (item: AgendaItemDTO) => void;
  onFailed: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Shown right away; the input is free for the next point.
    onAdding({
      id,
      meetingId: meeting.id,
      title: value,
      description: "",
      assignedTo,
      status: "open",
      outcome: "",
      position: Number.MAX_SAFE_INTEGER,
      createdBy: meId,
      createdAt: now,
      updatedAt: now,
      version: 0,
      relations: [],
    });
    setTitle("");
    ref.current?.focus();
    const res = await createAgendaItemAction({ id, meetingId: meeting.id, title: value, assignedTo });
    if (res.ok) return onAdded(res.data);
    onFailed(id);
    toast.error(res.error.fieldErrors?.title ?? res.error.message);
    setTitle((current) => current || value);
  };

  if (full) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">Die Agenda ist voll ({MEETING_LIMITS.agendaItemsPerMeeting} Punkte).</p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => (e.preventDefault(), void submit())}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-dashed py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-solid focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35",
        empty ? "mt-0" : "mt-2.5",
      )}
    >
      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
        aria-label="Neuer Agenda-Punkt"
        placeholder={empty ? "Ersten Agenda-Punkt hinzufügen …" : "Punkt hinzufügen …"}
        autoComplete="off"
        className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {title.trim() && (
        <>
          <AssigneeButton value={assignedTo} members={members} people={people} onChange={setAssignedTo} />
          <Button type="submit" size="sm" className="shrink-0">
            Hinzufügen
          </Button>
        </>
      )}
    </form>
  );
}
