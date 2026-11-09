import SwiftUI
import VistooCore

extension IdeaStatus {
    var hex: UInt32 {
        switch self {
        case .new: 0x4A7FD4
        case .planned: 0x4F9A5C
        case .irrelevant, .unknown: 0x8E8E93
        }
    }
}

/// Shared idea backlog: search, status filter, newest/oldest first.
struct IdeasScreen: View {
    let session: SessionModel
    @State private var query = ""
    @State private var status: IdeaStatus?
    @State private var newestFirst = true
    @State private var creating = false
    @State private var confirmDelete: Idea?
    @State private var failure: ActionFailure?

    private var store: IdeaStore { session.ideas }

    private var visible: [Idea] {
        let q = query.trimmed.lowercased()
        return store.ideas
            .filter { status == nil || $0.status == status }
            .filter { q.isEmpty || $0.title.lowercased().contains(q) || $0.description.lowercased().contains(q) }
            .sorted { newestFirst ? $0.createdAt > $1.createdAt : $0.createdAt < $1.createdAt }
    }

    var body: some View {
        AreaContent(state: store.state, isEmpty: store.ideas.isEmpty, retry: store.reload) {
            List {
                if store.ideas.isEmpty {
                    ContentUnavailableView("Noch keine Ideen", systemImage: "lightbulb", description: Text("Halte Ideen fest, bevor sie verloren gehen."))
                        .listRowBackground(Color.clear)
                } else if visible.isEmpty {
                    ContentUnavailableView.search(text: query)
                        .listRowBackground(Color.clear)
                }
                ForEach(visible) { idea in
                    NavigationLink(value: AreaRoute.idea(idea.id)) {
                        IdeaRow(idea: idea, work: session.work)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { confirmDelete = idea } label: { Label("Löschen", systemImage: "trash") }
                    }
                    .contextMenu {
                        Menu {
                            statusButtons(idea)
                        } label: {
                            Label("Status", systemImage: "circle.dotted")
                        }
                        Button(role: .destructive) { confirmDelete = idea } label: { Label("Löschen", systemImage: "trash") }
                    }
                }
            }
            .plainListStyle()
        }
        .navigationTitle("Ideen")
        .searchable(text: $query, prompt: "Ideen durchsuchen")
        .toolbar {
            ToolbarItem(placement: .trailing) {
                Menu {
                    Picker("Status", selection: $status) {
                        Text("Alle").tag(IdeaStatus?.none)
                        ForEach(IdeaStatus.knownCases, id: \.self) { s in
                            DotLabel(text: s.label, hex: s.hex).tag(IdeaStatus?.some(s))
                        }
                    }
                    Picker("Sortierung", selection: $newestFirst) {
                        Text("Neueste zuerst").tag(true)
                        Text("Älteste zuerst").tag(false)
                    }
                } label: {
                    Label("Filter", systemImage: status == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
            }
            ToolbarItem(placement: .trailing) {
                Button { creating = true } label: { Label("Neue Idee", systemImage: "plus") }
            }
        }
        .refreshable { await store.reload() }
        .task { if store.state == .idle { await store.reload() } }
        .sheet(isPresented: $creating) { NavigationStack { IdeaCreateView(session: session) } }
        .confirmationDialog("Idee löschen?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { idea in
            Button("Löschen", role: .destructive) {
                Task { do { try await store.delete(idea) } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) } }
            }
        } message: { idea in
            Text("„\(idea.title)“ wird gelöscht. Ein daraus erstelltes Issue bleibt bestehen.")
        }
        .failureAlert($failure)
    }

    @ViewBuilder private func statusButtons(_ idea: Idea) -> some View {
        ForEach(IdeaStatus.knownCases, id: \.self) { s in
            Button {
                Task { do { try await store.setStatus(idea, s) } catch { failure = ActionFailure("Ändern fehlgeschlagen", error) } }
            } label: {
                if idea.status == s { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
            }
        }
    }
}

struct IdeaRow: View {
    let idea: Idea
    let work: WorkStore

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(idea.title)
                    .foregroundStyle(idea.status == .irrelevant ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                    .lineLimit(2)
                if !idea.description.isEmpty {
                    Text(idea.description).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground).lineLimit(2)
                }
                HStack(spacing: Tokens.Spacing.sm) {
                    DotLabel(text: idea.status.label, hex: idea.status.hex)
                    if let task = idea.task {
                        Text(verbatim: "#\(task.number)").monospacedDigit()
                    }
                }
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            if let person = work.person(idea.assigneeId) {
                Avatar(fullName: person.fullName, email: person.email, size: 24)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// New idea: title, optional text and owner.
struct IdeaCreateView: View {
    let session: SessionModel
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var title = ""
    @State private var description = ""
    @State private var assigneeId: String?
    @State private var saving = false
    @State private var failure: APIError?
    @FocusState private var titleFocused: Bool

    var body: some View {
        Form {
            Section {
                TextField("Titel", text: $title, axis: .vertical)
                    .font(.headline)
                    .lineLimit(1...4)
                    .focused($titleFocused)
                FieldError(message: failure?.fieldErrors["title"])
                PersonPicker(title: "Verantwortlich", work: session.work, selection: $assigneeId, viewerId: session.userId)
            }
            Section("Beschreibung") {
                TextField("Worum geht es?", text: $description, axis: .vertical).lineLimit(4...)
            }
            FailureSection(error: failure)
        }
        .navigationTitle("Neue Idee")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Erstellen") { Task { await save() } }.disabled(saving || title.trimmed.isEmpty)
            }
        }
        .interactiveDismissDisabled(saving)
        .task {
            try? await Task.sleep(for: .milliseconds(450))
            titleFocused = true
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await session.ideas.create(id: clientId, title: title, description: description, assigneeId: assigneeId)
            dismiss()
        } catch {
            failure = error
        }
    }
}

/// Idea details: edit fields, create an issue from it, delete.
struct IdeaDetailScreen: View {
    let session: SessionModel
    let ideaId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(Navigator.self) private var navigator
    @State private var title = ""
    @State private var description = ""
    @State private var status: IdeaStatus = .new
    @State private var assigneeId: String?
    @State private var loadedFrom: Idea?
    @State private var saving = false
    @State private var failure: APIError?
    @State private var issueProjectId = ""
    @State private var creatingIssue = false
    @State private var confirmDelete = false
    @State private var saved = 0

    private var idea: Idea? { session.ideas.idea(ideaId) }

    private var isDirty: Bool {
        guard let idea = loadedFrom else { return false }
        return title != idea.title || description != idea.description || status != idea.status || assigneeId != idea.assigneeId
    }

    var body: some View {
        Group {
            if let idea {
                form(idea)
            } else if session.ideas.state == .loaded {
                ContentUnavailableView("Idee gelöscht", systemImage: "trash", description: Text("Diese Idee gibt es nicht mehr."))
            } else {
                LoadingView()
            }
        }
        .navigationTitle("Idee")
        .inlineNavigationTitle()
        .task {
            if session.ideas.state == .idle { await session.ideas.reload() }
            adopt()
        }
        .onChange(of: idea) { _, _ in if !isDirty { adopt() } }
        .confirmationDialog("Idee löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                Task {
                    guard let idea else { return }
                    do {
                        try await session.ideas.delete(idea)
                        dismiss()
                    } catch { failure = error as? APIError }
                }
            }
        } message: {
            Text("Ein daraus erstelltes Issue bleibt bestehen.")
        }
        .sensoryFeedback(.success, trigger: saved)
    }

    private func adopt() {
        guard let idea else { return }
        loadedFrom = idea
        title = idea.title
        description = idea.description
        status = idea.status
        assigneeId = idea.assigneeId
        if issueProjectId.isEmpty { issueProjectId = session.work.activeProjects.first?.id ?? "" }
    }

    @ViewBuilder private func form(_ idea: Idea) -> some View {
        Form {
            Section {
                TextField("Titel", text: $title, axis: .vertical).font(.headline).lineLimit(1...4)
                FieldError(message: failure?.fieldErrors["title"])
                Picker("Status", selection: $status) {
                    ForEach(IdeaStatus.knownCases, id: \.self) { s in DotLabel(text: s.label, hex: s.hex).tag(s) }
                    if case .unknown = status { Text(status.label).tag(status) }
                }
                PersonPicker(title: "Verantwortlich", work: session.work, selection: $assigneeId, viewerId: session.userId)
                FieldError(message: failure?.fieldErrors["assigneeId"])
            }
            Section("Beschreibung") {
                TextField("Worum geht es?", text: $description, axis: .vertical).lineLimit(4...)
            }
            FailureSection(error: failure)
            Section {
                if let task = idea.task {
                    Button {
                        navigator.linkedTask = .init(id: task.id)
                    } label: {
                        Label {
                            Text(verbatim: "#\(task.number) \(task.title)")
                        } icon: {
                            Image(systemName: "checklist")
                        }
                    }
                } else if session.work.activeProjects.isEmpty {
                    Text("Lege zuerst ein Projekt an, um ein Issue zu erstellen.").foregroundStyle(Tokens.Palette.mutedForeground)
                } else {
                    Picker("Projekt", selection: $issueProjectId) {
                        ForEach(session.work.activeProjects) { p in
                            Label { Text(p.name) } icon: { ProjectDot(colorKey: p.color) }.tag(p.id)
                        }
                    }
                    Button {
                        Task { await createIssue(idea) }
                    } label: {
                        HStack {
                            Label("Issue erstellen", systemImage: "plus.square.on.square")
                            if creatingIssue { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(creatingIssue || issueProjectId.isEmpty)
                }
            } header: {
                Text("Issue")
            } footer: {
                if idea.task == nil { Text("Legt eine Aufgabe mit Titel und Beschreibung der Idee an und verknüpft sie.") }
            }
            Section {
                if let creator = session.work.person(idea.createdBy) {
                    LabeledContent("Erstellt", value: "\(creator.displayName), \(Formatting.instant(idea.createdAt))")
                }
                LabeledContent("Zuletzt geändert", value: Formatting.instant(idea.updatedAt))
            }
            Section {
                Button("Idee löschen …", role: .destructive) { confirmDelete = true }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Sichern") { Task { await save(idea) } }
                    .disabled(saving || !isDirty || title.trimmed.isEmpty)
            }
        }
    }

    private func save(_ idea: Idea) async {
        var patch = UpdateIdeaRequest()
        if title != idea.title { patch.title = title.trimmed }
        if description != idea.description { patch.description = description }
        if status != idea.status { patch.status = status }
        if assigneeId != idea.assigneeId { patch.assigneeId = Patchable(assigneeId) }
        saving = true
        defer { saving = false }
        do {
            let updated = try await session.ideas.update(idea.id, patch)
            failure = nil
            loadedFrom = updated
            adopt()
            saved += 1
        } catch {
            failure = error
        }
    }

    private func createIssue(_ idea: Idea) async {
        creatingIssue = true
        defer { creatingIssue = false }
        do {
            let task = try await session.ideas.createIssue(from: idea, projectId: issueProjectId)
            session.work.merge(task)
            failure = nil
            saved += 1
            navigator.linkedTask = .init(id: task.id)
        } catch {
            failure = error
        }
    }
}
