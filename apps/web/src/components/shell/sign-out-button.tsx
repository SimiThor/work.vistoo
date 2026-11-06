"use client";

import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { clearChatDrafts } from "@/components/chat/chat-context";
import { Button } from "@/components/ui/button";

/** Signs out and discards chat drafts of this browser session. */
export function SignOutButton() {
  return (
    <form action={signOutAction} onSubmit={clearChatDrafts}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Abmelden" title="Abmelden">
        <LogOut aria-hidden />
      </Button>
    </form>
  );
}
