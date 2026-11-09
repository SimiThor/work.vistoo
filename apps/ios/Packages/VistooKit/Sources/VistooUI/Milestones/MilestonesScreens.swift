import SwiftUI
import VistooCore

/// Workspace-wide milestones: open ones by due date, completed ones folded away.
struct MilestonesScreen: View {
    let session: SessionModel
    @State private var editing: MilestoneEditorTarget?
    @State private var showCompleted = false

    private var store: MilestoneStore { session.milestones }

    var body: some View {
        AreaContent(state: store.state, isEmpty: store.milestones.isEmpty, retry: store.reload) {
            List {
                if store.milestones.isEmpty {
                    ContentUnavailableView(
                        "Noch keine Meilensteine",
                        systemImage: "flag",
                        description: Text("Meilensteine bündeln Aufgaben aus allen Projekten zu einem Ziel.")
                    )
                    .listRowBackground(Color.clear)
                }
                Section {
                    ForEach(store.open, id: \.id) { m in
                        NavigationLink(value: AreaRoute.milestone(m.id)) { MilestoneRow(milestone: m) }
                    }
                }
                if !store.completed.isEmpty {
                    Section(isExpanded: $showCompleted) {
                        ForEach(store.completed, id: \.id) { m in
                            NavigationLink(value: AreaRoute.milestone(m.id)) { MilestoneRow(milestone: m) }
                        }
                    } header: {
                        Text("Abgeschlossen (\(store.completed.count))")
                    }
                }
            }
            .groupedListStyle()
        }
        .navigationTitle("Meilensteine")
        .toolbar {
            ToolbarItem(placement: .trailing) {
                Button { editing = .create } label: { Label("Neuer Meilenstein", systemImage: "plus") }
            }
        }
        .refreshable { await store.reload() }
        .task { await store.reload() }
        .sheet(item: $editing) { target in NavigationStack { MilestoneEditor(session: session, target: target) } }
    }
}

struct MilestoneRow: View {
    let milestone: Milestone

    var body: some View {
        let m = milestone
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Image(systemName: m.completed ? "flag.checkered" : "flag")
                    .foregroundStyle(Tokens.Palette.mutedForeground)
                    .accessibilityHidden(true)
                Text(m.name).foregroundStyle(m.completed ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                Spacer()
                if let due = m.dueDate { DueDateLabel(date: due, overdueCheck: !m.completed).font(.caption) }
            }
            if m.total > 0 {
                ProgressView(value: Double(m.done), total: Double(m.total)) {
                    EmptyView()
                } currentValueLabel: {
                    Text("\(m.done) von \(m.total) erledigt").font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                }
                .tint(Tokens.Palette.statusDone)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A milestone with its tasks from all projects.
struct MilestoneDetailScreen: View {
    let session: SessionModel
    let milestoneId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(Navigator.self) private var navigator
    @State private var editing: MilestoneEditorTarget?
    @State private var confirmDelete = false
    @State private var failure: ActionFailure?

    private var milestone: Milestone? { session.milestones.milestone(milestoneId) }
    private var tasks: [TaskItem] {
        session.work.tasks(in: .all).filter { $0.milestoneId == milestoneId }
            .sorted { ($0.status == .done ? 1 : 0, $0.number) < ($1.status == .done ? 1 : 0, $1.number) }
    }

    var body: some View {
        Group {
            if let m = milestone {
                list(m)
            } else if session.milestones.state == .loaded {
                ContentUnavailableView("Meilenstein gelöscht", systemImage: "trash")
            } else {
                LoadingView()
            }
        }
        .navigationTitle(milestone?.name ?? "Meilenstein")
        .inlineNavigationTitle()
        .task {
            if session.milestones.state == .idle { await session.milestones.reload() }
            await session.milestones.refresh(milestoneId)
        }
        .sheet(item: $editing) { target in NavigationStack { MilestoneEditor(session: session, target: target) } }
        .confirmationDialog("Meilenstein löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                Task {
                    guard let m = milestone else { return }
                    do {
                        try await session.milestones.delete(m)
                        await session.work.reload()
                        dismiss()
                    } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) }
                }
            }
        } message: {
            Text("Die Aufgaben bleiben erhalten, nur ohne Meilenstein.")
        }
        .failureAlert($failure)
    }

    @ViewBuilder private func list(_ m: Milestone) -> some View {
        List {
            Section {
                MilestoneRow(milestone: m)
                if !m.description.isEmpty { Text(m.description).font(.callout) }
            }
            Section {
                if tasks.isEmpty {
                    Text("Noch keine Aufgaben. Ordne Aufgaben im Aufgabendetail diesem Meilenstein zu.")
                        .font(.callout)
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                }
                ForEach(tasks) { task in
                    Button { navigator.linkedTask = .init(id: task.id) } label: {
                        TaskRowView(work: session.work, task: task)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Aufgaben")
            }
        }
        .groupedListStyle()
        .refreshable {
            await session.work.reload()
            await session.milestones.refresh(milestoneId)
        }
        .toolbar {
            ToolbarItem(placement: .trailing) {
                Menu {
                    Button { editing = .edit(m) } label: { Label("Bearbeiten", systemImage: "pencil") }
                    Button {
                        Task {
                            do { try await session.milestones.setCompleted(m, !m.completed) } catch {
                                failure = ActionFailure("Ändern fehlgeschlagen", error)
                            }
                        }
                    } label: {
                        Label(m.completed ? "Wieder öffnen" : "Abschließen", systemImage: m.completed ? "arrow.uturn.backward" : "flag.checkered")
                    }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Löschen …", systemImage: "trash") }
                } label: {
                    Label("Aktionen", systemImage: "ellipsis.circle")
                }
            }
        }
    }
}

enum MilestoneEditorTarget: Identifiable {
    case create
    case edit(Milestone)
    var id: String {
        switch self {
        case .create: "create"
        case .edit(let m): m.id
        }
    }
}

struct MilestoneEditor: View {
    let session: SessionModel
    let target: MilestoneEditorTarget
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var name = ""
    @State private var description = ""
    @State private var dueDate: CalendarDate?
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name).font(.headline)
                FieldError(message: failure?.fieldErrors["name"])
                OptionalDateRow(title: "Zieldatum", date: $dueDate)
            }
            Section("Beschreibung") {
                TextField("Worum geht es?", text: $description, axis: .vertical).lineLimit(3...)
            }
            FailureSection(error: failure.flatMap { $0.fieldErrors.isEmpty ? $0 : nil })
        }
        .navigationTitle(isCreate ? "Neuer Meilenstein" : "Meilenstein bearbeiten")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(isCreate ? "Erstellen" : "Sichern") { Task { await save() } }.disabled(saving || name.trimmed.isEmpty)
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear {
            if case .edit(let m) = target {
                name = m.name
                description = m.description
                dueDate = m.dueDate
            }
        }
    }

    private var isCreate: Bool { if case .create = target { true } else { false } }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            switch target {
            case .create: try await session.milestones.create(id: clientId, name: name, description: description, dueDate: dueDate)
            case .edit(let m): try await session.milestones.update(m.id, name: name, description: description, dueDate: dueDate)
            }
            dismiss()
        } catch {
            failure = error
        }
    }
}
