import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signOutAction } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABEL } from "@/lib/domain";
import { getAuthUser } from "@/server/auth";
import { getInvitationState } from "@/server/services/invitations";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Einladung" };

export default function InvitePage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-surface-subtle px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark className="text-lg" />
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-card">
          <Suspense fallback={<InviteSkeleton />}>
            <InviteContent />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

function InviteSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Wird geladen">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function SignOut() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" className="w-full text-muted-foreground">
        Abmelden
      </Button>
    </form>
  );
}

async function InviteContent() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const state = await getInvitationState(user);
  if (state.kind === "member") redirect("/tasks");

  if (state.kind === "invited") {
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Willkommen bei {state.invitation.workspaceName}</h1>
          <p className="text-sm text-muted-foreground">
            Du wurdest als {ROLE_LABEL[state.invitation.role]} eingeladen ({user.email}).
          </p>
        </div>
        <AcceptInvitationForm invitationId={state.invitation.id} defaultName={state.fullName ?? ""} />
        <SignOut />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">
          {state.kind === "expired" ? "Einladung abgelaufen" : "Kein Zugang"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {state.kind === "expired"
            ? "Deine Einladung ist abgelaufen. Bitte einen Admin, sie erneut zu senden."
            : `Für ${user.email || "dieses Konto"} gibt es keinen Zugang zu Vistoo. Bitte einen Admin um eine Einladung.`}
        </p>
      </div>
      <SignOut />
    </div>
  );
}
