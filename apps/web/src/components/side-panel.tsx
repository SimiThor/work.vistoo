"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * Detail panel on the right (full screen on phones), same look as the task
 * panel. Asks before discarding unsaved changes (`dirty`).
 */
export function SidePanel({
  title,
  description,
  dirty = false,
  onClose,
  headerActions,
  footer,
  children,
}: {
  title: string;
  description: string;
  dirty?: boolean;
  onClose: () => void;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  const titleId = useId();
  const requestClose = () => (dirty ? setConfirm(true) : onClose());
  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-labelledby={titleId}
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
        }}
        onEscapeKeyDown={(e) => {
          // Escape inside an inline editor only cancels that editor.
          if ((e.target as Element | null)?.closest?.("[data-local-escape]")) e.preventDefault();
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-4 sm:pl-6">
            <SheetTitle id={titleId} className="text-[13px] font-medium text-muted-foreground">
              {title}
            </SheetTitle>
            <SheetDescription className="sr-only">{description}</SheetDescription>
            <div className="flex items-center gap-0.5">
              {headerActions}
              <Button variant="ghost" size="icon" onClick={requestClose} aria-label="Schließen">
                <X aria-hidden />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">{footer}</div>
          )}
        </div>
      </SheetContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>Deine Änderungen gehen verloren.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onClose}>
              Verwerfen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/** Label/value row like in the task panel. */
export function PanelField({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-x-3 sm:grid-cols-[128px_1fr]">
      <label htmlFor={htmlFor} className="pt-2 text-[13px] text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
