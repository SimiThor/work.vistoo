import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import { MobileNav, NavLinks, NavLinksFallback } from "@/components/shell/nav";
import { SidebarProjects, SidebarProjectsSkeleton } from "@/components/shell/sidebar-projects";
import { UserMenu, UserMenuSkeleton } from "@/components/shell/user-menu";

function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <BrandMark />
      </div>
      <nav aria-label="Hauptnavigation" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-2 pb-4">
        <Suspense fallback={<NavLinksFallback />}>
          <NavLinks />
        </Suspense>
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
        </header>
        <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
