import { NextResponse, type NextRequest } from "next/server";
import { cleanupChatFiles } from "@vistoo/backend/services/chat-files";

/**
 * Daily housekeeping for chat files (Vercel Cron, see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the
 * route is disabled. Cleanup also runs opportunistically before uploads.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const result = await cleanupChatFiles({ limit: 500 });
  return NextResponse.json(result);
}
