import SwiftUI
import VistooCore

/// Start tab: what needs me now. Unread conversations first, then my open tasks
/// grouped by urgency (overdue, today, next 7 days, later, without date).
/// Everything else (whole team, projects, settings) is one tap away but not here.
struct HomeScreen: View {
    let session: SessionModel
    @Environment(Navigator.self) private var navigator
    @AppStorage("vistoo.work.lastProject") private var lastProjectId = ""
    @State private var draft: WorkStore.TaskDraft?
    @State private var openTask: String?
    @State private var confirmDelete: TaskItem?
    @State private var failure: ActionFailure?
    @State private var feedback = 0

    private var work: WorkStore { session.work }

    private var unread: [ConversationSummary] {
        session.chat.conversations
            .filter { $0.unread && !$0.archived }
            .sorted { ($0.lastMessageAt ?? .distantPast) > ($1.lastMessageAt ?? .distantPast) }
    }

    private var myOpenTasks: [TaskItem] {
        work.tasks(in: .all).filter { $0.assigneeId == session.userId && $0.status != .done }
    }

    private var buckets: [HomeBucket] { HomeBucket.group(myOpenTasks) }

    var body: some View {
        content
            .navigationTitle("Für mich")
            .toolbar {
                ToolbarItem(placement: .leading) { AccountButton(session: session) }
                ToolbarItem(placement: .trailing) {
                    Button { newTask() } label: { Label("Neue Aufgabe", systemImage: "plus") }
                        .disabled(work.activeProjects.isEmpty)
                }
            }
            .refreshable {
                async let w: Void = work.reload()
                async let c: Void = session.chat.reload()
                _ = await (w, c)
            }
            .sheet(item: $draft) { TaskCreateView(session: session, draft: $0) }
            .sheet(item: Binding(get: { openTask.map(OpenID.init) }, set: { openTask = $0?.id })) { open in
                NavigationStack { TaskDetailView(session: session, taskId: open.id) }
            }
            .taskDeleteConfirmation($confirmDelete) { task in
                run("Löschen fehlgeschlagen") { try await work.deleteTask(task) }
            }
            .failureAlert($failure)
            .sensoryFeedback(.success, trigger: feedback)
    }

    @ViewBuilder private var content: some View {
        if work.state == .loading, work.tasksById.isEmpty {
            LoadingView()
        } else if case .failed(let message) = work.state, work.tasksById.isEmpty {
            FailureView(message: message) { await work.reload() }
        } else {
            list
        }
    }

    private var list: some View {
        List {
            if !unread.isEmpty { unreadSection }
            ForEach(buckets) { bucket in
                Section {
                    ForEach(bucket.tasks) { row($0) }
                } header: {
                    HStack {
                        Text(bucket.kind.title)
                        Spacer()
                        Text("\(bucket.tasks.count)").monospacedDigit()
                    }
                    .foregroundStyle(bucket.kind == .overdue ? Tokens.Palette.destructive : Tokens.Palette.mutedForeground)
                    .accessibilityElement(children: .combine)
                }
            }
            if myOpenTasks.isEmpty { emptyState }
        }
        .groupedListStyle()
        .animation(.default, value: myOpenTasks.map(\.id))
    }

    private var unreadSection: some View {
        Section {
            ForEach(unread.prefix(5)) { c in
                Button { navigator.openConversation(c.id) } label: { ConversationRowLabel(conversation: c) }
                    .buttonStyle(.plain)
            }
            if unread.count > 5 {
                Button("Alle \(unread.count) ungelesenen anzeigen") { navigator.tab = .chat }
            }
        } header: {
            Text("Ungelesen")
        }
    }

    private var emptyState: some View {
        Section {
            ContentUnavailableView {
                Label(work.activeProjects.isEmpty ? "Noch keine Projekte" : "Nichts offen für dich", systemImage: "checkmark.circle")
            } description: {
                Text(work.activeProjects.isEmpty
                     ? "Aufgaben gehören immer zu einem Projekt. Lege zuerst ein Projekt an."
                     : "Dir ist gerade keine offene Aufgabe zugewiesen.")
            } actions: {
                if work.activeProjects.isEmpty {
                    Button("Zu den Projekten") { navigator.tab = .projects }
                        .buttonStyle(.borderedProminent)
                } else {
                    Button("Aufgaben des Teams ansehen") { navigator.tab = .tasks }
                    Button("Neue Aufgabe für mich") { newTask() }
                }
            }
            .listRowBackground(Color.clear)
        }
    }

    private func row(_ task: TaskItem) -> some View {
        Button { openTask = task.id } label: {
            TaskRowView(work: work, task: task, showProject: true, showAssignee: false)
        }
        .buttonStyle(.plain)
        .taskActions(session: session, task: task, onOpen: { openTask = task.id }, onDelete: { confirmDelete = task }, perform: run)
    }

    private func newTask() {
        let last = work.project(lastProjectId).flatMap { $0.archived ? nil : $0.id }
        guard let projectId = last ?? work.activeProjects.first?.id else { return }
        draft = WorkStore.TaskDraft(projectId: projectId, status: .open, assigneeId: session.userId)
    }

    private func run(_ title: String, _ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                feedback += 1
            } catch {
                failure = ActionFailure(title, error)
            }
        }
    }

    private struct OpenID: Identifiable { let id: String }
}

/// One group of the start tab.
struct HomeBucket: Identifiable {
    enum Kind: Int, CaseIterable {
        case overdue, today, soon, later, undated
        var title: String {
            switch self {
            case .overdue: "Überfällig"
            case .today: "Heute"
            case .soon: "Nächste 7 Tage"
            case .later: "Später"
            case .undated: "Ohne Termin"
            }
        }
    }

    let kind: Kind
    let tasks: [TaskItem]
    var id: Int { kind.rawValue }

    /// Display grouping only (dates are calendar dates, as on the web).
    static func kind(of task: TaskItem, today: CalendarDate) -> Kind {
        let start = task.startDate, end = task.endDate
        if let end, end < today { return .overdue }
        guard start != nil || end != nil else { return .undated }
        let from = start ?? end!, to = end ?? start!
        if from <= today, today <= to { return .today }
        if from <= today.adding(days: 7) { return .soon }
        return .later
    }

    /// Work already started first, then by end date, then by number.
    static func group(_ tasks: [TaskItem], today: CalendarDate = .today()) -> [HomeBucket] {
        func rank(_ s: TaskStatus) -> Int {
            switch s {
            case .inProgress: 0
            case .inReview: 1
            default: 2
            }
        }
        let grouped = Dictionary(grouping: tasks) { kind(of: $0, today: today) }
        return Kind.allCases.compactMap { kind in
            guard let items = grouped[kind], !items.isEmpty else { return nil }
            let sorted = items.sorted { a, b in
                if rank(a.status) != rank(b.status) { return rank(a.status) < rank(b.status) }
                let ea = a.endDate ?? a.startDate, eb = b.endDate ?? b.startDate
                if ea != eb { return (ea ?? .init(dayNumber: .max)) < (eb ?? .init(dayNumber: .max)) }
                return a.number < b.number
            }
            return HomeBucket(kind: kind, tasks: sorted)
        }
    }
}

/// Conversation row content shared by the chat list and the start tab.
struct ConversationRowLabel: View {
    let conversation: ConversationSummary

    var body: some View {
        let c = conversation
        HStack(spacing: Tokens.Spacing.md) {
            Group {
                if let partner = c.dmPartner {
                    Avatar(fullName: partner.fullName, email: partner.email, size: 28)
                } else {
                    Image(systemName: c.kind == .privateChannel ? "lock" : "number")
                        .frame(width: 28)
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                }
            }
            Text(c.title)
                .fontWeight(c.unread ? .semibold : .regular)
                .lineLimit(1)
            Spacer()
            if c.unread {
                Circle().fill(Tokens.Palette.accentBlue).frame(width: 9, height: 9)
            }
        }
        .frame(minHeight: 32)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(c.kind == .dm ? "Direktnachricht" : c.kind == .privateChannel ? "Geschlossener Kanal" : "Kanal") \(c.title)"
                + (c.unread ? ", ungelesene Nachrichten" : "")
        )
    }
}
