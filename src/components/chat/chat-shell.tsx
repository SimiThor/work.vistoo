"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";
import { ConversationList } from "./conversation-list";

/**
 * Two panes on md+ (list | conversation). On phones either the list or the
 * open conversation fills the screen; the URL decides which.
 */
export function ChatShell({ children }: { children: ReactNode }) {
  const activeId = useSelectedLayoutSegment();
  const { reload } = useChat();
  // Entering the chat: pick up membership/name changes made elsewhere.
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside
        aria-label="Unterhaltungen"
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-r bg-background md:flex md:w-72 lg:w-80",
          activeId ? "hidden" : "flex",
        )}
      >
        <ConversationList activeId={activeId} />
      </aside>
      <section className={cn("min-h-0 min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {children}
      </section>
    </div>
  );
}
