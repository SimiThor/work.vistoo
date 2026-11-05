"use client";

import { FolderKanban, ListTodo, Menu, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/tasks", label: "Alle Aufgaben", icon: ListTodo },
  { href: "/projects", label: "Projekte", icon: FolderKanban },
  { href: "/team", label: "Team", icon: Users },
] as const;

export const navItemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground/85 transition-colors hover:bg-sidebar-accent";

function Items({ pathname }: { pathname: string | null }) {
  return (
    <ul className="space-y-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/projects" && pathname === "/projects");
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(navItemClass, active && "bg-sidebar-accent font-medium text-foreground")}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
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

/** Tablet & phone: navigation in a slide-over sheet. Closes when a link is chosen. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label="Navigation öffnen">
          <Menu aria-hidden />
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
