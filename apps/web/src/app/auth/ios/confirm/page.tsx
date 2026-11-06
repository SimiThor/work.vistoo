import type { Metadata } from "next";
import { BrandMark } from "@/components/brand";

export const metadata: Metadata = { title: "Anmeldung in der App" };

/**
 * Target of login links requested from the iOS app. With Universal Links
 * configured, iOS opens the app directly and this page is never shown.
 * Otherwise (app not installed, link opened on another device) the one-time
 * code from the same e-mail is the way in. The token is deliberately not
 * forwarded through a custom URL scheme: other apps could intercept it.
 */
export default function IosConfirmPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-surface-subtle px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark className="text-lg" />
        </div>
        <div className="space-y-3 rounded-xl border bg-background p-6 shadow-card">
          <h1 className="text-lg font-semibold">Anmeldung in der Vistoo-App</h1>
          <p className="text-sm text-muted-foreground">
            Dieser Link ist für die Vistoo-App auf dem iPhone gedacht. Öffne ihn dort, oder gib in der App den
            6-stelligen Code aus derselben E-Mail ein.
          </p>
          <p className="text-sm text-muted-foreground">
            Du möchtest dich im Browser anmelden?{" "}
            <a href="/login" className="font-medium text-accent-blue-text underline-offset-2 hover:underline">
              Zur Anmeldung
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
