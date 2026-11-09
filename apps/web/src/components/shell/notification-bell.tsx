"use client";

import { AtSign, Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChatOptional } from "@/components/chat/chat-context";
import { displayName } from "@vistoo/domain";
import type { NotificationDTO } from "@vistoo/domain/dto";
import { cn } from "@/lib/utils";

const rtf = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto", style: "short" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

function when(iso: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  if (diff > -60) return "gerade eben";
  if (diff > -3600) return rtf.format(Math.round(diff / 60), "minute");
  if (diff > -86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (diff > -7 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
  return dateFmt.format(new Date(iso));
}

const where = (n: NotificationDTO) => (n.conversationKind === "dm" ? "in einer Direktnachricht" : `in #${n.conversationTitle}`);

/**
 * In-app notifications (mentions). A click opens the conversation at the
 * message and marks the entry read; reading the conversation does too.
 */
export function NotificationBell({ align = "start", className }: { align?: "start" | "end"; className?: string }) {
  const chat = useChatOptional();
  const [open, setOpen] = useState(false);
  if (!chat) return null;
  const { notifications, unreadNotifications: unread } = chat;
  const label = unread > 0 ? `Mitteilungen, ${unread} ungelesen` : "Mitteilungen";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void chat.reloadNotifications();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative size-8 text-muted-foreground", className)} aria-label={label} title="Mitteilungen">
          <Bell aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-blue px-1 text-[9px] leading-none font-semibold text-white tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(22rem,calc(100vw-1rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Mitteilungen</h2>
          {unread > 0 && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void chat.markNotificationsRead()}>
              Alle gelesen
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
            <AtSign className="size-5 text-muted-foreground/70" aria-hidden />
            <p className="text-sm font-medium">Keine Erwähnungen</p>
            <p className="text-xs text-muted-foreground">Wenn dich jemand im Chat mit @ erwähnt, erscheint es hier.</p>
          </div>
        ) : (
          <ul className="max-h-[min(26rem,70dvh)] overflow-y-auto p-1" aria-label="Erwähnungen">
            {notifications.map((n) => {
              const actor = n.actor ? displayName(n.actor) : "Ehemaliges Mitglied";
              return (
                <li key={n.id}>
                  <Link
                    href={`/chat/${n.conversationId}?message=${n.messageId}`}
                    onClick={() => {
                      setOpen(false);
                      if (!n.readAt) void chat.markNotificationsRead([n.id]);
                    }}
                    className="flex gap-2.5 rounded-lg px-2 py-2 outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle"
                  >
                    <MemberAvatar member={n.actor} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-[13px] leading-snug">
                          <span className="font-semibold">{actor}</span>
                          <span className="text-muted-foreground"> hat dich {where(n)} erwähnt</span>
                        </span>
                        <time dateTime={n.createdAt} className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {when(n.createdAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[13px] text-foreground/80">
                        {n.preview || <span className="text-muted-foreground italic">Nachricht gelöscht</span>}
                      </span>
                    </span>
                    {!n.readAt && (
                      <>
                        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-blue" />
                        <span className="sr-only">(ungelesen)</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
