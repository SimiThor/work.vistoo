import SwiftUI
import VistooCore

// MARK: - Status

extension TaskStatus {
    /// Icon colour (text stays neutral; shape + label carry the meaning).
    var tint: Color {
        switch self {
        case .open: Tokens.Palette.statusOpen
        case .inProgress: Tokens.Palette.statusProgress
        case .inReview: Tokens.Palette.statusReview
        case .done: Tokens.Palette.statusDone
        case .unknown: Tokens.Palette.mutedForeground
        }
    }

    /// Next status for the "advance" swipe action.
    var next: TaskStatus? {
        switch self {
        case .open: .inProgress
        case .inProgress: .inReview
        case .inReview: .done
        case .done, .unknown: nil
        }
    }
}

/// Status glyph distinguishable by shape (empty, half, three-quarter, check) — same as the web.
struct StatusIcon: View {
    let status: TaskStatus
    var size: CGFloat = 16
    @ScaledMetric private var scale: CGFloat = 1

    var body: some View {
        let s = size * scale
        ZStack {
            Circle().stroke(status.tint, lineWidth: s * 0.1)
            switch status {
            case .inProgress:
                HalfCircle(fraction: 0.5).fill(status.tint).padding(s * 0.2)
            case .inReview:
                HalfCircle(fraction: 0.75).fill(status.tint).padding(s * 0.2)
            case .done:
                Circle().fill(status.tint)
                Image(systemName: "checkmark")
                    .font(.system(size: s * 0.55, weight: .bold))
                    .foregroundStyle(.white)
            default:
                EmptyView()
            }
        }
        .frame(width: s, height: s)
        .accessibilityHidden(true)
    }
}

private struct HalfCircle: Shape {
    let fraction: Double
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        p.move(to: c)
        p.addArc(center: c, radius: rect.width / 2, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * fraction), clockwise: false)
        p.closeSubpath()
        return p
    }
}

struct StatusLabel: View {
    let status: TaskStatus
    var body: some View {
        Label {
            Text(status.label)
        } icon: {
            StatusIcon(status: status)
        }
    }
}

// MARK: - Projects & people

struct ProjectDot: View {
    let colorKey: String
    @ScaledMetric private var size: CGFloat = 8
    var body: some View {
        Circle()
            .fill(Color(hex: ProjectColorDefinition.forKey(colorKey).hex))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Display name rules of the web (`displayName`, `initials`).
enum PersonName {
    static func display(fullName: String?, email: String) -> String {
        if let n = fullName?.trimmingCharacters(in: .whitespaces), !n.isEmpty { return n }
        return String(email.split(separator: "@").first ?? Substring(email))
    }

    static func initials(fullName: String?, email: String) -> String {
        let name = display(fullName: fullName, email: email)
        let parts = name.split(whereSeparator: { " ._-".contains($0) })
        let letters = parts.count >= 2 ? String(parts[0].prefix(1) + parts[1].prefix(1)) : String(name.prefix(2))
        return letters.uppercased()
    }
}

extension Member {
    var displayName: String { PersonName.display(fullName: fullName, email: email) }
}

extension ChatPerson {
    var displayName: String { PersonName.display(fullName: fullName, email: email) }
}

extension Viewer {
    var displayName: String { PersonName.display(fullName: fullName, email: email) }
}

struct Avatar: View {
    let fullName: String?
    let email: String?
    var size: CGFloat = 28
    @ScaledMetric private var scale: CGFloat = 1

    var body: some View {
        let s = size * scale
        ZStack {
            Circle().fill(Tokens.Palette.surfaceSunken)
            if let email {
                Text(PersonName.initials(fullName: fullName, email: email))
                    .font(.system(size: s * 0.38, weight: .semibold))
                    .foregroundStyle(Tokens.Palette.foreground)
            } else {
                Image(systemName: "person")
                    .font(.system(size: s * 0.45))
                    .foregroundStyle(Tokens.Palette.mutedForeground)
            }
        }
        .frame(width: s, height: s)
        .accessibilityHidden(true)
    }
}

// MARK: - States

struct LoadingView: View {
    var label = "Wird geladen …"
    var body: some View {
        ProgressView(label)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FailureView: View {
    let message: String
    let retry: () async -> Void
    var body: some View {
        ContentUnavailableView {
            Label("Nicht geladen", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Erneut versuchen") { Task { await retry() } }
                .buttonStyle(.borderedProminent)
        }
    }
}

/// Persistent hint while offline: nothing is pretended to be saved.
struct OfflineBanner: View {
    var body: some View {
        Label("Offline – Änderungen werden erst mit Verbindung gespeichert.", systemImage: "wifi.slash")
            .font(.footnote.weight(.medium))
            .foregroundStyle(Tokens.Palette.warningFg)
            .padding(.horizontal, Tokens.Spacing.lg)
            .padding(.vertical, Tokens.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(Tokens.Palette.warningBg)
            .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Errors

/// Alert payload for failed actions.
struct ActionFailure: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let message: String

    init(_ title: String = "Aktion fehlgeschlagen", _ error: APIError) {
        self.title = title
        self.message = error.message
    }

    /// Errors from `Task { … }` blocks arrive untyped.
    init(_ title: String = "Aktion fehlgeschlagen", _ error: any Error) {
        self.title = title
        self.message = (error as? APIError)?.message ?? "Etwas ist schiefgelaufen. Bitte versuche es erneut."
    }

    init(_ title: String, message: String) {
        self.title = title
        self.message = message
    }
}

extension View {
    func failureAlert(_ failure: Binding<ActionFailure?>) -> some View {
        alert(failure.wrappedValue?.title ?? "", isPresented: Binding(
            get: { failure.wrappedValue != nil },
            set: { if !$0 { failure.wrappedValue = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure.wrappedValue?.message ?? "")
        }
    }

    /// Card surface of the web (white, hairline border, subtle shadow).
    func cardSurface() -> some View {
        background(
            RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous)
                .fill(Tokens.Palette.background)
                .shadow(color: .black.opacity(Tokens.Shadow.card.opacity), radius: Tokens.Shadow.card.radius, y: Tokens.Shadow.card.y)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous)
                .strokeBorder(Tokens.Palette.border, lineWidth: 1)
        )
    }
}

// MARK: - Formatting

enum Formatting {
    static let locale = Locale(identifier: "de_DE")
    static let utc = TimeZone(identifier: "UTC")!

    /// "5. Nov." (adds the year if it differs) — like the web's formatShortDate.
    static func short(_ date: CalendarDate, today: CalendarDate = .today()) -> String {
        let style = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, timeZone: utc)
            .day().month(.abbreviated)
        let withYear = date.components.year != today.components.year
        return (withYear ? style.year() : style).format(date.utcMidnight)
    }

    static func long(_ date: CalendarDate) -> String {
        Date.FormatStyle(date: .complete, time: .omitted, locale: locale, timeZone: utc).format(date.utcMidnight)
    }

    static func range(_ start: CalendarDate?, _ end: CalendarDate?) -> String {
        switch (start, end) {
        case let (s?, e?): s == e ? short(s) : "\(short(s)) – \(short(e))"
        case let (nil, e?): "bis \(short(e))"
        case let (s?, nil): "ab \(short(s))"
        default: "Kein Zeitraum"
        }
    }

    static func time(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale))
    }

    static func dayHeading(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Heute" }
        if cal.isDateInYesterday(date) { return "Gestern" }
        return date.formatted(Date.FormatStyle(date: .long, time: .omitted).locale(locale))
    }

    static func instant(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale))
    }
}
