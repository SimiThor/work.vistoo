"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { openDmAction } from "@/app/actions/chat";
import { MENTION_ALL_LABEL } from "@vistoo/domain/mentions";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";

const base = "rounded-[4px] bg-accent-blue-soft px-0.5 font-medium text-accent-blue-text";

/** `@all` inside a message: reaches everyone in the conversation, so it reads like my own mention. */
export function MentionAll() {
  return (
    <span data-mention="all" className={cn(base, "ring-1 ring-accent-blue/25")}>
      {MENTION_ALL_LABEL}
    </span>
  );
}

/**
 * `@Name` inside a message. For other active members it is a button that
 * opens the direct conversation with that person (created once if needed,
 * same server path as "Direktnachricht"). My own mention and former members
 * stay plain highlighted text.
 */
export function MentionLink({ userId, name, me }: { userId: string; name: string; me: string | null }) {
  const router = useRouter();
  const { members, reload } = useChat();
  const [pending, startTransition] = useTransition();
  const isMe = userId === me;
  const canOpen = !isMe && members.some((m) => m.userId === userId && m.active);

  if (!canOpen) {
    return (
      <span data-mention={userId} className={cn(base, isMe && "ring-1 ring-accent-blue/25")}>
        @{name}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-mention={userId}
      title={`Direktnachricht an ${name}`}
      aria-label={`@${name}, Direktnachricht öffnen`}
      aria-busy={pending || undefined}
      onClick={() =>
        startTransition(async () => {
          const res = await openDmAction({ userId });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          await reload();
          router.push(`/chat/${res.data.id}`);
        })
      }
      className={cn(
        base,
        "cursor-pointer outline-none hover:bg-accent-blue/15 focus-visible:ring-2 focus-visible:ring-ring/50",
        pending && "opacity-70",
      )}
    >
      @{name}
    </button>
  );
}
