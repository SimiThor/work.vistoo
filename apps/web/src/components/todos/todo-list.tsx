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
import { CalendarDays, Check, ChevronRight, GripVertical, Lock, Plus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTodoAction, deleteTodoAction, reorderTodosAction, updateTodoAction } from "@/app/actions/todos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@vistoo/domain/dates";
import { isOverdueDay, TODO_LIMITS, type TodoDTO } from "@vistoo/domain/todos";

const byPosition = (a: TodoDTO, b: TodoDTO) => a.position - b.position;
const byCompletedDesc = (a: TodoDTO, b: TodoDTO) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "");

/**
 * "Meine To-dos": a private checklist. Quick input on top, open items below
 * (drag to reorder), completed items in a collapsed section.
 */
export function TodoList({ initial }: { initial: TodoDTO[] }) {
  const [todos, setTodos] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = useMemo(() => todos.filter((t) => !t.completed).sort(byPosition), [todos]);
  const done = useMemo(() => todos.filter((t) => t.completed).sort(byCompletedDesc), [todos]);

  const upsert = (t: TodoDTO) => setTodos((prev) => (prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [t, ...prev]));

  const toggle = async (t: TodoDTO) => {
    const optimistic = { ...t, completed: !t.completed, completedAt: t.completed ? null : new Date().toISOString() };
    upsert(optimistic);
    const res = await updateTodoAction({ id: t.id, patch: { completed: !t.completed } });
    if (res.ok) upsert(res.data);
    else {
      upsert(t);
      toast.error(res.error.message);
    }
  };

  const remove = async (t: TodoDTO) => {
    setTodos((prev) => prev.filter((x) => x.id !== t.id));
    if (editingId === t.id) setEditingId(null);
    const res = await deleteTodoAction({ id: t.id });
    if (!res.ok && res.error.code !== "NOT_FOUND") {
      upsert(t);
      toast.error(res.error.message);
      return;
    }
    toast("To-do gelöscht", {
      action: {
        label: "Rückgängig",
        onClick: async () => {
          const restored = await createTodoAction({ title: t.title, description: t.description, dueDate: t.dueDate });
          if (!restored.ok) return toast.error(restored.error.message);
          upsert(restored.data);
          if (t.completed) {
            const again = await updateTodoAction({ id: restored.data.id, patch: { completed: true } });
            if (again.ok) upsert(again.data);
          }
        },
      },
    });
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const before = todos;
    const ids = open.map((t) => t.id);
    const next = arrayMove(open, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    // Local positions mirror the server's renumbering.
    const positions = new Map(next.map((t, i) => [t.id, (i + 1) * 1024]));
    setTodos((prev) => prev.map((t) => (positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t)));
    const res = await reorderTodosAction({ ids: next.map((t) => t.id) });
    if (!res.ok) {
      setTodos(before);
      toast.error(res.error.message);
    }
  };

  const titleOf = (id: string | number) => todos.find((t) => t.id === id)?.title ?? "To-do";

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Meine To-dos</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          Nur für dich sichtbar – unabhängig von Projekten und Aufgaben.
        </p>
      </div>

      <QuickAdd onCreated={upsert} count={todos.length} />

      {open.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground" role="status">
          {done.length > 0 ? "Alles erledigt." : "Noch keine To-dos. Notiere oben, was ansteht."}
        </p>
      ) : (
        <DndContext
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
          <SortableContext items={open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul aria-label="Offene To-dos" className="mt-4 space-y-px">
              {open.map((t) => (
                <SortableTodo key={t.id} todo={t}>
                  {editingId === t.id ? (
                    <TodoEditor todo={t} onSaved={(x) => (upsert(x), setEditingId(null))} onCancel={() => setEditingId(null)} />
                  ) : (
                    <TodoRow todo={t} onToggle={() => void toggle(t)} onEdit={() => setEditingId(t.id)} onRemove={() => void remove(t)} />
                  )}
                </SortableTodo>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {done.length > 0 && (
        <section className="mt-8" aria-label="Erledigte To-dos">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="flex items-center gap-1 rounded-md text-[13px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            <ChevronRight className={cn("size-4 transition-transform", showDone && "rotate-90")} aria-hidden />
            Erledigt · {done.length}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-px">
              {done.map((t) => (
                <li key={t.id} className="rounded-lg">
                  {editingId === t.id ? (
                    <TodoEditor todo={t} onSaved={(x) => (upsert(x), setEditingId(null))} onCancel={() => setEditingId(null)} />
                  ) : (
                    <TodoRow todo={t} onToggle={() => void toggle(t)} onEdit={() => setEditingId(t.id)} onRemove={() => void remove(t)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function QuickAdd({ onCreated, count }: { onCreated: (t: TodoDTO) => void; count: number }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    if (count >= TODO_LIMITS.perUser) return toast.error(`Höchstens ${TODO_LIMITS.perUser} To-dos.`);
    // Clear right away so the next entry can be typed while this one saves.
    const date = dueDate;
    const description = note.trim();
    setTitle("");
    setNote("");
    setDueDate(null);
    setShowDate(false);
    inputRef.current?.focus();
    startTransition(async () => {
      const res = await createTodoAction({ id: crypto.randomUUID(), title: value, description, dueDate: date });
      if (res.ok) return onCreated(res.data);
      toast.error(res.error.fieldErrors?.title ?? res.error.fieldErrors?.description ?? res.error.message);
      setTitle((current) => current || value);
      setNote((current) => current || description);
      setDueDate((current) => current ?? date);
    });
  };

  // The note field shows up once a title is typed (or a note is already there),
  // so the quick "type + Enter" flow stays a single line.
  const expanded = title.trim() !== "" || note !== "";

  return (
    <form
      noValidate
      className="mt-5 rounded-xl border bg-background px-3 py-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor={id} className="sr-only">
          Neues To-do
        </label>
        <input
          ref={inputRef}
          id={id}
          autoFocus
          autoComplete="off"
          value={title}
          maxLength={TODO_LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Neues To-do – mit Enter hinzufügen"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {showDate || dueDate ? (
          <input
            type="date"
            aria-label="Fällig am"
            value={dueDate ?? ""}
            onChange={(e) => setDueDate(e.target.value || null)}
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:border-ring"
          />
        ) : (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowDate(true)} aria-label="Fälligkeitsdatum hinzufügen" title="Fälligkeitsdatum">
            <CalendarDays aria-hidden />
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Hinzufügen
        </Button>
      </div>
      {expanded && (
        <textarea
          aria-label="Notiz zum neuen To-do"
          value={note}
          maxLength={TODO_LIMITS.descriptionMax}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Notiz (optional) – ⌘↵ zum Hinzufügen"
          className="field-sizing-content mt-1 mb-1 block max-h-80 min-h-12 w-full resize-none border-t bg-transparent pt-2 pl-6 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      )}
    </form>
  );
}

function SortableTodo({ todo, children }: { todo: TodoDTO; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/todo relative rounded-lg", isDragging && "z-10 bg-background shadow-raised")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`„${todo.title}“ verschieben`}
        className="absolute top-2.5 -left-6 hidden size-5 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 outline-none hover:text-muted-foreground focus-visible:flex focus-visible:ring-3 focus-visible:ring-ring/35 sm:flex sm:opacity-0 sm:group-hover/todo:opacity-100 sm:focus-visible:opacity-100"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      {children}
    </li>
  );
}

function CheckCircle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/35",
        checked ? "border-accent-blue bg-accent-blue text-white" : "border-border-strong hover:border-accent-blue",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
    </button>
  );
}

function TodoRow({ todo, onToggle, onEdit, onRemove }: { todo: TodoDTO; onToggle: () => void; onEdit: () => void; onRemove: () => void }) {
  const today = useToday();
  const overdue = !todo.completed && isOverdueDay(todo.dueDate, today);
  return (
    <div className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-subtle">
      <CheckCircle
        checked={todo.completed}
        label={todo.completed ? `„${todo.title}“ wieder öffnen` : `„${todo.title}“ erledigt`}
        onClick={onToggle}
      />
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/35">
        <span className={cn("block text-sm leading-5", todo.completed && "text-muted-foreground line-through")}>{todo.title}</span>
        {todo.description && <span className="block truncate text-xs text-muted-foreground">{todo.description}</span>}
      </button>
      {todo.dueDate && (
        <span className={cn("shrink-0 pt-px text-xs tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
          {overdue && <span className="sr-only">Überfällig: </span>}
          {formatShortDate(todo.dueDate)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label={`„${todo.title}“ löschen`}
        className="shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

/** Inline editor: title, description, due date. Enter saves, Escape cancels. */
function TodoEditor({ todo, onSaved, onCancel }: { todo: TodoDTO; onSaved: (t: TodoDTO) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description);
  const [dueDate, setDueDate] = useState(todo.dueDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { title: useId(), description: useId(), due: useId() };

  const save = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    startTransition(async () => {
      const res = await updateTodoAction({ id: todo.id, patch: { title, description, dueDate } });
      if (!res.ok) return setError(res.error.fieldErrors?.["patch.title"] ?? res.error.message);
      onSaved(res.data);
    });
  };

  return (
    <div
      className="space-y-2 rounded-lg border bg-background p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          save();
        }
      }}
    >
      <label htmlFor={ids.title} className="sr-only">
        Titel
      </label>
      <Input
        id={ids.title}
        autoFocus
        value={title}
        maxLength={TODO_LIMITS.titleMax}
        onChange={(e) => (setTitle(e.target.value), setError(null))}
        aria-invalid={Boolean(error) || undefined}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <label htmlFor={ids.description} className="sr-only">
        Beschreibung
      </label>
      <textarea
        id={ids.description}
        value={description}
        maxLength={TODO_LIMITS.descriptionMax}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Notiz (optional)"
        rows={2}
        className="field-sizing-content block min-h-14 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={ids.due} className="text-xs text-muted-foreground">
            Fällig
          </label>
          <input
            id={ids.due}
            type="date"
            value={dueDate ?? ""}
            onChange={(e) => setDueDate(e.target.value || null)}
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:border-ring"
          />
          {dueDate && (
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => setDueDate(null)} aria-label="Fälligkeitsdatum entfernen">
              <X aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            Speichern
          </Button>
        </div>
      </div>
    </div>
  );
}
