"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ArrowLeft, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { requestLoginAction, verifyLoginCodeAction } from "@/app/actions/auth";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPublicSupabaseEnv } from "@/lib/env";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "link" ? "Der Link ist ungültig oder abgelaufen. Fordere einfach einen neuen an." : null,
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emailId = useId();
  const codeId = useId();

  // Fallback for Supabase's default e-mail templates (implicit flow: tokens in the URL fragment).
  useEffect(() => {
    if (!window.location.hash.includes("access_token=")) return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) return;
    const { url, key } = getPublicSupabaseEnv();
    const supabase = createBrowserClient(url, key);
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error: e }) => {
      window.history.replaceState(null, "", window.location.pathname);
      if (e) setError("Der Link ist ungültig oder abgelaufen. Fordere einfach einen neuen an.");
      else router.replace("/tasks");
    });
  }, [router]);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = await requestLoginAction({ email });
      if (!res.ok) {
        setFieldError(res.error.fieldErrors?.email ?? null);
        if (!res.error.fieldErrors?.email) setError(res.error.message);
        return;
      }
      setEmail(res.data.email);
      setStep("code");
    });
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = await verifyLoginCodeAction({ email, code });
      // On success the action redirects.
      if (res && !res.ok) setFieldError(res.error.fieldErrors?.code ?? res.error.message);
    });
  }

  if (step === "code") {
    return (
      <form onSubmit={submitCode} noValidate className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Prüfe dein Postfach</h1>
          <p className="text-sm text-muted-foreground" role="status">
            Falls <span className="font-medium text-foreground">{email}</span> Zugang hat, haben wir dir einen
            Anmeldelink und einen Code geschickt.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={codeId}>Code aus der E-Mail</Label>
          <Input
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? `${codeId}-error` : undefined}
            className="h-10 tracking-[0.3em]"
            autoFocus
          />
          <FieldError id={`${codeId}-error`} message={fieldError} />
        </div>
        <FormAlert message={error} />
        <Button type="submit" className="h-10 w-full" disabled={pending || code.trim().length < 6}>
          {pending ? "Wird geprüft …" : "Anmelden"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => {
            setStep("email");
            setCode("");
            setFieldError(null);
          }}
        >
          <ArrowLeft aria-hidden /> Andere E-Mail-Adresse
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitEmail} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">Anmelden</h1>
        <p className="text-sm text-muted-foreground">Wir schicken dir einen Anmeldelink per E-Mail.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={emailId}>E-Mail-Adresse</Label>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${emailId}-error` : undefined}
          className="h-10"
          required
          autoFocus
        />
        <FieldError id={`${emailId}-error`} message={fieldError} />
      </div>
      <FormAlert message={error} />
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        <Mail aria-hidden />
        {pending ? "Wird gesendet …" : "Anmeldelink senden"}
      </Button>
    </form>
  );
}
