import SwiftUI
import VistooCore

/// Editable fields shared by "create" and "edit".
struct TaskFields: Equatable {
    var title = ""
    var description = ""
    var status: TaskStatus = .open
    var projectId = ""
    var assigneeId: String?
    var startDate: CalendarDate?
    var endDate: CalendarDate?

    init(task: TaskItem) {
        title = task.title
        description = task.description
        status = task.status
        projectId = task.projectId
        assigneeId = task.assigneeId
        startDate = task.startDate
        endDate = task.endDate
    }

    init(draft: WorkStore.TaskDraft) {
        title = draft.title
        status = draft.status
        projectId = draft.projectId
        assigneeId = draft.assigneeId
    }

    var titleProblem: String? {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "Bitte gib einen Titel ein." }
        if t.count > CreateTaskRequest.titleMaxLength { return "Der Titel darf höchstens \(CreateTaskRequest.titleMaxLength) Zeichen lang sein." }
        return nil
    }

    var dateProblem: String? {
        if let s = startDate, let e = endDate, e < s { return "Das Enddatum darf nicht vor dem Startdatum liegen." }
        return nil
    }

    var isValid: Bool { titleProblem == nil && dateProblem == nil && description.count <= CreateTaskRequest.descriptionMaxLength }
}

/// The form sections (native pickers and date pickers).
struct TaskFieldsForm: View {
    let work: WorkStore
    @Binding var fields: TaskFields
    var readOnly = false
    var serverErrors: [String: String] = [:]
    @FocusState.Binding var datesFocused: Bool
    /// Signed-in user, for "Mir zuweisen" and the "(ich)" marker.
    var viewerId: String?
    /// New tasks: keyboard opens on the title right away.
    var autofocusTitle = false
    @FocusState private var titleFocused: Bool

    private var projects: [Project] {
        work.activeProjects + (work.project(fields.projectId).map { $0.archived ? [$0] : [] } ?? [])
    }

    var body: some View {
        Section {
            TextField("Titel", text: $fields.title, axis: .vertical)
                .font(.headline)
                .lineLimit(1...4)
                .focused($titleFocused)
                .onAppear {
                    guard autofocusTitle else { return }
                    // Sheets need a moment before the keyboard can appear.
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        titleFocused = true
                    }
                }
            if let problem = serverErrors["title"] ?? (fields.title.isEmpty ? nil : fields.titleProblem) {
                Text(problem).font(.footnote).foregroundStyle(Tokens.Palette.destructive)
            }
            Picker("Status", selection: $fields.status) {
                ForEach(TaskStatus.knownCases, id: \.self) { s in
                    Label { Text(s.label) } icon: { StatusIcon(status: s) }.tag(s)
                }
                if case .unknown = fields.status { Text(fields.status.label).tag(fields.status) }
            }
            if autofocusTitle { projectPicker }
            Picker("Verantwortlich", selection: $fields.assigneeId) {
                Text("Nicht zugewiesen").tag(String?.none)
                ForEach(work.members) { m in
                    Text(m.userId == viewerId ? "\(m.displayName) (ich)" : m.displayName).tag(String?.some(m.userId))
                }
                if let id = fields.assigneeId, !work.members.contains(where: { $0.userId == id }) {
                    Text(work.person(id)?.displayName ?? "Ehemaliges Mitglied").tag(String?.some(id))
                }
            }
            if let viewerId, fields.assigneeId != viewerId, !readOnly {
                Button {
                    fields.assigneeId = viewerId
                } label: {
                    Label("Mir zuweisen", systemImage: "person.crop.circle.badge.checkmark")
                }
            }
        }
        .disabled(readOnly)

        Section {
            dateRow(title: "Start", date: $fields.startDate, other: fields.endDate)
            dateRow(title: "Ende", date: $fields.endDate, other: fields.startDate)
            if let problem = serverErrors["endDate"] ?? fields.dateProblem {
                Text(problem).font(.footnote).foregroundStyle(Tokens.Palette.destructive)
            }
        } header: {
            Text("Zeitraum")
        } footer: {
            if fields.startDate != nil, fields.endDate != nil, fields.dateProblem == nil {
                let days = CalendarDate.durationDays(from: fields.startDate!, to: fields.endDate!)
                Text(days == 1 ? "1 Tag" : "\(days) Tage")
            }
        }
        .disabled(readOnly)

        Section("Beschreibung") {
            TextField("Details, Kontext, Links …", text: $fields.description, axis: .vertical)
                .lineLimit(4...)
        }
        .disabled(readOnly)

        // Rarely changed after creation, so below the everyday fields when editing.
        if !autofocusTitle {
            Section { projectPicker }
                .disabled(readOnly)
        }
    }

    private var projectPicker: some View {
        Picker("Projekt", selection: $fields.projectId) {
            ForEach(projects) { p in
                Label { Text(p.name) } icon: { ProjectDot(colorKey: p.color) }.tag(p.id)
            }
        }
    }

    @ViewBuilder
    private func dateRow(title: String, date: Binding<CalendarDate?>, other: CalendarDate?) -> some View {
        Toggle(isOn: Binding(
            get: { date.wrappedValue != nil },
            set: { on in date.wrappedValue = on ? (other ?? .today()) : nil }
        )) {
            Text(title)
        }
        .focused($datesFocused)
        if let value = date.wrappedValue {
            DatePicker(
                title,
                selection: Binding(
                    get: { value.date() },
                    set: { date.wrappedValue = CalendarDate($0) }
                ),
                displayedComponents: .date
            )
            .datePickerStyle(.compact)
            .environment(\.locale, Formatting.locale)
            .labelsHidden()
        }
    }
}

// MARK: - Create

struct TaskCreateView: View {
    let session: SessionModel
    let draft: WorkStore.TaskDraft
    @Environment(\.dismiss) private var dismiss
    @State private var fields: TaskFields
    @State private var saving = false
    @State private var failure: APIError?
    @State private var created = 0
    @FocusState private var datesFocused: Bool
    @AppStorage("vistoo.work.lastProject") private var lastProjectId = ""

    init(session: SessionModel, draft: WorkStore.TaskDraft) {
        self.session = session
        self.draft = draft
        _fields = State(initialValue: TaskFields(draft: draft))
    }

    var body: some View {
        NavigationStack {
            Form {
                TaskFieldsForm(
                    work: session.work,
                    fields: $fields,
                    serverErrors: failure?.fieldErrors ?? [:],
                    datesFocused: $datesFocused,
                    viewerId: session.userId,
                    autofocusTitle: true
                )
                if let failure {
                    Section {
                        Label(failure.message, systemImage: failure.isConnectivityProblem ? "wifi.slash" : "exclamationmark.triangle")
                            .foregroundStyle(Tokens.Palette.destructive)
                    } footer: {
                        if failure.isConnectivityProblem {
                            Text("Nichts geht verloren: „Erstellen“ erneut tippen legt die Aufgabe genau einmal an.")
                        }
                    }
                }
            }
            .navigationTitle("Neue Aufgabe")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Erstellen") { Task { await save() } }
                        .disabled(saving || !fields.isValid)
                }
            }
            .interactiveDismissDisabled(saving)
            .sensoryFeedback(.success, trigger: created)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var d = draft // keeps the client id: retries never duplicate
        d.title = fields.title
        d.description = fields.description
        d.status = fields.status
        d.projectId = fields.projectId
        d.assigneeId = fields.assigneeId
        d.startDate = fields.startDate
        d.endDate = fields.endDate
        do {
            _ = try await session.work.createTask(d)
            lastProjectId = d.projectId
            created += 1
            dismiss()
        } catch {
            failure = error
        }
    }
}

// MARK: - Detail / edit

struct TaskDetailView: View {
    let session: SessionModel
    let taskId: String
    var focusDates = false

    @Environment(\.dismiss) private var dismiss
    @State private var fields: TaskFields?
    /// Version the form is based on (optimistic concurrency).
    @State private var baseVersion = 0
    @State private var saving = false
    @State private var failure: APIError?
    @State private var conflict: TaskItem?
    @State private var confirmDelete = false
    @State private var saved = 0
    @FocusState private var datesFocused: Bool

    private var work: WorkStore { session.work }
    private var task: TaskItem? { work.task(taskId) }

    /// "Aufgabe #24" (the number is the human-readable reference, e.g. for chat).
    private var navigationTitle: String {
        let base = readOnly ? "Aufgabe (archiviert)" : "Aufgabe"
        return task.map { "\(base) #\($0.number)" } ?? base
    }
    private var readOnly: Bool { task.map(work.isReadOnly) ?? true }
    private var isDirty: Bool { task.map { fields != TaskFields(task: $0) } ?? false }

    var body: some View {
        Group {
            if let task, fields != nil {
                form(task)
            } else if task == nil {
                ContentUnavailableView("Aufgabe gelöscht", systemImage: "trash", description: Text("Diese Aufgabe gibt es nicht mehr."))
            } else {
                LoadingView()
            }
        }
        .navigationTitle(navigationTitle)
        .inlineNavigationTitle()
        .onAppear {
            if fields == nil, let task {
                fields = TaskFields(task: task)
                baseVersion = task.version
            }
            if focusDates { datesFocused = true }
        }
        .onChange(of: task?.version) { _, _ in
            // Realtime update from someone else: adopt it while there are no local edits.
            guard let task, !isDirty || fields == nil else { return }
            fields = TaskFields(task: task)
            baseVersion = task.version
        }
        .alert("Geändert", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } }), presenting: conflict) { current in
            Button("Aktuelle Version laden") {
                fields = TaskFields(task: current)
                baseVersion = current.version
            }
            Button("Trotzdem speichern") {
                baseVersion = current.version
                Task { await save() }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: { _ in
            Text("Diese Aufgabe wurde inzwischen von jemand anderem geändert.")
        }
        .confirmationDialog("Aufgabe löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { Task { await delete() } }
        } message: {
            Text("„\(task?.title ?? "")“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.")
        }
        .sensoryFeedback(.success, trigger: saved)
    }

    @ViewBuilder private func form(_ task: TaskItem) -> some View {
        Form {
            TaskFieldsForm(
                work: work,
                fields: Binding(get: { fields ?? TaskFields(task: task) }, set: { fields = $0 }),
                readOnly: readOnly,
                serverErrors: failure?.fieldErrors ?? [:],
                datesFocused: $datesFocused,
                viewerId: session.userId
            )
            if let failure, failure.code != .conflict {
                Section {
                    Label(failure.message, systemImage: "exclamationmark.triangle").foregroundStyle(Tokens.Palette.destructive)
                }
            }
            Section {
                ShareLink(item: session.backend.configuration.taskLink(taskId: task.id)) {
                    Label("Link zur Aufgabe teilen", systemImage: "link")
                }
                if let creator = work.person(task.createdBy) {
                    LabeledContent("Erstellt", value: "\(creator.displayName), \(Formatting.instant(task.createdAt))")
                }
                LabeledContent("Zuletzt geändert", value: Formatting.instant(task.updatedAt))
            }
            if !readOnly {
                Section {
                    Button("Aufgabe löschen …", role: .destructive) { confirmDelete = true }
                }
            }
        }
        .toolbar {
            if !readOnly {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sichern") { Task { await save() } }
                        .disabled(saving || !isDirty || !(fields?.isValid ?? false))
                }
            }
            ToolbarItem(placement: .cancellationAction) {
                Button(isDirty ? "Verwerfen" : "Schließen") { dismiss() }
            }
        }
        .interactiveDismissDisabled(isDirty)
    }

    /// Sends only the changed fields; `null` clears, omitted stays unchanged.
    private func save() async {
        guard let task, let fields else { return }
        let original = TaskFields(task: task)
        var patch = UpdateTaskRequest.Patch()
        if fields.title != original.title { patch.title = fields.title.trimmingCharacters(in: .whitespacesAndNewlines) }
        if fields.description != original.description { patch.description = fields.description }
        if fields.status != original.status { patch.status = fields.status }
        if fields.projectId != original.projectId { patch.projectId = fields.projectId }
        if fields.assigneeId != original.assigneeId { patch.assigneeId = Patchable(fields.assigneeId) }
        if fields.startDate != original.startDate { patch.startDate = Patchable(fields.startDate) }
        if fields.endDate != original.endDate { patch.endDate = Patchable(fields.endDate) }

        saving = true
        defer { saving = false }
        do {
            let updated = try await work.updateTask(task.id, expectedVersion: baseVersion, patch: patch)
            self.fields = TaskFields(task: updated)
            baseVersion = updated.version
            failure = nil
            saved += 1
        } catch {
            failure = error
            if error.code == .conflict, let current = error.currentTask {
                work.merge(current)
                // After a lost response the "conflict" may be our own save.
                if TaskFields(task: current) == fields {
                    self.fields = TaskFields(task: current)
                    baseVersion = current.version
                    failure = nil
                    saved += 1
                } else {
                    conflict = current
                }
            }
        }
    }

    private func delete() async {
        guard let task else { return }
        do {
            try await work.deleteTask(task)
            dismiss()
        } catch {
            failure = error
        }
    }
}

// MARK: - Filters

struct FilterSheet: View {
    let work: WorkStore
    let scope: WorkScope
    @Binding var filters: TaskFilters
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if scope == .all {
                    Section("Projekt") {
                        ForEach(work.activeProjects) { p in
                            toggle(p.name, isOn: filters.projects.contains(p.id)) { flip(&filters.projects, p.id) } icon: {
                                ProjectDot(colorKey: p.color)
                            }
                        }
                    }
                }
                Section("Person") {
                    toggle("Nicht zugewiesen", isOn: filters.assignees.contains(DomainDefaults.unassigned)) {
                        flip(&filters.assignees, DomainDefaults.unassigned)
                    }
                    ForEach(work.members) { m in
                        toggle(m.displayName, isOn: filters.assignees.contains(m.userId)) { flip(&filters.assignees, m.userId) } icon: {
                            Avatar(fullName: m.fullName, email: m.email, size: 22)
                        }
                    }
                }
                Section("Status") {
                    ForEach(TaskStatus.knownCases, id: \.self) { s in
                        toggle(s.label, isOn: filters.statuses.contains(s)) {
                            if filters.statuses.contains(s) { filters.statuses.remove(s) } else { filters.statuses.insert(s) }
                        } icon: {
                            StatusIcon(status: s)
                        }
                    }
                }
            }
            .groupedListStyle()
            .navigationTitle("Filter")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zurücksetzen") { filters = TaskFilters(query: filters.query) }
                        .disabled(filters.count == 0)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
        }
    }

    private func flip(_ set: inout Set<String>, _ value: String) {
        if set.contains(value) { set.remove(value) } else { set.insert(value) }
    }

    private func toggle(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        toggle(title, isOn: isOn, action: action) { EmptyView() }
    }

    private func toggle(_ title: String, isOn: Bool, action: @escaping () -> Void, @ViewBuilder icon: () -> some View) -> some View {
        Button(action: action) {
            HStack {
                icon()
                Text(title).foregroundStyle(Tokens.Palette.foreground)
                Spacer()
                if isOn { Image(systemName: "checkmark").foregroundStyle(Tokens.Palette.accentBlue) }
            }
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
