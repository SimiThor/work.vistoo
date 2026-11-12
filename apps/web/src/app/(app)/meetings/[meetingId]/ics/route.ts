import { requireMember } from "@/server/auth";
import { toErrorBody } from "@vistoo/backend/errors";
import { getMeeting } from "@vistoo/backend/services/meetings";
import { buildIcs, icsFileName } from "@vistoo/domain/meetings";
import { uuid } from "@vistoo/domain/validation";

/**
 * "Zum Kalender" → .ics download for Apple Calendar, Outlook & co. Same
 * cookie session and membership check as every Server Action; foreign or
 * unknown meetings answer 404. Never cached (user-specific, changes often).
 */
export async function GET(request: Request, context: RouteContext<"/meetings/[meetingId]/ics">) {
  const { meetingId } = await context.params;
  const text = (status: number, body: string) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!uuid.safeParse(meetingId).success) return text(404, "Meeting nicht gefunden.");
  try {
    const ctx = await requireMember();
    const { meeting, agenda } = await getMeeting(ctx, meetingId);
    const pageUrl = new URL(`/meetings/${meeting.id}`, request.url).toString();
    const ics = buildIcs(meeting, { agendaTitles: agenda.map((i) => i.title), pageUrl });
    const name = icsFileName(meeting.title);
    return new Response(ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const body = toErrorBody(err);
    const status = body.code === "NOT_FOUND" ? 404 : body.code === "UNAUTHENTICATED" ? 401 : body.code === "FORBIDDEN" ? 403 : 500;
    return text(status, body.message);
  }
}
