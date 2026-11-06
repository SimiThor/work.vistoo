import { describe, expect, it } from "vitest";
import {
  durationDays,
  fromDayNumber,
  isIsoDate,
  isoWeek,
  isWeekend,
  toDayNumber,
  todayIso,
  weekdayIndex,
} from "../src/dates";

describe("calendar dates", () => {
  it("validates real calendar days only", () => {
    expect(isIsoDate("2026-11-05")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-11-5")).toBe(false);
  });

  it("round-trips through day numbers across DST changes", () => {
    for (const d of ["2026-03-29", "2026-03-30", "2026-10-25", "2026-10-26", "2026-12-31"]) {
      expect(fromDayNumber(toDayNumber(d))).toBe(d);
    }
    expect(toDayNumber("2026-03-30") - toDayNumber("2026-03-29")).toBe(1);
  });

  it("counts inclusive durations (same day = 1 day)", () => {
    expect(durationDays("2026-11-05", "2026-11-05")).toBe(1);
    expect(durationDays("2026-11-05", "2026-11-11")).toBe(7);
  });

  it("knows weekdays, weekends and ISO weeks", () => {
    expect(weekdayIndex(toDayNumber("2026-11-02"))).toBe(0); // Monday
    expect(isWeekend(toDayNumber("2026-11-07"))).toBe(true);
    expect(isWeekend(toDayNumber("2026-11-06"))).toBe(false);
    expect(isoWeek(toDayNumber("2026-11-05"))).toBe(45);
    expect(isoWeek(toDayNumber("2027-01-01"))).toBe(53);
  });

  it("uses the local calendar day for today", () => {
    expect(todayIso(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
    expect(todayIso(new Date(2026, 10, 6, 0, 1))).toBe("2026-11-06");
  });
});
