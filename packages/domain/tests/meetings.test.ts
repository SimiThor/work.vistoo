import { describe, expect, it } from "vitest";
import {
  addMinutes,
  agendaHandoffText,
  buildIcs,
  formatDuration,
  formatMeetingTimeRange,
  googleCalendarUrl,
  icsFileName,
  instantToWallTime,
  isRunning,
  meetingProvider,
  meetingTimesSchema,
  minutesBetween,
  splitMeetings,
  wallTimeToInstant,
} from "../src/meetings";

const meeting = {
  id: "2b1f0a52-6a43-4b0e-9a37-0b0c9d0e1f20",
  title: "Weekly Sync, Q4; Planung",
  description: "Status der Piloten\nund nächste Schritte",
  startsAt: "2026-11-20T13:00:00.000Z",
  endsAt: "2026-11-20T14:30:00.000Z",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  version: 3,
};

describe("team time zone (Europe/Berlin)", () => {
  it("converts wall times to instants in winter and summer", () => {
    expect(wallTimeToInstant("2026-11-20", "14:00").toISOString()).toBe("2026-11-20T13:00:00.000Z");
    expect(wallTimeToInstant("2026-07-01", "14:00").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(wallTimeToInstant("2026-01-01", "00:00").toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("handles the DST change days", () => {
    // 29 March 2026: 02:00 → 03:00.
    expect(wallTimeToInstant("2026-03-29", "01:30").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(wallTimeToInstant("2026-03-29", "03:30").toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // Skipped time resolves to an existing instant one hour later.
    expect(instantToWallTime(wallTimeToInstant("2026-03-29", "02:30")).time).toBe("03:30");
    // 25 October 2026: 03:00 → 02:00.
    expect(wallTimeToInstant("2026-10-25", "12:00").toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });

  it("round-trips instants to wall times", () => {
    for (const [date, time] of [["2026-11-20", "14:05"], ["2026-06-30", "23:59"], ["2026-02-28", "00:00"]]) {
      expect(instantToWallTime(wallTimeToInstant(date, time))).toEqual({ date, time });
    }
    expect(formatMeetingTimeRange(meeting.startsAt, meeting.endsAt)).toBe("14:00 – 15:30");
  });

  it("validates times: end after start on the same day", () => {
    expect(meetingTimesSchema.safeParse({ date: "2026-11-20", startTime: "09:00", endTime: "09:30" }).success).toBe(true);
    const same = meetingTimesSchema.safeParse({ date: "2026-11-20", startTime: "09:00", endTime: "09:00" });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0].path).toEqual(["endTime"]);
    expect(meetingTimesSchema.safeParse({ date: "2026-11-20", startTime: "9:00", endTime: "10:00" }).success).toBe(false);
    expect(meetingTimesSchema.safeParse({ date: "2026-11-20", startTime: "24:00", endTime: "10:00" }).success).toBe(false);
  });

  it("duration helpers", () => {
    expect(minutesBetween("09:15", "10:45")).toBe(90);
    expect(addMinutes("09:30", 45)).toBe("10:15");
    expect(addMinutes("23:30", 60)).toBe("23:59");
    expect(formatDuration(45)).toBe("45 Min.");
    expect(formatDuration(60)).toBe("1 Std.");
    expect(formatDuration(90)).toBe("1 Std. 30 Min.");
  });
});

describe("overview", () => {
  const now = new Date("2026-11-20T13:30:00Z");
  const at = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });
  it("splits upcoming (soonest first, running included) and past (latest first)", () => {
    const list = [
      at("past-old", "2026-11-01T09:00:00.000Z", "2026-11-01T10:00:00.000Z"),
      at("next-week", "2026-11-27T09:00:00.000Z", "2026-11-27T10:00:00.000Z"),
      at("running", "2026-11-20T13:00:00.000Z", "2026-11-20T14:00:00.000Z"),
      at("past-new", "2026-11-19T09:00:00.000Z", "2026-11-19T10:00:00.000Z"),
    ];
    const { upcoming, past } = splitMeetings(list, now);
    expect(upcoming.map((m) => m.id)).toEqual(["running", "next-week"]);
    expect(past.map((m) => m.id)).toEqual(["past-new", "past-old"]);
    expect(isRunning(list[2], now)).toBe(true);
    expect(isRunning(list[1], now)).toBe(false);
  });
});

describe("meeting links", () => {
  it("recognizes the common providers", () => {
    expect(meetingProvider("https://discord.com/channels/1/2")).toBe("discord");
    expect(meetingProvider("https://discord.gg/abc")).toBe("discord");
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("meet");
    expect(meetingProvider("https://teams.microsoft.com/l/meetup-join/x")).toBe("teams");
    expect(meetingProvider("https://us02web.zoom.us/j/123")).toBe("zoom");
    expect(meetingProvider("https://example.com/room")).toBe("web");
    expect(meetingProvider("not a url")).toBe("web");
  });
});

describe("calendar export", () => {
  const ics = buildIcs(meeting, {
    agendaTitles: ["Pilot Festung Hohensalzburg", "Pricing-Modell"],
    pageUrl: "https://work.vistoo.de/meetings/x",
    now: new Date("2026-11-12T08:00:00Z"),
  });
  const unfolded = ics.replace(/\r\n /g, "");

  it("is a valid single-event iCalendar file with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
    expect(unfolded).toContain("UID:meeting-2b1f0a52-6a43-4b0e-9a37-0b0c9d0e1f20@work.vistoo\r\n");
    expect(unfolded).toContain("DTSTART:20261120T130000Z\r\n");
    expect(unfolded).toContain("DTEND:20261120T143000Z\r\n");
    expect(unfolded).toContain("DTSTAMP:20261112T080000Z\r\n");
    expect(unfolded).toContain("SEQUENCE:2\r\n");
  });

  it("escapes text and includes link, description and agenda", () => {
    expect(unfolded).toContain("SUMMARY:Weekly Sync\\, Q4\\; Planung\r\n");
    expect(unfolded).toContain("LOCATION:https://meet.google.com/abc-defg-hij\r\n");
    expect(unfolded).toContain("URL:https://meet.google.com/abc-defg-hij\r\n");
    expect(unfolded).toMatch(/DESCRIPTION:Meeting beitreten: https:\/\/meet\.google\.com\/abc-defg-hij\\n\\nStatus der Piloten\\nund nächste Schritte\\n\\nAgenda:\\n1\. Pilot Festung Hohensalzburg\\n2\. Pricing-Modell/);
  });

  it("folds long lines on character boundaries (multi-byte safe)", () => {
    const long = buildIcs({ ...meeting, title: "Ü".repeat(100), meetingUrl: null, description: "" });
    expect(long.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(long.replace(/\r\n /g, "")).toContain(`SUMMARY:${"Ü".repeat(100)}\r\n`);
    expect(long).not.toContain("LOCATION");
  });

  it("builds a prefilled Google Calendar link", () => {
    const url = new URL(googleCalendarUrl(meeting));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(meeting.title);
    expect(url.searchParams.get("dates")).toBe("20261120T130000Z/20261120T143000Z");
    expect(url.searchParams.get("location")).toBe(meeting.meetingUrl);
    expect(url.searchParams.get("details")).toContain("Status der Piloten");
  });

  it("file names are safe", () => {
    expect(icsFileName("Weekly Sync: Q4 – Planung")).toBe("weekly-sync-q4-planung.ics");
    expect(icsFileName("Größenänderung")).toBe("grossenanderung.ics");
    expect(icsFileName("???")).toBe("meeting.ics");
  });
});

describe("hand-off to issues and decisions", () => {
  it("combines description, outcome and the meeting reference", () => {
    const text = agendaHandoffText(
      { description: "Nächste Schritte", outcome: "Start mit drei Paketen" },
      { title: "Weekly Sync", startsAt: "2026-11-20T13:00:00.000Z" },
    );
    expect(text).toContain("Nächste Schritte\n\n**Ergebnis aus dem Meeting:**\n\nStart mit drei Paketen");
    expect(text).toContain("_Aus dem Meeting „Weekly Sync“ am Freitag, 20. November 2026._");
    expect(agendaHandoffText({ description: "", outcome: "" }, { title: "X", startsAt: meeting.startsAt })).toMatch(/^_Aus dem Meeting/);
  });
});
