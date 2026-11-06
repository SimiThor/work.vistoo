import Foundation

/// A calendar day ("YYYY-MM-DD") without time zone — task start/end dates.
///
/// Mirrors packages/domain/src/dates.ts: all arithmetic happens on integer day
/// numbers (days since 1970-01-01, UTC), so the user's time zone can never
/// shift a date.
public struct CalendarDate: Hashable, Comparable, Sendable, Codable, CustomStringConvertible {
    /// Days since 1970-01-01.
    public let dayNumber: Int

    private static var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    public init(dayNumber: Int) {
        self.dayNumber = dayNumber
    }

    /// Strict parser: rejects impossible dates like 2026-02-30.
    public init?(_ iso: String) {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d)
        else { return nil }
        let comps = DateComponents(year: y, month: m, day: d)
        guard let date = Self.utc.date(from: comps) else { return nil }
        let back = Self.utc.dateComponents([.year, .month, .day], from: date)
        guard back.year == y, back.month == m, back.day == d else { return nil }
        self.dayNumber = Int((date.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    /// The calendar day of `date` in the given (local) calendar.
    public init(_ date: Date, calendar: Calendar = .current) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        let utcDate = Self.utc.date(from: DateComponents(year: c.year, month: c.month, day: c.day))!
        self.dayNumber = Int((utcDate.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    public static func today(calendar: Calendar = .current, now: Date = .now) -> CalendarDate {
        CalendarDate(now, calendar: calendar)
    }

    public var components: (year: Int, month: Int, day: Int) {
        let c = Self.utc.dateComponents([.year, .month, .day], from: utcMidnight)
        return (c.year!, c.month!, c.day!)
    }

    /// Midnight UTC of this day (for formatting with a UTC formatter only).
    public var utcMidnight: Date { Date(timeIntervalSince1970: TimeInterval(dayNumber) * 86_400) }

    /// Noon of this day in the given calendar: safe value for `DatePicker`.
    public func date(in calendar: Calendar = .current) -> Date {
        let (y, m, d) = components
        return calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12)) ?? utcMidnight
    }

    public var iso: String {
        let (y, m, d) = components
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    public var description: String { iso }

    public func adding(days: Int) -> CalendarDate { CalendarDate(dayNumber: dayNumber + days) }

    /// 0 = Monday … 6 = Sunday.
    public var weekdayIndex: Int { ((dayNumber + 3) % 7 + 7) % 7 }
    public var isWeekend: Bool { weekdayIndex >= 5 }
    public var startOfWeek: CalendarDate { adding(days: -weekdayIndex) }

    /// ISO 8601 week number.
    public var isoWeek: Int {
        let thursday = dayNumber - weekdayIndex + 3
        let year = Self.utc.component(.year, from: Date(timeIntervalSince1970: TimeInterval(thursday) * 86_400))
        let jan1 = CalendarDate("\(String(format: "%04d", year))-01-01")!.dayNumber
        return (thursday - jan1) / 7 + 1
    }

    /// Inclusive duration: same start and end = 1 day.
    public static func durationDays(from start: CalendarDate, to end: CalendarDate) -> Int {
        end.dayNumber - start.dayNumber + 1
    }

    public static func < (lhs: CalendarDate, rhs: CalendarDate) -> Bool { lhs.dayNumber < rhs.dayNumber }

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let value = CalendarDate(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid calendar date \(raw)"))
        }
        self = value
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(iso)
    }
}
