import "server-only";
import { after } from "next/server";
import { setBackgroundRunner } from "@vistoo/backend/push/background";

/**
 * Push delivery runs after the response (Next.js `after`), so sending a
 * message or assigning a task never waits for Apple's servers — also on Vercel.
 * Imported by every entry point that calls services (Server Actions, /api/v1).
 */
setBackgroundRunner((task) => after(task));
