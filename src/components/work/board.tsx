"use client";

import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, TASK_STATUSES, type TaskDTO, type TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { QuickAdd, type QuickAddDefaults } from "./quick-add";
import { cardClass, TaskCardBody } from "./task-card";
import { TaskMenu } from "./task-menu";
import { useWork } from "./work-context";

type Columns = Record<TaskStatus, string[]>;
const COLUMN_PREFIX = "column:";

function groupByStatus(tasks: TaskDTO[]): Columns {
  const cols: Columns = { open: [], in_progress: [], in_review: [], done: [] };
  for (const t of tasks) cols[t.status].push(t.id);
  return cols;
}

function findColumn(cols: Columns, id: UniqueIdentifier): TaskStatus | null {
  const s = String(id);
  if (s.startsWith(COLUMN_PREFIX)) return s.slice(COLUMN_PREFIX.length) as TaskStatus;
  return TASK_STATUSES.find((st) => cols[st].includes(s)) ?? null;
}

const LIST_PREFIX = "list:";

/**
 * Multi-column collision detection: pointer (mouse/touch) or overlap
 * (keyboard) decides the column; inside a column the closest card wins.
 * Avoids tall empty columns losing against the card's original slot.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  const hits = pointer.length ? pointer : rectIntersection(args);
  if (hits.length === 0) return closestCorners(args);
  const cardHit = hits.find((h) => !String(h.id).startsWith(COLUMN_PREFIX));
  if (cardHit) return [cardHit];
  const columnId = String(hits[0].id);
  const listId = LIST_PREFIX + columnId.slice(COLUMN_PREFIX.length);
  const cards = args.droppableContainers.filter((d) => d.data.current?.sortable?.containerId === listId);
  if (cards.length) {
    const closest = closestCenter({ ...args, droppableContainers: cards });
    if (closest.length) return closest;
  }
  return [hits[0]];
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Board({
  tasks,
  onOpen,
  quickAddDefaults,
  readOnly,
}: {
  /** Already filtered + sorted. */
  tasks: TaskDTO[];
  onOpen: (id: string) => void;
  quickAddDefaults: QuickAddDefaults;
  readOnly: boolean;
}) {
  const { moveTask, taskById } = useWork();
  const columns = useMemo(() => groupByStatus(tasks), [tasks]);
  const [drag, setDrag] = useState<{ activeId: string; items: Columns } | null>(null);
  const items = drag?.items ?? columns;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const titleOf = (id: UniqueIdentifier) => taskById(String(id))?.title ?? "Aufgabe";
  const describePosition = (cols: Columns, id: UniqueIdentifier) => {
    const col = findColumn(cols, id);
    if (!col) return "";
    const idx = cols[col].indexOf(String(id));
    return `${STATUS_LABEL[col]}, Position ${idx + 1} von ${cols[col].length}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `„${titleOf(active.id)}“ aufgenommen. ${describePosition(items, active.id)}.`,
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? `„${titleOf(active.id)}“ bewegt: ${describePosition(drag?.items ?? items, active.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `„${titleOf(active.id)}“ abgelegt: ${describePosition(drag?.items ?? items, active.id)}.` : `„${titleOf(active.id)}“ abgelegt.`,
    onDragCancel: ({ active }) => `Verschieben von „${titleOf(active.id)}“ abgebrochen.`,
  };

  function onDragStart(e: DragStartEvent) {
    setDrag({ activeId: String(e.active.id), items: columns });
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !drag) return;
    const from = findColumn(drag.items, active.id);
    const to = findColumn(drag.items, over.id);
    if (!from || !to || from === to) return;
    setDrag((d) => {
      if (!d) return d;
      const fromItems = d.items[from].filter((x) => x !== String(active.id));
      const toItems = [...d.items[to]];
      const overIndex = toItems.indexOf(String(over.id));
      const insertAt = overIndex >= 0 ? overIndex : toItems.length;
      toItems.splice(insertAt, 0, String(active.id));
      return { ...d, items: { ...d.items, [from]: fromItems, [to]: toItems } };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const current = drag;
    setDrag(null);
    if (!over || !current) return;
    const id = String(active.id);
    const col = findColumn(current.items, id);
    if (!col) return;
    let list = current.items[col];
    const overCol = findColumn(current.items, over.id);
    if (overCol === col) {
      const oldIndex = list.indexOf(id);
      const overIndex = list.indexOf(String(over.id));
      if (overIndex >= 0 && oldIndex !== overIndex) list = arrayMove(list, oldIndex, overIndex);
    }
    const idx = list.indexOf(id);
    const afterId = list[idx - 1] ?? null;
    const beforeId = list[idx + 1] ?? null;

    const original = columns;
    const origCol = findColumn(original, id);
    const origIdx = origCol ? original[origCol].indexOf(id) : -1;
    const unchanged =
      origCol === col &&
      (original[col][origIdx - 1] ?? null) === afterId &&
      (original[col][origIdx + 1] ?? null) === beforeId;
    if (!unchanged) moveTask(id, col, afterId, beforeId);
  }

  const activeTask = drag ? taskById(drag.activeId) : undefined;

  return (
    <DndContext
      id="vistoo-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Leertaste drückt die Aufgabe zum Verschieben auf. Mit den Pfeiltasten bewegen, mit Leertaste ablegen, mit Escape abbrechen. Enter öffnet die Aufgabe.",
        },
      }}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 sm:px-6 snap-x snap-mandatory sm:snap-none">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            ids={items[status]}
            onOpen={onOpen}
            readOnly={readOnly}
            quickAddDefaults={quickAddDefaults}
            draggingId={drag?.activeId ?? null}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
        {activeTask ? (
          <div className={cn(cardClass, "rotate-1 cursor-grabbing shadow-raised")}>
            <TaskCardBody task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  ids,
  onOpen,
  readOnly,
  quickAddDefaults,
  draggingId,
}: {
  status: TaskStatus;
  ids: string[];
  onOpen: (id: string) => void;
  readOnly: boolean;
  quickAddDefaults: QuickAddDefaults;
  draggingId: string | null;
}) {
  const { taskById } = useWork();
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${status}`, disabled: readOnly });
  const [adding, setAdding] = useState(false);
  const headingId = `column-${status}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl bg-surface-subtle sm:w-auto sm:max-w-none sm:min-w-[260px] sm:flex-1 sm:basis-0"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 pr-1.5 pl-3">
        <h2 id={headingId} className="flex items-center gap-2 text-[13px] font-semibold">
          <StatusIcon status={status} />
          {STATUS_LABEL[status]}
          <span className="font-normal text-muted-foreground tabular-nums" aria-label={`${ids.length} Aufgaben`}>
            {ids.length}
          </span>
        </h2>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Aufgabe in „${STATUS_LABEL[status]}“ erstellen`}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
          </Button>
        )}
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2",
          isOver && "rounded-b-xl bg-surface-sunken/60",
        )}
      >
        <SortableContext id={`${LIST_PREFIX}${status}`} items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2" aria-labelledby={headingId}>
            {ids.map((id) => {
              const task = taskById(id);
              if (!task) return null;
              return (
                <SortableCard key={id} task={task} onOpen={onOpen} disabled={readOnly} ghost={draggingId === id} />
              );
            })}
          </ul>
        </SortableContext>
        {ids.length === 0 && !adding && (
          <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border-strong/70 px-3 py-6 text-center text-xs text-muted-foreground">
            {readOnly ? "Keine Aufgaben" : "Keine Aufgaben – hierher ziehen oder mit + erstellen"}
          </p>
        )}
        {adding && (
          <QuickAdd status={status} defaults={quickAddDefaults} onDone={() => setAdding(false)} />
        )}
      </div>
    </section>
  );
}

function SortableCard({
  task,
  onOpen,
  disabled,
  ghost,
}: {
  task: TaskDTO;
  onOpen: (id: string) => void;
  disabled: boolean;
  ghost: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className="relative">
      <div
        {...attributes}
        {...listeners}
        aria-roledescription="verschiebbare Aufgabe"
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isDragging) {
            e.preventDefault();
            onOpen(task.id);
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        className={cn(
          cardClass,
          "cursor-pointer touch-manipulation outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35",
          (ghost || isDragging) && "opacity-40",
        )}
      >
        <TaskCardBody task={task} />
      </div>
      <TaskMenu
        task={task}
        onOpen={() => onOpen(task.id)}
        className="absolute top-1.5 right-1.5 text-muted-foreground [@media(hover:hover)]:opacity-0 [li:focus-within_&]:opacity-100 [li:hover_&]:opacity-100 data-[state=open]:opacity-100"
      />
    </li>
  );
}
