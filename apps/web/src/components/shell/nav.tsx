"use client";

import {
  ArrowUpRight,
  CalendarDays,
  CircleCheck,
  FolderOpen,
  Headphones,
  Landmark,
  Lightbulb,
  ListTodo,
  Menu,
  MessageSquare,
  Scale,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useChatOptional } from "@/components/chat/chat-context";
import { SHARED_DRIVE_URL } from "@/lib/external-links";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/tasks", label: "Alle Aufgaben", icon: ListTodo },
  { href: "/todos", label: "Meine To-dos", icon: CircleCheck },
  { href: "/ideas", label: "Ideen", icon: Lightbulb },
  { href: "/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/decisions", label: "Entscheidungen", icon: Scale },
  { href: "/crm", label: "CRM", icon: Landmark },
  { href: "/chat", label: "Chat", icon: MessageSquare },
] as const;

export const navItemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground/85 transition-colors hover:bg-sidebar-accent";

/** Small neutral-accent dot; the accessible text is provided separately. */
export function UnreadDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full bg-accent-blue", className)} />;
}

function Items({ pathname }: { pathname: string | null }) {
  const chatUnread = useChatOptional()?.hasUnread ?? false;
  return (
    <ul className="space-y-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || ((href === "/chat" || href === "/meetings") && Boolean(pathname?.startsWith(`${href}/`)));
        const unread = href === "/chat" && chatUnread;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(navItemClass, active && "bg-sidebar-accent font-medium text-foreground")}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1">{label}</span>
              {unread && (
                <>
                  <UnreadDot />
                  <span className="sr-only">(ungelesene Nachrichten)</span>
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NavLinks() {
  return <Items pathname={usePathname()} />;
}
export function NavLinksFallback() {
  return <Items pathname={null} />;
}

const MEETING_LABEL = "Besprechung beitreten";

/** External destinations that open in a new tab, marked with a small arrow. */
function ExternalItem({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Headphones }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(navItemClass, "group")}>
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      <ArrowUpRight
        className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
      <span className="sr-only">(öffnet in neuem Tab)</span>
    </a>
  );
}

/**
 * "Files" (shared Google Drive folder) and "Besprechung beitreten" (Discord
 * voice channel). Without a configured meeting link the entry never leads
 * nowhere: admins get a shortcut to the setting, everyone else a muted hint.
 */
export function ExternalNavLinks({
  meetingUrl,
  canConfigure,
}: {
  /** undefined = still loading (renders a neutral row). */
  meetingUrl: string | null | undefined;
  canConfigure: boolean;
}) {
  return (
    <ul className="mt-0.5 space-y-0.5">
      <li>
        <ExternalItem href={SHARED_DRIVE_URL} label="Files" icon={FolderOpen} />
      </li>
      <li>
        {meetingUrl ? (
          <ExternalItem href={meetingUrl} label={MEETING_LABEL} icon={Headphones} />
        ) : canConfigure ? (
          <Link href="/settings#meeting" className={navItemClass}>
            <Headphones className="size-4 text-muted-foreground/60" aria-hidden />
            <span className="flex-1 truncate text-muted-foreground">Besprechung</span>
            <span className="text-xs text-muted-foreground">Einrichten</span>
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(navItemClass, "cursor-default hover:bg-transparent")}>
            <Headphones className="size-4 text-muted-foreground/60" aria-hidden />
            <span className="flex-1 truncate text-muted-foreground">
              {meetingUrl === null ? "Besprechung" : MEETING_LABEL}
            </span>
            {meetingUrl === null && <span className="text-xs text-muted-foreground/80">Nicht eingerichtet</span>}
          </span>
        )}
      </li>
    </ul>
  );
}

/** Phone & tablet header: one-tap join when a meeting link is configured. */
export function MobileMeetingButton({ meetingUrl }: { meetingUrl: string | null }) {
  if (!meetingUrl) return null;
  return (
    <Button variant="ghost" size="icon" className="ml-auto size-9" asChild>
      <a href={meetingUrl} target="_blank" rel="noopener noreferrer" aria-label={`${MEETING_LABEL} (öffnet Discord)`}>
        <Headphones aria-hidden />
      </a>
    </Button>
  );
}

/** Gear next to the user's name: opens the settings (team, meeting link). */
export function SettingsButton() {
  const active = usePathname() === "/settings";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(active && "bg-sidebar-accent text-foreground")}
      asChild
    >
      <Link href="/settings" aria-label="Einstellungen" title="Einstellungen" aria-current={active ? "page" : undefined}>
        <Settings aria-hidden />
      </Link>
    </Button>
  );
}

/** Calls `onNavigate` after every route change, including programmatic ones (e.g. after creating a project). */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (pathname === last.current) return;
    last.current = pathname;
    onNavigate();
  }, [pathname, onNavigate]);
  return null;
}

/** Tablet & phone: navigation in a slide-over sheet. Closes when a link is chosen. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const chatUnread = useChatOptional()?.hasUnread ?? false;
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Own Suspense boundary: reading the URL must not block prerendering of the shell. */}
      <Suspense fallback={null}>
        <CloseOnNavigate onNavigate={close} />
      </Suspense>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9"
          aria-label={chatUnread ? "Navigation öffnen (ungelesene Nachrichten)" : "Navigation öffnen"}
        >
          <Menu aria-hidden />
          {chatUnread && <UnreadDot className="absolute top-1.5 right-1.5" />}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[85vw] bg-sidebar p-0" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {/* Close after choosing a destination. */}
        <div
          className="h-full"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
