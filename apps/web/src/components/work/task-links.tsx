"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTaskLinkAction,
  deleteTaskLinkAction,
  listTaskLinksAction,
  updateTaskLinkAction,
} from "@/app/actions/task-links";
import { ExternalLinks, type LinkApi, type LinkLabels } from "@/components/external-links";
import type { TaskLinkDTO } from "@vistoo/domain/dto";
import { LINK_LIMITS } from "@vistoo/domain/links";
import { TASK_LINKS_CHANGED_EVENT, type TaskLinksChangedDetail } from "./realtime";

const LABELS: LinkLabels = {
  heading: "Anhänge",
  add: "Anhang hinzufügen",
  removed: "Anhang entfernt",
  empty: "Keine Anhänge.",
  loadError: "Anhänge konnten nicht geladen werden.",
  limit: `Maximal ${LINK_LIMITS.perTask} Anhänge pro Aufgabe.`,
};

/**
 * "Anhänge": external links of a task (Google Drive, Figma, GitHub, …).
 * Saved immediately and independently of the task form; files themselves
 * stay in Google Drive. Reloads when someone else changes them (realtime).
 */
export function TaskLinks({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const api = useMemo<LinkApi<TaskLinkDTO>>(
    () => ({
      load: () => listTaskLinksAction({ taskId }),
      create: (input) => createTaskLinkAction({ ...input, taskId }),
      update: (input) => updateTaskLinkAction(input),
      remove: (id) => deleteTaskLinkAction({ id }),
    }),
    [taskId],
  );
  const [reloadKey, setReloadKey] = useState(0);
  // Link ids currently shown, to recognise deletions (which carry no task id).
  const known = useRef(new Set<string>());

  useEffect(() => {
    const onChange = (e: Event) => {
      const { taskId: changedTask, linkId } = (e as CustomEvent<TaskLinksChangedDetail>).detail;
      if (changedTask === taskId || (linkId && known.current.has(linkId))) setReloadKey((k) => k + 1);
    };
    window.addEventListener(TASK_LINKS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TASK_LINKS_CHANGED_EVENT, onChange);
  }, [taskId]);

  const trackedApi = useMemo<LinkApi<TaskLinkDTO>>(
    () => ({
      ...api,
      load: async () => {
        const res = await api.load();
        if (res.ok) known.current = new Set(res.data.map((l) => l.id));
        return res;
      },
      create: async (input) => {
        const res = await api.create(input);
        if (res.ok) known.current.add(res.data.id);
        return res;
      },
    }),
    [api],
  );

  return <ExternalLinks key={taskId} api={trackedApi} readOnly={readOnly} labels={LABELS} reloadKey={reloadKey} />;
}
