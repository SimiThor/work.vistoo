import "server-only";

/**
 * Work that must not delay the response (push delivery). The web app plugs in
 * Next.js `after()` (apps/web/src/server/background.ts), so the work still runs
 * on Vercel after the response is sent. Tests collect and await the tasks.
 */
export type BackgroundRunner = (task: () => Promise<void>) => void;

const fallback: BackgroundRunner = (task) => {
  void task().catch((err) => console.error("[background]", err instanceof Error ? err.message : String(err)));
};

let runner: BackgroundRunner = fallback;

export function setBackgroundRunner(next: BackgroundRunner | null) {
  runner = next ?? fallback;
}

export function runInBackground(task: () => Promise<void>) {
  runner(async () => {
    try {
      await task();
    } catch (err) {
      console.error("[background]", err instanceof Error ? err.message : String(err));
    }
  });
}
