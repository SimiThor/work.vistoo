import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-surface-subtle px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark className="text-lg" />
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-card">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Zugang nur mit Einladung. Wende dich an einen Admin deines Teams.
        </p>
      </div>
    </main>
  );
}
