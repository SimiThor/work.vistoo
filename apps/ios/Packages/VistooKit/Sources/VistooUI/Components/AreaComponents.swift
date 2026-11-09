import SwiftUI
import VistooCore

// Building blocks shared by to-dos, milestones, ideas, decisions and CRM.

/// Destinations of the "Mehr" stack (also reachable from "Für mich").
enum AreaRoute: Hashable {
    case todos
    case milestones
    case milestone(String)
    case ideas
    case idea(String)
    case decisions
    case decision(String)
    case crm
    case attraction(String)
}

extension View {
    /// Registers every area screen for `NavigationLink(value: AreaRoute…)`.
    func areaDestinations(session: SessionModel) -> some View {
        navigationDestination(for: AreaRoute.self) { route in
            switch route {
            case .todos: TodosScreen(session: session)
            case .milestones: MilestonesScreen(session: session)
            case .milestone(let id): MilestoneDetailScreen(session: session, milestoneId: id)
            case .ideas: IdeasScreen(session: session)
            case .idea(let id): IdeaDetailScreen(session: session, ideaId: id)
            case .decisions: DecisionsScreen(session: session)
            case .decision(let id): DecisionDetailScreen(session: session, decisionId: id)
            case .crm: CRMScreen(session: session)
            case .attraction(let id): AttractionDetailScreen(session: session, attractionId: id)
            }
        }
    }
}

/// Small coloured dot for statuses (text stays neutral, as on the web).
struct StatusDot: View {
    let hex: UInt32
    @ScaledMetric private var size: CGFloat = 8
    var body: some View {
        Circle().fill(Color(hex: hex)).frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// Label with the status dot in front.
struct DotLabel: View {
    let text: String
    let hex: UInt32
    var body: some View {
        Label { Text(text) } icon: { StatusDot(hex: hex) }
    }
}

/// "Verantwortlich" picker over the active members (former ones stay visible if selected).
struct PersonPicker: View {
    let title: String
    let work: WorkStore
    @Binding var selection: String?
    var viewerId: String?

    var body: some View {
        Picker(title, selection: $selection) {
            Text("Niemand").tag(String?.none)
            ForEach(work.members) { m in
                Text(m.userId == viewerId ? "\(m.displayName) (ich)" : m.displayName).tag(String?.some(m.userId))
            }
            if let id = selection, !work.members.contains(where: { $0.userId == id }) {
                Text(work.person(id)?.displayName ?? "Ehemaliges Mitglied").tag(String?.some(id))
            }
        }
    }
}

/// Toggle + compact date picker for an optional calendar day.
struct OptionalDateRow: View {
    let title: String
    @Binding var date: CalendarDate?

    var body: some View {
        Toggle(title, isOn: Binding(
            get: { date != nil },
            set: { date = $0 ? (date ?? .today()) : nil }
        ))
        if let value = date {
            DatePicker(
                title,
                selection: Binding(get: { value.date() }, set: { date = CalendarDate($0) }),
                displayedComponents: .date
            )
            .datePickerStyle(.compact)
            .environment(\.locale, Formatting.locale)
            .labelsHidden()
        }
    }
}

/// Due date in a row: red and with a warning glyph when overdue.
struct DueDateLabel: View {
    let date: CalendarDate
    var overdueCheck = true

    var body: some View {
        let overdue = overdueCheck && date < .today()
        Label(Formatting.short(date), systemImage: overdue ? "exclamationmark.circle" : "calendar")
            .labelStyle(.titleAndIcon)
            .foregroundStyle(overdue ? Tokens.Palette.destructive : Tokens.Palette.mutedForeground)
            .fontWeight(overdue ? .medium : .regular)
            .accessibilityLabel(overdue ? "Überfällig seit \(Formatting.short(date))" : "Fällig \(Formatting.short(date))")
    }
}

/// Error line under a form field (server `fieldErrors` or local pre-check).
struct FieldError: View {
    let message: String?
    var body: some View {
        if let message {
            Text(message).font(.footnote).foregroundStyle(Tokens.Palette.destructive)
        }
    }
}

/// Section with the error of the last failed save.
struct FailureSection: View {
    let error: APIError?
    var body: some View {
        if let error {
            Section {
                Label(error.message, systemImage: error.isConnectivityProblem ? "wifi.slash" : "exclamationmark.triangle")
                    .foregroundStyle(Tokens.Palette.destructive)
            }
        }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    /// Empty → nil (optional text fields of the API).
    var nilIfBlank: String? { trimmed.isEmpty ? nil : trimmed }
}

/// Generic "loaded / loading / failed" wrapper for area lists.
struct AreaContent<Content: View>: View {
    let state: LoadState
    let isEmpty: Bool
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        if isEmpty, state == .loading || state == .idle {
            LoadingView()
        } else if case .failed(let message) = state, isEmpty {
            FailureView(message: message, retry: retry)
        } else {
            content()
        }
    }
}
