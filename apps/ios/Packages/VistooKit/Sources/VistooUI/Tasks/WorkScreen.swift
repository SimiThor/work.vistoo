import SwiftUI
import VistooCore

enum WorkMode: String, CaseIterable, Identifiable {
    case board, timeline
    var id: String { rawValue }
    var label: String { self == .board ? "Board" : "Zeitachse" }
    var systemImage: String { self == .board ? "rectangle.split.3x1" : "calendar.day.timeline.left" }
}

/// Board + timeline over the same tasks, for "Alle Aufgaben" or one project.
/// Search and filters behave exactly like the web (shared semantics).
///
/// Toolbar: only "+" is always visible. View mode, "Nur meine", filters, sorting and
/// the caller's extra actions (e.g. project actions) share one menu.
struct WorkScreen: View {
    let session: SessionModel
    let scope: WorkScope
    let title: String
    /// Extra menu entries of the caller (e.g. "Projekt bearbeiten").
    var extraMenu: (() -> AnyView)?

    @AppStorage("vistoo.work.mode") private var modeRaw = WorkMode.board.rawValue
    @AppStorage("vistoo.work.lastProject") private var lastProjectId = ""
    @State private var filters = TaskFilters()
    @State private var showFilters = false
    @State private var draft: WorkStore.TaskDraft?
    @State private var openTask: OpenTask?
    @State private var boardStatus: TaskStatus = .open
    @State private var sorting = false
    @Environment(Navigator.self) private var navigator

    struct OpenTask: Identifiable, Equatable {
        let id: String
        var focusDates = false
    }

    private var work: WorkStore { session.work }
    private var mode: WorkMode { WorkMode(rawValue: modeRaw) ?? .board }

    private var scopeProject: Project? {
        if case .project(let id) = scope { return work.project(id) }
        return nil
    }

    private var readOnly: Bool { scopeProject?.archived ?? false }

    private var visibleTasks: [TaskItem] {
        work.tasks(in: scope).filter(filters.matches)
    }

    private var canSort: Bool {
        mode == .board && !readOnly && visibleTasks.filter { $0.status == boardStatus }.count > 1
    }

    private var onlyMine: Binding<Bool> {
        Binding(
            get: { filters.assignees == [session.userId] },
            set: { filters.assignees = $0 ? [session.userId] : [] }
        )
    }

    var body: some View {
        content
            .navigationTitle(title)
            .inlineNavigationTitle()
            .searchable(text: $filters.query, prompt: "Aufgaben suchen")
            .toolbar { toolbar }
            .refreshable { await work.reload() }
            .sheet(isPresented: $showFilters) {
                FilterSheet(work: work, scope: scope, filters: $filters)
                    .presentationDetents([.medium, .large])
            }
            .sheet(item: $draft) { d in
                TaskCreateView(session: session, draft: d)
            }
            .sheet(item: $openTask) { open in
                NavigationStack {
                    TaskDetailView(session: session, taskId: open.id, focusDates: open.focusDates)
                }
            }
            .task(id: scope) {
                if case .project(let id) = scope, work.project(id)?.archived == true { await work.loadTasks(ofProject: id) }
            }
            .onChange(of: modeRaw) { _, _ in sorting = false }
    }

    @ViewBuilder private var content: some View {
        if work.state == .loading, work.tasksById.isEmpty {
            LoadingView()
        } else if case .failed(let message) = work.state, work.tasksById.isEmpty {
            FailureView(message: message) { await work.reload() }
        } else if work.activeProjects.isEmpty, scope == .all {
            ContentUnavailableView {
                Label("Noch keine Projekte", systemImage: "folder.badge.plus")
            } description: {
                Text("Aufgaben gehören immer zu einem Projekt. Lege zuerst ein Projekt an.")
            } actions: {
                Button("Zu den Projekten") { navigator.tab = .projects }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            VStack(spacing: 0) {
                if readOnly {
                    Label("Archiviert – nur lesbar", systemImage: "archivebox")
                        .font(.footnote)
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Tokens.Spacing.xs)
                        .background(Tokens.Palette.surfaceSubtle)
                }
                if filters.count > 0 { activeFilterBar }
                switch mode {
                case .board:
                    BoardView(
                        session: session,
                        scope: scope,
                        tasks: visibleTasks,
                        filtersActive: filters.isActive,
                        status: $boardStatus,
                        sorting: $sorting,
                        onOpen: { openTask = OpenTask(id: $0.id) },
                        onAdd: readOnly ? nil : { newTask(status: $0) }
                    )
                case .timeline:
                    TimelineView(
                        session: session,
                        scope: scope,
                        tasks: visibleTasks,
                        onOpen: { task, dates in openTask = OpenTask(id: task.id, focusDates: dates) }
                    )
                }
            }
        }
    }

    /// Always visible while filters hide tasks, so nothing seems to be "missing".
    private var activeFilterBar: some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: "line.3.horizontal.decrease.circle.fill")
                .foregroundStyle(Tokens.Palette.accentBlue)
                .accessibilityHidden(true)
            Button {
                showFilters = true
            } label: {
                Text(onlyMine.wrappedValue ? "Nur meine Aufgaben" : (filters.count == 1 ? "1 Filter aktiv" : "\(filters.count) Filter aktiv"))
                    .foregroundStyle(Tokens.Palette.foreground)
            }
            .buttonStyle(.plain)
            Spacer()
            Button("Zurücksetzen") { withAnimation { filters = TaskFilters(query: filters.query) } }
        }
        .font(.footnote)
        .padding(.horizontal, Tokens.Spacing.lg)
        .padding(.vertical, Tokens.Spacing.xs)
        .frame(minHeight: 36)
        .background(Tokens.Palette.accentBlueSoft)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if scope == .all {
            ToolbarItem(placement: .leading) { AccountButton(session: session) }
        }
        if sorting {
            ToolbarItem(placement: .confirmationAction) {
                Button("Fertig") { withAnimation { sorting = false } }
            }
        } else {
            ToolbarItemGroup(placement: .trailing) {
                optionsMenu
                if !readOnly {
                    Button {
                        newTask(status: mode == .board ? boardStatus : .open)
                    } label: {
                        Label("Neue Aufgabe", systemImage: "plus")
                    }
                    .disabled(work.activeProjects.isEmpty)
                }
            }
        }
    }

    private var optionsMenu: some View {
        Menu {
            Section {
                Picker("Ansicht", selection: $modeRaw) {
                    ForEach(WorkMode.allCases) { Label($0.label, systemImage: $0.systemImage).tag($0.rawValue) }
                }
            }
            Section {
                Toggle(isOn: onlyMine) { Label("Nur meine Aufgaben", systemImage: "person.crop.circle") }
                Button { showFilters = true } label: {
                    Label(filters.count > 0 ? "Filter (\(filters.count)) …" : "Filter …", systemImage: "line.3.horizontal.decrease")
                }
                if filters.count > 0 {
                    Button { filters = TaskFilters(query: filters.query) } label: { Label("Filter zurücksetzen", systemImage: "xmark.circle") }
                }
            }
            if canSort {
                Section {
                    Button { withAnimation { sorting = true } } label: { Label("Reihenfolge ändern", systemImage: "arrow.up.arrow.down") }
                }
            }
            if let extraMenu {
                Section { extraMenu() }
            }
        } label: {
            Label(
                "Ansicht und Filter",
                systemImage: filters.count > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
            )
        }
        .accessibilityLabel(filters.count > 0 ? "Ansicht und Filter, \(filters.count) Filter aktiv" : "Ansicht und Filter")
    }

    /// New tasks inherit unambiguous filter values so they stay visible (web rule);
    /// otherwise the project used last is preselected.
    private func newTask(status: TaskStatus) {
        let projectId: String? = {
            if case .project(let id) = scope { return id }
            if filters.projects.count == 1 { return filters.projects.first }
            return nil
        }()
        let last = work.project(lastProjectId).flatMap { $0.archived ? nil : $0.id }
        let fallback = projectId ?? last ?? work.activeProjects.first?.id
        guard let fallback else { return }
        let assigneeId = filters.assignees.count == 1 && filters.assignees.first != DomainDefaults.unassigned
            ? filters.assignees.first : nil
        draft = WorkStore.TaskDraft(projectId: fallback, status: status, assigneeId: assigneeId)
    }
}

extension WorkStore.TaskDraft: Identifiable {}
