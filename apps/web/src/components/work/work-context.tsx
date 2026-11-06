"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  createTaskAction,
  deleteTaskAction,
  listTasksAction,
  moveTaskAction,
  setTaskAssigneeAction,
  setTaskStatusAction,
  updateTaskAction,
} from "@/app/actions/tasks";
import type { MemberDTO, ProjectDTO, TaskDTO, TaskStatus } from "@vistoo/domain";
import type { ActionError, ActionResult } from "@vistoo/domain/result";
import type { CreateTaskInput } from "@vistoo/domain/validation";
import { useRealtimeSync } from "./realtime";

export type Scope = { kind: "all" } | { kind: "project"; projectId: string };

export type Viewer = { userId: string; email: string; fullName: string | null; role: "admin" | "member" };

type TaskMap = Record<string, TaskDTO>;

type WorkContextValue = {
  scope: Scope;
  me: Viewer;
  workspaceId: string;
  projects: ProjectDTO[];
  projectById: Map<string, ProjectDTO>;
  members: MemberDTO[];
  /** active + former members, for historical names */
  people: Map<string, MemberDTO>;
  /** Tasks in scope (archived projects excluded in the global view), sorted by position. */
  tasks: TaskDTO[];
  taskById: (id: string) => TaskDTO | undefined;
  isReadOnly: (task: Pick<TaskDTO, "projectId">) => boolean;
  createTask: (input: CreateTaskInput) => Promise<ActionResult<TaskDTO>>;
  updateTask: (
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<TaskDTO, "id" | "version" | "position" | "createdAt" | "updatedAt" | "createdBy">>,
  ) => Promise<ActionResult<TaskDTO>>;
  moveTask: (id: string, status: TaskStatus, afterId: string | null, beforeId: string | null) => void;
  setStatus: (id: string, status: TaskStatus) => void;
  setAssignee: (id: string, assigneeId: string | null) => void;
  deleteTask: (id: string) => Promise<boolean>;
  /** Merge a server snapshot of a task (e.g. after a conflict). */
  acceptServerTask: (task: TaskDTO) => void;
};

const WorkContext = createContext<WorkContextValue | null>(null);

export function useWork(): WorkContextValue {
  const v = use(WorkContext);
  if (!v) throw new Error("useWork must be used inside <WorkProvider>");
  return v;
}

const POSITION_STEP = 1024;

export function sortTasks(a: TaskDTO, b: TaskDTO): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function columnEnd(map: TaskMap, status: TaskStatus): number {
  const inColumn = Object.values(map).filter((t) => t.status === status);
  return (inColumn.length ? Math.max(...inColumn.map((t) => t.position)) : 0) + POSITION_STEP;
}

function toMap(tasks: TaskDTO[]): TaskMap {
  return Object.fromEntries(tasks.map((t) => [t.id, t]));
}

export function WorkProvider({
  scope,
  me,
  workspaceId,
  initialTasks,
  projects,
  members,
  formerMembers,
  children,
}: {
  scope: Scope;
  me: Viewer;
  workspaceId: string;
  initialTasks: TaskDTO[];
  projects: ProjectDTO[];
  members: MemberDTO[];
  formerMembers: MemberDTO[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [map, setMap] = useState<TaskMap>(() => toMap(initialTasks));
  // Latest committed map for event handlers (synced after each render).
  const mapRef = useRef(map);
  useLayoutEffect(() => {
    mapRef.current = map;
  }, [map]);

  /**
   * Reconcile with a fresh server snapshot (initial props after router.refresh
   * or a resync): newer versions win, tasks missing from the snapshot are gone.
   */
  const reconcile = useCallback((snapshot: TaskDTO[]) => {
    setMap((prev) => {
      const next: TaskMap = {};
      for (const t of snapshot) {
        const local = prev[t.id];
        next[t.id] = local && local.version > t.version ? local : t;
      }
      return next;
    });
  }, []);

  const [lastInitial, setLastInitial] = useState(initialTasks);
  if (initialTasks !== lastInitial) {
    setLastInitial(initialTasks);
    reconcile(initialTasks);
  }

  /** Apply an authoritative row (server response or realtime) if it is not older. */
  const upsert = useCallback((task: TaskDTO) => {
    setMap((prev) => {
      const local = prev[task.id];
      if (local && local.version > task.version) return prev;
      return { ...prev, [task.id]: task };
    });
  }, []);

  const remove = useCallback((id: string) => {
    setMap((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleError = useCallback(
    (error: ActionError) => {
      if (error.code === "UNAUTHENTICATED") {
        toast.error(error.message, {
          action: { label: "Anmelden", onClick: () => router.push("/login") },
          duration: Infinity,
        });
      } else if (error.code === "FORBIDDEN" && /Zugriff/.test(error.message)) {
        toast.error(error.message);
        router.refresh();
      } else if (error.code === "CONFLICT") {
        toast.warning(error.message, { description: "Die aktuelle Version wurde geladen." });
      } else {
        toast.error(error.message);
      }
    },
    [router],
  );

  /** Optimistic change with rollback on failure. */
  const optimistic = useCallback(
    async (
      id: string,
      change: (t: TaskDTO) => TaskDTO | null,
      call: () => Promise<ActionResult<TaskDTO | { id: string }>>,
    ): Promise<boolean> => {
      const before = mapRef.current[id];
      if (!before) return false;
      const after = change(before);
      setMap((prev) => {
        if (after === null) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return { ...prev, [id]: after };
      });
      const res = await call();
      if (res.ok) {
        if ("version" in res.data) upsert(res.data);
        return true;
      }
      // Roll back, unless someone else's newer state already arrived.
      setMap((prev) => {
        const cur = prev[id];
        if (cur && cur.version > before.version) return prev;
        return { ...prev, [id]: before };
      });
      if (res.error.code === "CONFLICT" && res.error.current) upsert(res.error.current as TaskDTO);
      if (res.error.code === "NOT_FOUND") remove(id);
      handleError(res.error);
      return false;
    },
    [handleError, remove, upsert],
  );

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const res = await createTaskAction(input);
      if (res.ok) upsert(res.data);
      else if (!res.error.fieldErrors) handleError(res.error);
      return res;
    },
    [handleError, upsert],
  );

  const updateTask = useCallback<WorkContextValue["updateTask"]>(
    async (id, expectedVersion, patch) => {
      const res = await updateTaskAction({ id, expectedVersion, patch });
      if (res.ok) upsert(res.data);
      else if (res.error.code === "NOT_FOUND") remove(id);
      else if (!res.error.fieldErrors && res.error.code !== "CONFLICT") handleError(res.error);
      return res;
    },
    [handleError, remove, upsert],
  );

  const moveTask = useCallback<WorkContextValue["moveTask"]>(
    (id, status, afterId, beforeId) => {
      const m = mapRef.current;
      const a = afterId ? m[afterId]?.position : undefined;
      const b = beforeId ? m[beforeId]?.position : undefined;
      // Local estimate for instant ordering; the server computes the real value.
      const position =
        a !== undefined && b !== undefined
          ? (a + b) / 2
          : a !== undefined
            ? a + POSITION_STEP / 2
            : b !== undefined
              ? b - POSITION_STEP / 2
              : columnEnd(m, status);
      void optimistic(
        id,
        (t) => ({ ...t, status, position }),
        () => moveTaskAction({ id, status, afterId, beforeId }),
      );
    },
    [optimistic],
  );

  const setStatus = useCallback<WorkContextValue["setStatus"]>(
    (id, status) => {
      void optimistic(
        id,
        (t) => (t.status === status ? t : { ...t, status, position: columnEnd(mapRef.current, status) }),
        () => setTaskStatusAction({ id, status }),
      );
    },
    [optimistic],
  );

  const setAssignee = useCallback<WorkContextValue["setAssignee"]>(
    (id, assigneeId) => {
      void optimistic(id, (t) => ({ ...t, assigneeId }), () => setTaskAssigneeAction({ id, assigneeId }));
    },
    [optimistic],
  );

  const deleteTask = useCallback(
    (id: string) => optimistic(id, () => null, () => deleteTaskAction({ id })),
    [optimistic],
  );

  // ---- Realtime + resync ----------------------------------------------------
  const projectId = scope.kind === "project" ? scope.projectId : null;
  const resync = useCallback(async () => {
    const res = await listTasksAction({ projectId });
    if (res.ok) reconcile(res.data);
    else handleError(res.error);
  }, [projectId, reconcile, handleError]);

  useRealtimeSync({ workspaceId, onTask: upsert, onTaskDeleted: remove, onResync: resync });

  // ---- Derived --------------------------------------------------------------
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const people = useMemo(
    () => new Map([...formerMembers, ...members].map((m) => [m.userId, m])),
    [members, formerMembers],
  );

  const tasks = useMemo(() => {
    return Object.values(map)
      .filter((t) => {
        if (scope.kind === "project") return t.projectId === scope.projectId;
        const p = projectById.get(t.projectId);
        return Boolean(p && !p.archived);
      })
      .sort(sortTasks);
  }, [map, scope, projectById]);

  const taskById = useCallback((id: string) => map[id], [map]);
  const isReadOnly = useCallback(
    (t: Pick<TaskDTO, "projectId">) => projectById.get(t.projectId)?.archived ?? false,
    [projectById],
  );

  const value: WorkContextValue = {
    scope,
    me,
    workspaceId,
    projects,
    projectById,
    members,
    people,
    tasks,
    taskById,
    isReadOnly,
    createTask,
    updateTask,
    moveTask,
    setStatus,
    setAssignee,
    deleteTask,
    acceptServerTask: upsert,
  };

  return <WorkContext value={value}>{children}</WorkContext>;
}
