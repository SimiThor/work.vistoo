import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import { ConversationSkeleton } from "@/components/chat/conversation-view";

export const metadata: Metadata = { title: "Chat" };

export default function ChatLayout({ children }: LayoutProps<"/chat">) {
  return (
    <Suspense fallback={<ConversationSkeleton />}>
      <ChatShell>{children}</ChatShell>
    </Suspense>
  );
}
