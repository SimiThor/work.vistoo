"use client";

import { ArrowDown, ChevronLeft, Info } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  conversationDetailAction,
  deleteMessageAction,
  editMessageAction,
  getMessageAction,
  listMessagesAction,
  markReadAction,
  sendMessageAction,
} from "@/app/actions/chat";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { AttachmentDTO, ChatPerson, ConversationDetail, MessageDTO } from "@vistoo/domain/chat-types";
import { displayName } from "@vistoo/domain";
import { extractMentionIds, renderMentionsPlain } from "@vistoo/domain/mentions";
import { renderIssueRefsPlain } from "@vistoo/domain/issue-refs";
import { issueRefNumber } from "./issue-refs";
import { authorizeRealtime, getBrowserSupabase } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { ConversationDetails } from "./conversation-details";
import { ConversationIcon } from "./conversation-list";
import { MessageItem, type MessageVM } from "./message-item";

type MessageRow = {
  id: string;
  seq: number;
  conversation_id: string;
  author_id: string;
  body: string;
  attachment_count: number;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

const GROUP_WINDOW_MS = 5 * 60_000;
const OFFLINE = {
  ok: false as const,
  error: { code: "INTERNAL" as const, message: "Keine Verbindung. Nicht gesendet." },
};
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Heute";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Gestern";
  return dayFmt.format(d) + (d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : "");
}

function sortMessages(list: MessageVM[]): MessageVM[] {
  // Server messages by seq; unsent local ones (seq 0) at the end in send order.
  return [...list].sort((a, b) => {
    if (a.seq && b.seq) return a.seq - b.seq;
    if (a.seq) return -1;
    if (b.seq) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Realtime rows carry the stored markup; the web renders from `markup`. */
function rowToDTO(r: MessageRow, prev?: MessageVM): MessageDTO {
  const markup = r.deleted_at ? "" : r.body;
  return {
    id: r.id,
    seq: Number(r.seq),
    conversationId: r.conversation_id,
    authorId: r.author_id,
    body: markup,
    createdAt: new Date(r.created_at).toISOString(),
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
    deleted: r.deleted_at !== null,
    attachments: r.deleted_at ? [] : (prev?.attachments ?? []),
    markup,
    mentionIds: extractMentionIds(markup),
    // Realtime rows carry only tokens; IssueRefLink resolves unknown ids via the client cache.
    issueRefs: prev?.issueRefs ?? [],
  };
}

export function ConversationSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Unterhaltung wird geladen">
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex-1 space-y-5 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function ConversationView({
  conversationId,
  focusMessageId = null,
}: {
  conversationId: string;
  /** Scroll to and briefly highlight this message (opened from a notification). */
  focusMessageId?: string | null;
}) {
  const chat = useChat();
  const me = chat.me?.userId ?? null;
  const summary = chat.conversations.find((c) => c.id === conversationId);

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [messages, setMessages] = useState<MessageVM[]>([]);
  const [authors, setAuthors] = useState<Map<string, ChatPerson>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const [visible, setVisible] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toDelete, setToDelete] = useState<MessageVM | null>(null);
  const [firstUnreadSeq, setFirstUnreadSeq] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const maxSeq = useMemo(() => messages.reduce((m, x) => Math.max(m, x.seq), 0), [messages]);

  // ---- People for mentions ---------------------------------------------------
  const workspaceMembers = chat.members;
  const nameOf = useCallback(
    (userId: string) => {
      const p = authors.get(userId) ?? workspaceMembers.find((m) => m.userId === userId);
      return p ? displayName(p) : null;
    },
    [authors, workspaceMembers],
  );
  // Same rule as the server: open channels → active workspace members,
  // private channels / DMs → active participants. Never myself.
  const mentionCandidates = useMemo(() => {
    const pool = !detail ? [] : detail.kind === "open_channel" ? workspaceMembers : detail.members;
    return pool
      .filter((p) => p.active && p.userId !== me)
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "de"));
  }, [detail, workspaceMembers, me]);

  const mergeAuthors = useCallback((list: (ChatPerson | null)[]) => {
    setAuthors((prev) => {
      const next = new Map(prev);
      for (const a of list) if (a) next.set(a.userId, a);
      return next;
    });
  }, []);

  /** Upsert server state; the server version wins over local optimistic state. */
  const upsert = useCallback((incoming: MessageDTO[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) {
        const local = map.get(m.id);
        map.set(m.id, {
          ...m,
          attachments: m.attachments.length || m.deleted ? m.attachments : (local?.attachments ?? []),
          status: "sent",
        });
      }
      return sortMessages([...map.values()]);
    });
  }, []);

  // ---- Initial load ---------------------------------------------------------
  const load = useCallback(async () => {
    const [d, page] = await Promise.all([
      conversationDetailAction({ id: conversationId }),
      listMessagesAction({ conversationId, beforeSeq: null, afterSeq: null }),
    ]);
    if (!d.ok || !page.ok) {
      const code = !d.ok ? d.error.code : !page.ok ? page.error.code : null;
      setState(code === "NOT_FOUND" || code === "FORBIDDEN" ? "not_found" : "error");
      return;
    }
    setDetail(d.data);
    mergeAuthors([...page.data.authors, ...d.data.members]);
    setMessages(page.data.messages.map((m) => ({ ...m, status: "sent" as const })));
    setHasMore(page.data.hasMore);
    const firstUnread = page.data.messages.find((m) => m.seq > d.data.lastReadSeq && m.authorId !== me);
    setFirstUnreadSeq(firstUnread?.seq ?? null);
    stickToBottom.current = true;
    setState("ready");
  }, [conversationId, me, mergeAuthors]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Focus: composer on desktop, heading on touch (avoid popping the keyboard).
  const focused = useRef(false);
  useEffect(() => {
    if (state !== "ready" || focused.current) return;
    focused.current = true;
    if (window.matchMedia("(pointer: fine)").matches) composerRef.current?.focus();
    else headingRef.current?.focus();
  }, [state]);

  // ---- Realtime for this conversation (RLS-filtered) ---------------------------
  const resync = useCallback(async () => {
    const after = messagesRef.current.reduce((m, x) => Math.max(m, x.seq), 0);
    const res = await listMessagesAction({ conversationId, beforeSeq: null, afterSeq: after }).catch(() => null);
    if (!res) return;
    if (res.ok) {
      mergeAuthors(res.data.authors);
      upsert(res.data.messages);
    } else if (res.error.code === "NOT_FOUND") {
      setState("not_found");
    }
  }, [conversationId, mergeAuthors, upsert]);

  const authorsRef = useRef(authors);
  useEffect(() => {
    authorsRef.current = authors;
  }, [authors]);

  useEffect(() => {
    if (state !== "ready") return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disconnected = false;

    void (async () => {
      if (!(await authorizeRealtime(supabase)) || cancelled) return;
      channel = supabase
        .channel(`chat-conv:${conversationId}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (payload.eventType === "DELETE") return; // messages are only soft-deleted
            const row = payload.new as MessageRow;
            const prev = messagesRef.current.find((m) => m.id === row.id);
            const dto = rowToDTO(row, prev);
            upsert([dto]);
            const needsFetch =
              (!row.deleted_at && row.attachment_count > 0 && !(prev?.attachments.length)) ||
              !authorsRef.current.has(row.author_id);
            if (needsFetch) {
              void getMessageAction({ id: row.id }).then((r) => {
                if (!r.ok) return;
                mergeAuthors([r.data.author]);
                upsert([r.data.message]);
              });
            }
            if (payload.eventType === "INSERT" && row.author_id !== me && !prev) {
              const author = authorsRef.current.get(row.author_id);
              const plain = renderIssueRefsPlain(
                renderMentionsPlain(row.body, (id) => {
                  const p = authorsRef.current.get(id);
                  return p ? displayName(p) : null;
                }),
                issueRefNumber,
                "eine Aufgabe",
              );
              const preview = plain ? `: ${plain.slice(0, 140)}` : " mit Anhang";
              setAnnouncement(`Neue Nachricht von ${author ? displayName(author) : "einem Mitglied"}${preview}`);
            }
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && disconnected) {
            disconnected = false;
            void resync(); // fetch what was missed while offline
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            disconnected = true;
          }
        });
    })();

    let hiddenSince = 0;
    const onVis = () => {
      const v = document.visibilityState === "visible";
      setVisible(v);
      if (!v) hiddenSince = Date.now();
      else if (hiddenSince && Date.now() - hiddenSince > 30_000) void resync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", resync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", resync);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [state, conversationId, me, upsert, resync, mergeAuthors]);

  // ---- Scrolling ------------------------------------------------------------
  useEffect(() => {
    const root = scrollRef.current;
    const bottom = bottomRef.current;
    if (!root || !bottom) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setAtBottom(e.isIntersecting);
        if (e.isIntersecting) setNewBelow(false);
      },
      { root, rootMargin: "0px 0px 80px 0px" },
    );
    io.observe(bottom);
    return () => io.disconnect();
  }, [state]);

  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;
    const oldest = messagesRef.current.find((m) => m.seq > 0)?.seq;
    if (!el || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    const res = await listMessagesAction({ conversationId, beforeSeq: oldest, afterSeq: null });
    if (res.ok) {
      restore.current = { height: el.scrollHeight, top: el.scrollTop };
      mergeAuthors(res.data.authors);
      upsert(res.data.messages);
      setHasMore(res.data.hasMore);
    }
    setLoadingOlder(false);
  }, [conversationId, loadingOlder, mergeAuthors, upsert]);

  useEffect(() => {
    const root = scrollRef.current;
    const top = topRef.current;
    if (!root || !top || !hasMore) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void loadOlder(), { root, rootMargin: "200px 0px 0px 0px" });
    io.observe(top);
    return () => io.disconnect();
  }, [hasMore, loadOlder, state]);

  const lastId = messages.at(-1)?.id;
  const prevLastId = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restore.current) {
      // Older messages were prepended: keep the visible content in place.
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (lastId !== prevLastId.current) {
      if (stickToBottom.current || atBottom) {
        el.scrollTop = el.scrollHeight;
      } else if (prevLastId.current !== undefined) {
        setNewBelow(true); // don't yank the reader down; offer a hint instead
      }
    }
    stickToBottom.current = false;
    prevLastId.current = lastId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ---- Jump to a message (from a notification) --------------------------------
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusAttempts = useRef(0);
  const focusedMessage = useRef<string | null>(null);
  useEffect(() => {
    if (state !== "ready" || !focusMessageId || focusedMessage.current === focusMessageId) return;
    const found = messages.some((m) => m.id === focusMessageId);
    if (!found) {
      // Older than the loaded pages: page back a bounded number of times.
      if (hasMore && !loadingOlder && focusAttempts.current < 20) {
        focusAttempts.current++;
        void loadOlder();
      } else if (!hasMore || focusAttempts.current >= 20) {
        focusedMessage.current = focusMessageId;
        toast.info("Diese Nachricht gibt es nicht mehr.");
      }
      return;
    }
    focusedMessage.current = focusMessageId;
    focusAttempts.current = 0;
    const raf = requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`message-${focusMessageId}`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      setHighlightId(focusMessageId);
    });
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [state, focusMessageId, messages, hasMore, loadingOlder, loadOlder]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setNewBelow(false);
  };

  // ---- Read state: only when visible, active and scrolled to the end --------
  const readSent = useRef(0);
  const setLastRead = chat.setLastRead;
  useEffect(() => {
    if (state !== "ready" || !atBottom || !visible || maxSeq === 0) return;
    const known = Math.max(readSent.current, summary?.lastReadSeq ?? 0);
    if (maxSeq <= known) return;
    const t = setTimeout(() => {
      readSent.current = maxSeq;
      setLastRead(conversationId, maxSeq);
      void markReadAction({ conversationId, seq: maxSeq }).catch(() => {
        readSent.current = 0; // retry on the next opportunity
      });
    }, 800);
    return () => clearTimeout(t);
  }, [state, atBottom, visible, maxSeq, conversationId, summary?.lastReadSeq, setLastRead]);

  // ---- Sending --------------------------------------------------------------
  const pendingAttachmentIds = useRef(new Map<string, string[]>());
  const noteSending = chat.noteSending;
  const deliver = useCallback(
    async (id: string, body: string, attachmentIds: string[]) => {
      noteSending(conversationId, 1);
      // A network failure throws instead of returning an error result.
      const res = await sendMessageAction({ id, conversationId, body, attachmentIds }).catch(() => OFFLINE);
      noteSending(conversationId, -1);
      if (res.ok) {
        pendingAttachmentIds.current.delete(id);
        upsert([res.data]);
        setLastRead(conversationId, res.data.seq);
        readSent.current = Math.max(readSent.current, res.data.seq);
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === id && m.status !== "sent" ? { ...m, status: "failed", error: res.error.message } : m)),
        );
        if (res.error.code === "NOT_FOUND") toast.error(res.error.message);
      }
    },
    [conversationId, noteSending, setLastRead, upsert],
  );

  const send = (markup: string, attachments: AttachmentDTO[]) => {
    const id = crypto.randomUUID(); // idempotency key, reused on retry
    pendingAttachmentIds.current.set(id, attachments.map((a) => a.id));
    stickToBottom.current = true;
    setMessages((prev) =>
      sortMessages([
        ...prev,
        {
          id,
          seq: 0,
          conversationId,
          authorId: me ?? "",
          body: markup,
          markup,
          mentionIds: extractMentionIds(markup),
          issueRefs: [],
          createdAt: new Date().toISOString(),
          editedAt: null,
          deleted: false,
          attachments,
          status: "sending",
        },
      ]),
    );
    void deliver(id, markup, attachments.map((a) => a.id));
  };

  const retry = (m: MessageVM) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "sending", error: undefined } : x)));
    void deliver(m.id, m.markup, pendingAttachmentIds.current.get(m.id) ?? []);
  };

  const backToComposer = (m: MessageVM) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    composerRef.current?.setText(m.markup);
    if ((pendingAttachmentIds.current.get(m.id) ?? []).length) {
      toast.info("Anhänge bitte erneut hinzufügen.");
    }
    pendingAttachmentIds.current.delete(m.id);
  };

  const edit = async (m: MessageVM, body: string) => {
    const res = await editMessageAction({ id: m.id, body }).catch(() => OFFLINE);
    if (!res.ok) {
      toast.error(res.error.message);
      return false;
    }
    upsert([res.data]);
    return true;
  };

  // ---- Render ---------------------------------------------------------------
  if (state === "loading") return <ConversationSkeleton />;
  if (state === "not_found" || state === "error") {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center border-b px-2 md:hidden">
          <Button asChild variant="ghost" size="sm">
            <Link href="/chat">
              <ChevronLeft aria-hidden /> Chat
            </Link>
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-xs text-center" role="alert">
            <h1 className="text-lg font-semibold">{state === "not_found" ? "Kein Zugriff" : "Verbindung fehlgeschlagen"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {state === "not_found"
                ? "Diese Unterhaltung gibt es nicht oder du hast keinen Zugriff darauf."
                : "Die Unterhaltung konnte nicht geladen werden."}
            </p>
            {state === "error" && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setState("loading");
                  void load();
                }}
              >
                Erneut versuchen
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const d = detail!;
  const title = summary?.title ?? d.title;
  const description = summary?.description ?? d.description;
  const archived = summary?.archived ?? d.archived;
  const readOnlyReason = archived ? "archived" : d.readOnlyReason === "inactive_partner" ? "inactive_partner" : null;
  const canPost = !readOnlyReason;
  const composerLabel = d.kind === "dm" ? `Nachricht an ${title}` : `Nachricht in #${title}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
        <Button asChild variant="ghost" size="icon" className="size-9 md:hidden">
          <Link href="/chat" aria-label="Zurück zur Übersicht">
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <ConversationIcon conversation={summary ?? d} />
        <div className="min-w-0 flex-1">
          <h1 ref={headingRef} tabIndex={-1} className="truncate text-[15px] font-semibold outline-none">
            {title}
            {archived && <span className="font-normal text-muted-foreground"> · archiviert</span>}
          </h1>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="icon" className="size-9" aria-label="Details anzeigen" onClick={() => setDetailsOpen(true)}>
          <Info aria-hidden />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div ref={topRef} aria-hidden className="h-px" />
          {hasMore ? (
            <div className="flex justify-center py-3">
              <Button variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? "Wird geladen …" : "Ältere Nachrichten laden"}
              </Button>
            </div>
          ) : messages.length > 0 ? (
            <p className="px-5 pt-6 pb-2 text-center text-xs text-muted-foreground">Anfang der Unterhaltung</p>
          ) : null}

          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-xs">
                <p className="font-medium">Noch keine Nachrichten</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canPost ? "Schreib die erste Nachricht." : "In dieser Unterhaltung wurde nichts geschrieben."}
                </p>
              </div>
            </div>
          ) : (
            <ol aria-label={`Nachrichten in ${title}`} className="pb-3">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                const showUnread = firstUnreadSeq !== null && m.seq === firstUnreadSeq;
                const compact =
                  !newDay &&
                  !showUnread &&
                  prev !== undefined &&
                  prev.authorId === m.authorId &&
                  !prev.deleted &&
                  Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
                return (
                  <SeparatedItem key={m.id} day={newDay ? dayLabel(m.createdAt) : null} unread={showUnread}>
                    <MessageItem
                      message={m}
                      author={authors.get(m.authorId) ?? workspaceMembers.find((w) => w.userId === m.authorId)}
                      own={m.authorId === me}
                      compact={compact}
                      canAct={canPost}
                      onEdit={(body) => edit(m, body)}
                      onDelete={() => setToDelete(m)}
                      onRetry={() => retry(m)}
                      onDiscard={() => backToComposer(m)}
                      me={me}
                      nameOf={nameOf}
                      mentionCandidates={mentionCandidates}
                      highlighted={highlightId === m.id}
                    />
                  </SeparatedItem>
                );
              })}
            </ol>
          )}
          <div ref={bottomRef} aria-hidden className="h-px" />
        </div>

        {newBelow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button size="sm" className="pointer-events-auto shadow-raised" onClick={scrollToBottom}>
              <ArrowDown aria-hidden /> Neue Nachrichten
            </Button>
          </div>
        )}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {canPost ? (
        <Composer
          ref={composerRef}
          conversationId={conversationId}
          label={composerLabel}
          initialDraft={chat.getDraft(conversationId)}
          onDraftChange={(t) => chat.setDraft(conversationId, t)}
          onSend={send}
          mentionCandidates={mentionCandidates}
          nameOf={nameOf}
        />
      ) : (
        <p className="shrink-0 border-t bg-surface-subtle px-4 py-3 text-sm text-muted-foreground" role="status">
          {readOnlyReason === "archived"
            ? "Dieser Kanal ist archiviert. Der Verlauf bleibt lesbar, neue Nachrichten sind nicht möglich."
            : `${title} ist kein aktives Mitglied mehr. Die Unterhaltung ist schreibgeschützt.`}
        </p>
      )}

      <ConversationDetails
        conversationId={conversationId}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onChanged={() => {
          void conversationDetailAction({ id: conversationId }).then((r) => {
            if (r.ok) setDetail(r.data);
            else if (r.error.code === "NOT_FOUND") setState("not_found");
          });
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nachricht löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Inhalt und alle Anhänge werden endgültig entfernt. Es bleibt der Hinweis „Nachricht gelöscht“.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const m = toDelete;
                if (!m) return;
                const res = await deleteMessageAction({ id: m.id }).catch(() => OFFLINE);
                if (res.ok) upsert([res.data]);
                else toast.error(res.error.message);
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

function SeparatedItem({ day, unread, children }: { day: string | null; unread: boolean; children: React.ReactNode }) {
  return (
    <>
      {day && (
        <li role="separator" aria-label={day} className="flex items-center gap-3 px-5 pt-4 pb-1">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">{day}</span>
          <span className="h-px flex-1 bg-border" />
        </li>
      )}
      {unread && (
        <li role="separator" aria-label="Neue Nachrichten" className={cn("flex items-center gap-3 px-5 pt-2 pb-1")}>
          <span className="h-px flex-1 bg-accent-blue/40" />
          <span className="text-xs font-medium text-accent-blue-text">Neu</span>
          <span className="h-px flex-1 bg-accent-blue/40" />
        </li>
      )}
      {children}
    </>
  );
}
