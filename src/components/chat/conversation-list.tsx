"use client";

import { ChevronRight, Hash, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { UnreadDot } from "@/components/shell/nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationSummary } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";
import { NewChannelDialog } from "./new-channel-dialog";
import { NewDmDialog } from "./new-dm-dialog";
import { StorageNotice } from "./storage-notice";

export function ConversationIcon({ conversation, className }: { conversation: ConversationSummary; className?: string }) {
  if (conversation.kind === "dm") {
    return <MemberAvatar member={conversation.dmPartner} size="xs" className={className} />;
  }
  const Icon = conversation.kind === "private_channel" ? Lock : Hash;
  return <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />;
}

function Row({ c, active }: { c: ConversationSummary; active: boolean }) {
  const kindLabel = c.kind === "dm" ? "Direktnachricht" : c.kind === "private_channel" ? "Geschlossener Kanal" : "Kanal";
  return (
    <li>
      <Link
        href={`/chat/${c.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground/85 transition-colors hover:bg-surface-subtle md:h-8",
          active && "bg-surface-sunken font-medium text-foreground hover:bg-surface-sunken",
          c.unread && !active && "font-semibold text-foreground",
          c.archived && "text-muted-foreground",
        )}
      >
        <ConversationIcon conversation={c} />
        <span className="min-w-0 flex-1 truncate">
          {c.title}
          <span className="sr-only">
            , {kindLabel}
            {c.archived ? ", archiviert" : ""}
            {c.unread ? ", ungelesene Nachrichten" : ""}
          </span>
        </span>
        {c.unread && <UnreadDot />}
      </Link>
    </li>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex h-8 items-center justify-between pr-1 pl-2.5">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ConversationList({ activeId }: { activeId: string | null }) {
  const { ready, error, conversations, me } = useChat();
  const [dialog, setDialog] = useState<"channel" | "dm" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { channels, dms, archived } = useMemo(() => {
    const live = conversations.filter((c) => !c.archived);
    return {
      channels: live
        .filter((c) => c.kind !== "dm")
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.title.localeCompare(b.title, "de")),
      dms: live
        .filter((c) => c.kind === "dm")
        .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.title.localeCompare(b.title, "de")),
      archived: conversations.filter((c) => c.archived).sort((a, b) => a.title.localeCompare(b.title, "de")),
    };
  }, [conversations]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <h1 className="text-lg font-semibold tracking-tight">Chat</h1>
      </div>
      <nav aria-label="Unterhaltungen" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {!ready ? (
          <div className="space-y-2 px-2.5 pt-2" aria-busy="true" aria-label="Unterhaltungen werden geladen">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
        ) : error ? (
          <p role="alert" className="px-2.5 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <>
            <Section
              title="Kanäle"
              action={
                <Button variant="ghost" size="icon-sm" aria-label="Kanal erstellen" onClick={() => setDialog("channel")}>
                  <Plus aria-hidden />
                </Button>
              }
            >
              <ul className="space-y-0.5">
                {channels.map((c) => (
                  <Row key={c.id} c={c} active={c.id === activeId} />
                ))}
              </ul>
            </Section>
            <Section
              title="Direktnachrichten"
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Direktnachricht beginnen"
                  onClick={() => setDialog("dm")}
                >
                  <Plus aria-hidden />
                </Button>
              }
            >
              {dms.length === 0 ? (
                <p className="px-2.5 text-sm text-muted-foreground">Noch keine Direktnachrichten.</p>
              ) : (
                <ul className="space-y-0.5">
                  {dms.map((c) => (
                    <Row key={c.id} c={c} active={c.id === activeId} />
                  ))}
                </ul>
              )}
            </Section>
            {archived.length > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-expanded={showArchived}
                  aria-controls="archived-conversations"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  <ChevronRight className={cn("transition-transform", showArchived && "rotate-90")} aria-hidden />
                  Archiviert ({archived.length})
                </Button>
                {showArchived && (
                  <ul id="archived-conversations" className="mt-1 space-y-0.5">
                    {archived.map((c) => (
                      <Row key={c.id} c={c} active={c.id === activeId} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </nav>
      {me?.role === "admin" && <StorageNotice />}
      <NewChannelDialog open={dialog === "channel"} onOpenChange={(o) => setDialog(o ? "channel" : null)} />
      <NewDmDialog open={dialog === "dm"} onOpenChange={(o) => setDialog(o ? "dm" : null)} />
    </div>
  );
}
