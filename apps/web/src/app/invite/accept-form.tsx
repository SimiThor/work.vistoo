"use client";

import { useId, useState, useTransition } from "react";
import { acceptInvitationAction } from "@/app/actions/auth";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AcceptInvitationForm({ invitationId, defaultName }: { invitationId: string; defaultName: string }) {
  const [fullName, setFullName] = useState(defaultName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldError(null);
        startTransition(async () => {
          const res = await acceptInvitationAction({ invitationId, fullName });
          if (res && !res.ok) {
            if (res.error.fieldErrors?.fullName) setFieldError(res.error.fieldErrors.fullName);
            else setError(res.error.message);
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id}>Dein Name</Label>
        <Input
          id={id}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${id}-error` : undefined}
          className="h-10"
          autoFocus
        />
        <FieldError id={`${id}-error`} message={fieldError} />
      </div>
      <FormAlert message={error} />
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Wird beigetreten …" : "Einladung annehmen"}
      </Button>
    </form>
  );
}
