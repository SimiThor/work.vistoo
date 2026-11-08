"use client";

import {
  CircleDot,
  File,
  FileText,
  Folder,
  GitPullRequest,
  Globe,
  Loader2,
  Pencil,
  PenTool,
  Plus,
  Presentation,
  Sheet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createTaskLinkAction,
  deleteTaskLinkAction,
  listTaskLinksAction,
  updateTaskLinkAction,
} from "@/app/actions/task-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskLinkDTO } from "@vistoo/domain/dto";
import { LINK_LIMITS, linkFallbackTitle, linkKind } from "@vistoo/domain/links";
import { webUrlSchema } from "@vistoo/domain/validation";
import { cn } from "@/lib/utils";
import { TASK_LINKS_CHANGED_EVENT, type TaskLinksChangedDetail } from "./realtime";

/** Icon by link type; GitHub distinguishes pull requests and issues. */
function LinkIcon({ url }: { url: string }) {
  const props = { className: "size-4 shrink-0 text-muted-foreground", "aria-hidden": true } as const;
  switch (linkKind(url)) {
    case "document":
      return <FileText {...props} />;
    case "spreadsheet":
      return <Sheet {...props} />;
    case "presentation":
      return <Presentation {...props} />;
    case "drive":
      return url.includes("/folders/") ? <Folder {...props} /> : <File {...props} />;
    case "figma":
      return <PenTool {...props} />;
    case "github":
      return url.includes("/issues/") ? <CircleDot {...props} /> : <GitPullRequest {...props} />;
    default:
      return <Globe {...props} />;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type Editing = { kind: "new" } | { kind: "edit"; link: TaskLinkDTO } | null;

/**
 * "Anhänge": external links of a task (Google Drive, Figma, GitHub, …).
 * Saved immediately and independently of the task form; files themselves
 * stay in Google Drive.
 */
export function TaskLinks({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [links, setLinks] = useState<TaskLinkDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const headingId = useId();
  const linksRef = useRef(links);
  useEffect(() => {
    linksRef.current = links;
  });

  // Bumped to reload (retry, realtime change by someone else).
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    let cancelled = false;
    listTaskLinksAction({ taskId }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLinks(res.data);
        setLoadError(false);
      } else setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, revision]);

  // Changes by others (realtime): reload when this task is affected.
  useEffect(() => {
    const onChange = (e: Event) => {
      const { taskId: changedTask, linkId } = (e as CustomEvent<TaskLinksChangedDetail>).detail;
      if (changedTask === taskId || (linkId && linksRef.current?.some((l) => l.id === linkId))) load();
    };
    window.addEventListener(TASK_LINKS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TASK_LINKS_CHANGED_EVENT, onChange);
  }, [taskId, load]);

  const upsertLocal = (link: TaskLinkDTO) =>
    setLinks((prev) => {
      const list = prev ?? [];
      return list.some((l) => l.id === link.id) ? list.map((l) => (l.id === link.id ? link : l)) : [...list, link];
    });

  const remove = async (link: TaskLinkDTO) => {
    setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? prev);
    const res = await deleteTaskLinkAction({ id: link.id });
    if (!res.ok && res.error.code !== "NOT_FOUND") {
      toast.error(res.error.message);
      load();
      return;
    }
    toast("Anhang entfernt", {
      action: {
        label: "Rückgängig",
        onClick: async () => {
          const restored = await createTaskLinkAction({ taskId, url: link.url, title: link.title });
          if (restored.ok) upsertLocal(restored.data);
          else toast.error(restored.error.message);
        },
      },
    });
  };

  const atLimit = (links?.length ?? 0) >= LINK_LIMITS.perTask;

  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <div className="flex h-7 items-center justify-between gap-2">
        <h3 id={headingId} className="text-[13px] text-muted-foreground">
          Anhänge
          {links && links.length > 0 && <span className="tabular-nums"> · {links.length}</span>}
        </h3>
        {!readOnly && links && links.length > 0 && editing?.kind !== "new" && !atLimit && (
          <Button type="button" variant="ghost" size="xs" onClick={() => setEditing({ kind: "new" })}>
            <Plus aria-hidden />
            Hinzufügen
          </Button>
        )}
      </div>

      {links === null ? (
        loadError ? (
          <p className="text-sm text-muted-foreground">
            Anhänge konnten nicht geladen werden.{" "}
            <button type="button" className="underline underline-offset-2" onClick={load}>
              Erneut versuchen
            </button>
          </p>
        ) : (
          <Skeleton className="h-9 w-full" aria-label="Anhänge werden geladen" />
        )
      ) : (
        <>
          {links.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {links.map((link) =>
                editing?.kind === "edit" && editing.link.id === link.id ? (
                  <li key={link.id} className="p-2">
                    <LinkForm
                      taskId={taskId}
                      link={link}
                      onSaved={(saved) => {
                        upsertLocal(saved);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <LinkRow
                    key={link.id}
                    link={link}
                    readOnly={readOnly}
                    onEdit={() => setEditing({ kind: "edit", link })}
                    onRemove={() => void remove(link)}
                  />
                ),
              )}
            </ul>
          )}

          {editing?.kind === "new" ? (
            <div className="rounded-lg border p-2">
              <LinkForm
                taskId={taskId}
                onSaved={(saved) => {
                  upsertLocal(saved);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : links.length === 0 ? (
            readOnly ? (
              <p className="text-sm text-muted-foreground">Keine Anhänge.</p>
            ) : (
              <button
                type="button"
                onClick={() => setEditing({ kind: "new" })}
                className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors outline-none hover:bg-surface-subtle hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
              >
                <Plus className="size-4" aria-hidden />
                Anhang hinzufügen
                <span className="ml-auto hidden text-xs text-muted-foreground/80 sm:inline">Drive, Figma, GitHub …</span>
              </button>
            )
          ) : null}
          {atLimit && !readOnly && (
            <p className="text-xs text-muted-foreground">Maximal {LINK_LIMITS.perTask} Anhänge pro Aufgabe.</p>
          )}
        </>
      )}
    </section>
  );
}

function LinkRow({
  link,
  readOnly,
  onEdit,
  onRemove,
}: {
  link: TaskLinkDTO;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const name = link.title ?? linkFallbackTitle(link.url);
  return (
    <li className="group flex items-center gap-1 pr-1">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.url}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-lg py-2 pl-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
      >
        <LinkIcon url={link.url} />
        <span className="truncate group-hover:underline group-hover:underline-offset-2">{name}</span>
        {link.title && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{hostOf(link.url)}</span>}
        <span className="sr-only">(öffnet in neuem Tab)</span>
      </a>
      {!readOnly && (
        // Always visible on touch screens; revealed on hover/focus where a pointer can hover.
        <div className="flex shrink-0 items-center transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Button type="button" variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`${name} bearbeiten`}>
            <Pencil aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} aria-label={`${name} entfernen`}>
            <X aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Inline add/edit form. Lives inside the task <form>, so it is not a <form>
 * itself: Enter saves the link, Escape cancels (without closing the panel).
 */
function LinkForm({
  taskId,
  link,
  onSaved,
  onCancel,
}: {
  taskId: string;
  link?: TaskLinkDTO;
  onSaved: (link: TaskLinkDTO) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(link?.url ?? "");
  const [title, setTitle] = useState(link?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { url: useId(), title: useId() };
  // One id per form instance: a retried create returns the stored link instead of a duplicate.
  const [clientId] = useState(() => crypto.randomUUID());
  // Opened at the bottom of the panel: bring the whole editor (incl. buttons) into view.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const save = () => {
    if (pending) return;
    const parsed = webUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültiger Link.");
      document.getElementById(ids.url)?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const input = { url: parsed.data, title: title.trim() || null };
      const res = link
        ? await updateTaskLinkAction({ id: link.id, ...input })
        : await createTaskLinkAction({ id: clientId, taskId, ...input });
      if (!res.ok) {
        setError(res.error.fieldErrors?.url ?? res.error.fieldErrors?.title ?? res.error.message);
        return;
      }
      onSaved(res.data);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // Never submit the surrounding task form.
      e.preventDefault();
      e.stopPropagation();
      save();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div ref={rootRef} className="space-y-2 scroll-mb-4" data-local-escape onKeyDown={onKeyDown}>
      <div>
        <label htmlFor={ids.url} className="sr-only">
          Link
        </label>
        <Input
          id={ids.url}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoFocus
          placeholder="Link einfügen – https://…"
          value={url}
          disabled={pending}
          maxLength={LINK_LIMITS.urlMax}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${ids.url}-error` : undefined}
        />
        {error && (
          <p id={`${ids.url}-error`} role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={ids.title} className="sr-only">
          Name (optional)
        </label>
        <Input
          id={ids.title}
          autoComplete="off"
          placeholder="Name (optional)"
          value={title}
          disabled={pending}
          maxLength={LINK_LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending || !url.trim()} className={cn("min-w-20")}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {link ? "Speichern" : "Hinzufügen"}
        </Button>
      </div>
    </div>
  );
}
