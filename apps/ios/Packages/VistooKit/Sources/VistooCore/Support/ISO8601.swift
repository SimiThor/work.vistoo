import Foundation

/// Lenient ISO 8601 instant parser.
///
/// The API sends `2026-11-06T07:43:29.456Z`; Supabase Realtime sends Postgres
/// output such as `2026-11-06T07:43:29.456789+00:00` or with a space separator.
/// Both must decode to the same instant.
public enum ISO8601 {
    public static func parse(_ raw: String) -> Date? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        let scalars = Array(s.utf8)
        func int(_ from: Int, _ len: Int) -> Int? {
            guard from + len <= scalars.count else { return nil }
            var v = 0
            for b in scalars[from..<(from + len)] {
                guard b >= 48, b <= 57 else { return nil }
                v = v * 10 + Int(b - 48)
            }
            return v
        }
        guard scalars.count >= 19,
              let y = int(0, 4), scalars[4] == 45, let mo = int(5, 2), scalars[7] == 45, let d = int(8, 2),
              scalars[10] == 84 || scalars[10] == 32 || scalars[10] == 116,
              let h = int(11, 2), scalars[13] == 58, let mi = int(14, 2), scalars[16] == 58, let sec = int(17, 2)
        else { return nil }

        var i = 19
        var fraction = 0.0
        if i < scalars.count, scalars[i] == 46 {
            i += 1
            var scale = 0.1
            while i < scalars.count, scalars[i] >= 48, scalars[i] <= 57 {
                fraction += Double(scalars[i] - 48) * scale
                scale /= 10
                i += 1
            }
        }
        var offsetSeconds = 0
        if i < scalars.count {
            switch scalars[i] {
            case 90, 122: // Z
                offsetSeconds = 0
            case 43, 45: // + / -
                let sign = scalars[i] == 43 ? 1 : -1
                guard let oh = int(i + 1, 2) else { return nil }
                var om = 0
                if i + 3 < scalars.count {
                    let start = scalars[i + 3] == 58 ? i + 4 : i + 3
                    om = int(start, 2) ?? 0
                }
                offsetSeconds = sign * (oh * 3600 + om * 60)
            default:
                return nil
            }
        }

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let base = cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi, second: sec)) else {
            return nil
        }
        return base.addingTimeInterval(fraction - TimeInterval(offsetSeconds))
    }

    /// API format (UTC, milliseconds).
    public static func format(_ date: Date) -> String {
        date.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .omitted))
    }

    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let raw = try c.decode(String.self)
            guard let date = parse(raw) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid ISO 8601 instant: \(raw)")
            }
            return date
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(format(date))
        }
        return e
    }
}
