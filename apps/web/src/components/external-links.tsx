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
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LINK_LIMITS, linkFallbackTitle, linkKind } from "@vistoo/domain/links";
import type { ActionResult } from "@vistoo/domain/result";
import { webUrlSchema } from "@vistoo/domain/validation";

/** Icon by link type; GitHub distinguishes pull requests and issues. */
export function LinkIcon({ url }: { url: string }) {
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

export type LinkLike = { id: string; url: string; title: string | null };
type LinkInput = { url: string; title: string | null };

/** Server Actions behind a link list (task attachments, decision references …). */
export type LinkApi<L extends LinkLike> = {
  load: () => Promise<ActionResult<L[]>>;
  create: (input: LinkInput & { id: string }) => Promise<ActionResult<L>>;
  update: (input: LinkInput & { id: string }) => Promise<ActionResult<L>>;
  remove: (id: string) => Promise<ActionResult<unknown>>;
};

export type LinkLabels = {
  heading: string;
  add: string;
  removed: string;
  empty: string;
  loadError: string;
  limit: string;
};

type Editing<L> = { kind: "new" } | { kind: "edit"; link: L } | null;

/**
 * External web links (Google Drive, Figma, GitHub, …), saved immediately and
 * independently of the surrounding form. Files themselves stay where they are.
 * `reloadKey` reloads the list (retry, realtime change by someone else);
 * `initial` skips the first request when the caller already has the links.
 */
export function ExternalLinks<L extends LinkLike>({
  api,
  readOnly,
  labels,
  max = LINK_LIMITS.perTask,
  reloadKey = 0,
  initial,
  onChange,
}: {
  api: LinkApi<L>;
  readOnly: boolean;
  labels: LinkLabels;
  max?: number;
  reloadKey?: number;
  initial?: L[];
  onChange?: () => void;
}) {
  const [links, setLinks] = useState<L[] | null>(initial ?? null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing<L>>(null);
  const headingId = useId();
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  const [revision, setRevision] = useState(0);
  const skipFirst = useRef(initial !== undefined);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    let cancelled = false;
    apiRef.current.load().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLinks(res.data);
        setLoadError(false);
      } else setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, revision]);
  const reload = () => setRevision((r) => r + 1);

  const upsertLocal = (link: L) => {
    setLinks((prev) => {
      const list = prev ?? [];
      return list.some((l) => l.id === link.id) ? list.map((l) => (l.id === link.id ? link : l)) : [...list, link];
    });
    onChange?.();
  };

  const remove = async (link: L) => {
    setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? prev);
    const res = await api.remove(link.id);
    if (!res.ok && res.error.code !== "NOT_FOUND") {
      toast.error(res.error.message);
      reload();
      return;
    }
    onChange?.();
    toast(labels.removed, {
      action: {
        label: "Rückgängig",
        onClick: async () => {
          const restored = await api.create({ id: crypto.randomUUID(), url: link.url, title: link.title });
          if (restored.ok) upsertLocal(restored.data);
          else toast.error(restored.error.message);
        },
      },
    });
  };

  const atLimit = (links?.length ?? 0) >= max;

  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <div className="flex h-7 items-center justify-between gap-2">
        <h3 id={headingId} className="text-[13px] text-muted-foreground">
          {labels.heading}
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
            {labels.loadError}{" "}
            <button type="button" className="underline underline-offset-2" onClick={reload}>
              Erneut versuchen
            </button>
          </p>
        ) : (
          <Skeleton className="h-9 w-full" aria-label={`${labels.heading} werden geladen`} />
        )
      ) : (
        <>
          {links.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {links.map((link) =>
                editing?.kind === "edit" && editing.link.id === link.id ? (
                  <li key={link.id} className="p-2">
                    <LinkForm
                      link={link}
                      onSubmit={(input) => api.update({ id: link.id, ...input })}
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
              <NewLinkForm
                create={api.create}
                onSaved={(saved) => {
                  upsertLocal(saved);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : links.length === 0 ? (
            readOnly ? (
              <p className="text-sm text-muted-foreground">{labels.empty}</p>
            ) : (
              <button
                type="button"
                onClick={() => setEditing({ kind: "new" })}
                className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors outline-none hover:bg-surface-subtle hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
              >
                <Plus className="size-4" aria-hidden />
                {labels.add}
                <span className="ml-auto hidden text-xs text-muted-foreground/80 sm:inline">Drive, Figma, GitHub …</span>
              </button>
            )
          ) : null}
          {atLimit && !readOnly && <p className="text-xs text-muted-foreground">{labels.limit}</p>}
        </>
      )}
    </section>
  );
}

function LinkRow<L extends LinkLike>({
  link,
  readOnly,
  onEdit,
  onRemove,
}: {
  link: L;
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

/** New link: one client id per form instance, so a retried create returns the stored link instead of a duplicate. */
function NewLinkForm<L extends LinkLike>({
  create,
  onSaved,
  onCancel,
}: {
  create: LinkApi<L>["create"];
  onSaved: (link: L) => void;
  onCancel: () => void;
}) {
  const [clientId] = useState(() => crypto.randomUUID());
  return <LinkForm onSubmit={(input) => create({ id: clientId, ...input })} onSaved={onSaved} onCancel={onCancel} />;
}

/**
 * Inline add/edit form. Lives inside a surrounding <form>, so it is not a
 * <form> itself: Enter saves the link, Escape cancels (without closing the panel).
 */
function LinkForm<L extends LinkLike>({
  link,
  onSubmit,
  onSaved,
  onCancel,
}: {
  link?: L;
  onSubmit: (input: LinkInput) => Promise<ActionResult<L>>;
  onSaved: (link: L) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(link?.url ?? "");
  const [title, setTitle] = useState(link?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { url: useId(), title: useId() };
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
      const res = await onSubmit({ url: parsed.data, title: title.trim() || null });
      if (!res.ok) {
        setError(res.error.fieldErrors?.url ?? res.error.fieldErrors?.title ?? res.error.message);
        return;
      }
      onSaved(res.data);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // Never submit the surrounding form.
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
