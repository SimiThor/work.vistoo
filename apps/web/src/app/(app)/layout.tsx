import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import { ChatProvider } from "@/components/chat/chat-context";
import {
  ExternalNavLinks,
  MobileMeetingButton,
  MobileNav,
  NavLinks,
  NavLinksFallback,
} from "@/components/shell/nav";
import { NotificationBell } from "@/components/shell/notification-bell";
import { SidebarProjects, SidebarProjectsSkeleton } from "@/components/shell/sidebar-projects";
import { UserMenu, UserMenuSkeleton } from "@/components/shell/user-menu";
import { getViewer } from "@/server/queries";

async function ExternalLinks() {
  const { me, meetingUrl } = await getViewer();
  return <ExternalNavLinks meetingUrl={meetingUrl} canConfigure={me.role === "admin"} />;
}

async function MobileMeeting() {
  const { meetingUrl } = await getViewer();
  return <MobileMeetingButton meetingUrl={meetingUrl} />;
}

function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
        <BrandMark />
        <NotificationBell className="hidden lg:inline-flex" />
      </div>
      <nav aria-label="Hauptnavigation" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-2 pb-4">
        <div>
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
          <Suspense fallback={<ExternalNavLinks meetingUrl={undefined} canConfigure={false} />}>
            <ExternalLinks />
          </Suspense>
        </div>
        <Suspense fallback={<SidebarProjectsSkeleton />}>
          <SidebarProjects />
        </Suspense>
      </nav>
      <div className="shrink-0 border-t p-2">
        <Suspense fallback={<UserMenuSkeleton />}>
          <UserMenu />
        </Suspense>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <ChatProvider>
      <div className="flex h-dvh overflow-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-raised"
        >
          Zum Inhalt springen
        </a>
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
          <SidebarContent />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 lg:hidden">
            <MobileNav>
              <SidebarContent />
            </MobileNav>
            <BrandMark />
            <div className="ml-auto flex items-center gap-1">
              <Suspense>
                <MobileMeeting />
              </Suspense>
              <NotificationBell align="end" className="size-9" />
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
            {children}
          </main>
        </div>
      </div>
    </ChatProvider>
  );
}
