"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  chatBootstrapAction,
  listConversationsAction,
  listNotificationsAction,
  markNotificationsReadAction,
} from "@/app/actions/chat";
import type { ConversationKind, ConversationSummary } from "@vistoo/domain/chat-types";
import type { NotificationDTO } from "@vistoo/domain/dto";
import type { MemberDTO, MemberRole } from "@vistoo/domain";
import { authorizeRealtime, getBrowserSupabase } from "@/lib/supabase-browser";

type ChatState = {
  ready: boolean;
  error: string | null;
  me: { userId: string; role: MemberRole } | null;
  workspaceId: string | null;
  conversations: ConversationSummary[];
  members: MemberDTO[];
  hasUnread: boolean;
  reload: () => Promise<void>;
  /** Local bookkeeping after reading or sending. */
  setLastRead: (conversationId: string, seq: number) => void;
  noteSending: (conversationId: string, delta: 1 | -1) => void;
  getDraft: (conversationId: string) => string;
  setDraft: (conversationId: string, text: string) => void;
  /** In-app notifications (mentions), newest first. */
  notifications: NotificationDTO[];
  unreadNotifications: number;
  reloadNotifications: () => Promise<void>;
  /** Marks the given notifications (or all) as read. */
  markNotificationsRead: (ids?: string[]) => Promise<void>;
};

const ChatContext = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const v = use(ChatContext);
  if (!v) throw new Error("useChat must be used inside <ChatProvider>");
  return v;
}

/** Optional variant for components that may render outside the provider. */
export function useChatOptional(): ChatState | null {
  return use(ChatContext);
}

const DRAFT_PREFIX = "vistoo:draft:";

/** Drafts live in sessionStorage (per tab session) and are removed on logout. */
export function clearChatDrafts() {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(DRAFT_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

type ConversationRow = {
  id: string;
  workspace_id: string;
  kind: ConversationKind;
  name: string | null;
  description: string;
  archived_at: string | null;
  owner_id: string | null;
  last_message_seq: number;
  last_message_at: string | null;
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    ready: boolean;
    error: string | null;
    me: ChatState["me"];
    workspaceId: string | null;
    conversations: ConversationSummary[];
    members: MemberDTO[];
  }>({ ready: false, error: null, me: null, workspaceId: null, conversations: [], members: [] });
  const sending = useRef(new Map<string, number>());
  const [inbox, setInbox] = useState<{ notifications: NotificationDTO[]; unread: number }>({
    notifications: [],
    unread: 0,
  });

  const reloadNotifications = useCallback(async () => {
    const res = await listNotificationsAction().catch(() => null);
    if (res?.ok) setInbox({ notifications: res.data.notifications, unread: res.data.unreadCount });
  }, []);

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    const now = new Date().toISOString();
    setInbox((s) => {
      const hit = (n: NotificationDTO) => !n.readAt && (!ids || ids.includes(n.id));
      const changed = s.notifications.filter(hit).length;
      return {
        notifications: s.notifications.map((n) => (hit(n) ? { ...n, readAt: now } : n)),
        unread: ids ? Math.max(0, s.unread - changed) : 0,
      };
    });
    const res = await markNotificationsReadAction(ids ? { ids } : {}).catch(() => null);
    if (res?.ok) setInbox((s) => ({ ...s, unread: res.data.unreadCount }));
  }, []);

  const bootstrap = useCallback(async () => {
    const res = await chatBootstrapAction();
    if (!res.ok) {
      setState((s) => ({ ...s, ready: true, error: res.error.message }));
      return;
    }
    setState({
      ready: true,
      error: null,
      me: res.data.me,
      workspaceId: res.data.workspaceId,
      conversations: res.data.conversations,
      members: res.data.members,
    });
  }, []);

  const reload = useCallback(async () => {
    const res = await listConversationsAction();
    if (res.ok) setState((s) => ({ ...s, conversations: mergeReadState(s.conversations, res.data) }));
  }, []);

  useEffect(() => {
    // Initial load is a one-off fetch from an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap();
    void reloadNotifications();
  }, [bootstrap, reloadNotifications]);

  // ---- Realtime: lightweight list/unread signals ----------------------------
  const workspaceId = state.workspaceId;
  const userId = state.me?.userId;
  useEffect(() => {
    if (!workspaceId || !userId) return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disconnected = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let inboxTimer: ReturnType<typeof setTimeout> | undefined;
    const reloadSoon = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void reload(), 300);
    };
    const reloadInboxSoon = () => {
      clearTimeout(inboxTimer);
      inboxTimer = setTimeout(() => void reloadNotifications(), 300);
    };
    const reloadAllSoon = () => {
      reloadSoon();
      reloadInboxSoon();
    };

    void (async () => {
      if (!(await authorizeRealtime(supabase)) || cancelled) return;
      channel = supabase
        .channel(`chat-list:${workspaceId}:${Math.random().toString(36).slice(2)}`)
        // RLS delivers only conversations this user may access.
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            const row = payload.new as ConversationRow;
            setState((s) => {
              if (!s.conversations.some((c) => c.id === row.id)) {
                reloadSoon();
                return s;
              }
              return {
                ...s,
                conversations: s.conversations.map((c) => {
                  if (c.id !== row.id) return c;
                  const ownSend = (sending.current.get(c.id) ?? 0) > 0;
                  const lastReadSeq = ownSend ? Math.max(c.lastReadSeq, Number(row.last_message_seq)) : c.lastReadSeq;
                  return {
                    ...c,
                    title: c.kind === "dm" ? c.title : (row.name ?? c.title),
                    description: row.description,
                    archived: row.archived_at !== null,
                    ownerId: row.owner_id,
                    lastMessageSeq: Number(row.last_message_seq),
                    lastMessageAt: row.last_message_at,
                    lastReadSeq,
                    unread: Number(row.last_message_seq) > lastReadSeq,
                  };
                }),
              };
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
          reloadSoon,
        )
        // Only INSERTs for my own rows: being added to a channel/DM. (DELETE events
        // are deliberately not subscribed: they cannot be filtered server-side.)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` },
          reloadSoon,
        )
        // My mention notifications (RLS: own rows only). New or read elsewhere.
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          reloadInboxSoon,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          reloadInboxSoon,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && disconnected) {
            disconnected = false;
            reloadAllSoon();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            disconnected = true;
          }
        });
    })();

    const onVisible = () => document.visibilityState === "visible" && reloadAllSoon();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reloadAllSoon);
    return () => {
      cancelled = true;
      clearTimeout(reloadTimer);
      clearTimeout(inboxTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reloadAllSoon);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [workspaceId, userId, reload, reloadNotifications]);

  const setLastRead = useCallback((conversationId: string, seq: number) => {
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === conversationId && seq > c.lastReadSeq
          ? { ...c, lastReadSeq: seq, unread: c.lastMessageSeq > seq }
          : c,
      ),
    }));
  }, []);

  const noteSending = useCallback((conversationId: string, delta: 1 | -1) => {
    const m = sending.current;
    m.set(conversationId, Math.max(0, (m.get(conversationId) ?? 0) + delta));
  }, []);

  const draftKey = useCallback((id: string) => `${DRAFT_PREFIX}${userId ?? "anon"}:${id}`, [userId]);
  const getDraft = useCallback(
    (id: string) => {
      try {
        return window.sessionStorage.getItem(draftKey(id)) ?? "";
      } catch {
        return "";
      }
    },
    [draftKey],
  );
  const setDraft = useCallback(
    (id: string, text: string) => {
      try {
        if (text) window.sessionStorage.setItem(draftKey(id), text);
        else window.sessionStorage.removeItem(draftKey(id));
      } catch {
        /* storage unavailable */
      }
    },
    [draftKey],
  );

  const value = useMemo<ChatState>(
    () => ({
      ...state,
      hasUnread: state.conversations.some((c) => c.unread && !c.archived),
      reload,
      setLastRead,
      noteSending,
      getDraft,
      setDraft,
      notifications: inbox.notifications,
      unreadNotifications: inbox.unread,
      reloadNotifications,
      markNotificationsRead,
    }),
    [state, reload, setLastRead, noteSending, getDraft, setDraft, inbox, reloadNotifications, markNotificationsRead],
  );

  return <ChatContext value={value}>{children}</ChatContext>;
}

/** Keeps locally advanced read positions when a fresh list arrives. */
function mergeReadState(prev: ConversationSummary[], next: ConversationSummary[]): ConversationSummary[] {
  const local = new Map(prev.map((c) => [c.id, c.lastReadSeq]));
  return next.map((c) => {
    const lastReadSeq = Math.max(c.lastReadSeq, local.get(c.id) ?? 0);
    return { ...c, lastReadSeq, unread: c.lastMessageSeq > lastReadSeq };
  });
}
