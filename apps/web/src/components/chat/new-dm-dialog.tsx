"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openDmAction } from "@/app/actions/chat";
import { FormAlert } from "@/components/form-feedback";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useChat } from "./chat-context";
import { MemberPicker } from "./member-picker";

/** Pick a member: opens the existing DM or creates it (exactly once, server-enforced). */
export function NewDmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { members, me, reload } = useChat();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const others = members.filter((m) => m.userId !== me?.userId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>Direktnachricht</DialogTitle>
          <DialogDescription>
            Persönliche Unterhaltung zu zweit. Für Gruppen nutzt du einen geschlossenen Kanal.
          </DialogDescription>
        </DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">Es gibt noch keine weiteren Mitglieder.</p>
        ) : (
          <MemberPicker
            label="Person auswählen"
            members={others}
            selected={[]}
            multiple={false}
            onToggle={(userId) =>
              startTransition(async () => {
                const res = await openDmAction({ userId });
                if (!res.ok) return setError(res.error.message);
                await reload();
                onOpenChange(false);
                router.push(`/chat/${res.data.id}`);
              })
            }
          />
        )}
        <FormAlert message={error} />
      </DialogContent>
    </Dialog>
  );
}
