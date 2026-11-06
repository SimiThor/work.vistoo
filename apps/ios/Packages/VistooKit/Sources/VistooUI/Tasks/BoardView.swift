import SwiftUI
import VistooCore

/// Kanban on iPhone: a status selector (with counts) and the focused column as
/// a native list. Every capability of the web board is available:
///   - status change: swipe ("Weiter"), context menu, detail form,
///   - order: drag to reorder in "Sortieren" mode, or context menu
///     (nach oben/unten, an den Anfang/ans Ende) — also for VoiceOver,
///   - assignment, deletion, opening.
struct BoardView: View {
    let session: SessionModel
    let scope: WorkScope
    let tasks: [TaskItem]
    let filtersActive: Bool
    @Binding var status: TaskStatus
    let onOpen: (TaskItem) -> Void
    let onAdd: ((TaskStatus) -> Void)?

    @State private var failure: ActionFailure?
    @State private var confirmDelete: TaskItem?
    @State private var feedback = 0
    #if os(iOS)
    @State private var editMode: EditMode = .inactive
    #endif

    private var work: WorkStore { session.work }
    private var column: [TaskItem] { tasks.filter { $0.status == status } }

    private var columns: [TaskStatus] {
        // Known statuses always; unknown ones (newer server) only when present.
        var all = TaskStatus.knownCases
        for t in tasks where !all.contains(t.status) { all.append(t.status) }
        return all
    }

    var body: some View {
        VStack(spacing: 0) {
            columnPicker
            taskList
        }
        .toolbar { sortToolbar }
        .sensoryFeedback(.success, trigger: feedback)
        .failureAlert($failure)
        .confirmationDialog(
            "Aufgabe löschen?",
            isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
            titleVisibility: .visible,
            presenting: confirmDelete
        ) { task in
            Button("Löschen", role: .destructive) { run("Löschen fehlgeschlagen") { try await work.deleteTask(task) } }
        } message: { task in
            Text("„\(task.title)“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.")
        }
    }

    private func count(_ s: TaskStatus) -> Int { tasks.filter { $0.status == s }.count }

    private var columnPicker: some View {
        Picker("Spalte", selection: $status) {
            ForEach(columns, id: \.self) { s in
                Text("\(s.label) \(count(s))").tag(s)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Tokens.Spacing.lg)
        .padding(.vertical, Tokens.Spacing.sm)
    }

    private var taskList: some View {
        List {
            if filtersActive {
                Text("Gefiltert: Beim Sortieren wird zwischen die sichtbaren Nachbarn einsortiert.")
                    .font(.footnote)
                    .foregroundStyle(Tokens.Palette.mutedForeground)
                    .listRowBackground(Color.clear)
            }
            ForEach(column) { task in
                row(task)
            }
            .onMove(perform: moveAction)
        }
        .plainListStyle()
        .overlay {
            if column.isEmpty { emptyColumn }
        }
        #if os(iOS)
        .environment(\.editMode, $editMode)
        #endif
    }

    /// Reordering is unavailable for archived (read-only) projects.
    private var moveAction: ((IndexSet, Int) -> Void)? {
        guard onAdd != nil else { return nil }
        return { source, destination in move(from: source, to: destination) }
    }

    private func row(_ task: TaskItem) -> some View {
        Button { onOpen(task) } label: {
            TaskRowView(work: work, task: task, showProject: scope == .all)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) { trailingSwipe(task) }
        .swipeActions(edge: .leading) { leadingSwipe(task) }
        .contextMenu { menu(task) }
        .accessibilityActions { accessibilityMoves(task) }
    }

    private var emptyColumn: some View {
        ContentUnavailableView {
            Label(filtersActive ? "Keine Treffer" : "Keine Aufgaben", systemImage: "tray")
        } description: {
            Text(filtersActive ? "Keine Aufgabe in „\(status.label)“ passt zu den Filtern." : "In „\(status.label)“ ist nichts.")
        } actions: {
            if let onAdd {
                Button("Aufgabe hinzufügen") { onAdd(status) }
            }
        }
    }

    @ToolbarContentBuilder private var sortToolbar: some ToolbarContent {
        ToolbarItem(placement: .trailing) { sortButton }
    }

    /// Drag handles for reordering (iOS edit mode); the context menu offers the same without dragging.
    @ViewBuilder private var sortButton: some View {
        #if os(iOS)
        if onAdd != nil, column.count > 1 {
            Button(editMode.isEditing ? "Fertig" : "Sortieren") {
                withAnimation { editMode = editMode.isEditing ? .inactive : .active }
            }
        }
        #endif
    }

    // MARK: Actions

    @ViewBuilder private func trailingSwipe(_ task: TaskItem) -> some View {
        if !work.isReadOnly(task) {
            if let next = task.status.next {
                Button {
                    run("Status nicht geändert") { try await work.setStatus(task, next) }
                } label: {
                    Label(next.label, systemImage: "arrow.right.circle")
                }
                .tint(next.tint)
            }
        }
    }

    @ViewBuilder private func leadingSwipe(_ task: TaskItem) -> some View {
        if !work.isReadOnly(task) {
            Button(role: .destructive) { confirmDelete = task } label: { Label("Löschen", systemImage: "trash") }
        }
    }

    @ViewBuilder private func menu(_ task: TaskItem) -> some View {
        Button { onOpen(task) } label: { Label("Öffnen", systemImage: "arrow.up.forward.square") }
        ShareLink(item: session.backend.configuration.taskLink(taskId: task.id)) {
            Label("Link teilen", systemImage: "link")
        }
        if !work.isReadOnly(task) {
            Menu {
                ForEach(TaskStatus.knownCases, id: \.self) { s in
                    Button {
                        run("Status nicht geändert") { try await work.setStatus(task, s) }
                    } label: {
                        if s == task.status { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                    }
                }
            } label: { Label("Status ändern", systemImage: "circle.dashed") }
            Menu {
                Button("Nicht zugewiesen") { run("Zuweisung fehlgeschlagen") { try await work.setAssignee(task, nil) } }
                ForEach(work.members, id: \.userId) { m in
                    Button {
                        run("Zuweisung fehlgeschlagen") { try await work.setAssignee(task, m.userId) }
                    } label: {
                        if m.userId == task.assigneeId { Label(m.displayName, systemImage: "checkmark") } else { Text(m.displayName) }
                    }
                }
            } label: { Label("Zuweisen", systemImage: "person.crop.circle") }
            Menu {
                Button("An den Anfang") { reorder(task, to: 0) }
                Button("Eins nach oben") { step(task, by: -1) }
                Button("Eins nach unten") { step(task, by: 1) }
                Button("Ans Ende") { reorder(task, to: column.count - 1) }
            } label: { Label("Reihenfolge", systemImage: "arrow.up.arrow.down") }
            Divider()
            Button(role: .destructive) { confirmDelete = task } label: { Label("Löschen …", systemImage: "trash") }
        }
    }

    @ViewBuilder private func accessibilityMoves(_ task: TaskItem) -> some View {
        if !work.isReadOnly(task) {
            Button("Eins nach oben") { step(task, by: -1) }
            Button("Eins nach unten") { step(task, by: 1) }
            if let next = task.status.next {
                Button("Status: \(next.label)") { run("Status nicht geändert") { try await work.setStatus(task, next) } }
            }
        }
    }

    // MARK: Ordering (same placement rule as the web: between visible neighbours)

    private func move(from source: IndexSet, to destination: Int) {
        var ids = column.map(\.id)
        guard let moved = source.first.map({ ids[$0] }) else { return }
        ids.move(fromOffsets: source, toOffset: destination)
        place(moved, in: ids)
    }

    private func step(_ task: TaskItem, by delta: Int) {
        guard let i = column.firstIndex(where: { $0.id == task.id }) else { return }
        reorder(task, to: i + delta)
    }

    private func reorder(_ task: TaskItem, to index: Int) {
        var ids = column.map(\.id)
        guard let from = ids.firstIndex(of: task.id) else { return }
        let target = max(0, min(index, ids.count - 1))
        guard target != from else { return }
        ids.remove(at: from)
        ids.insert(task.id, at: target)
        place(task.id, in: ids)
    }

    private func place(_ id: String, in ordered: [String]) {
        guard let i = ordered.firstIndex(of: id), let task = work.task(id) else { return }
        let after = i > 0 ? ordered[i - 1] : nil
        let before = i < ordered.count - 1 ? ordered[i + 1] : nil
        run("Verschieben fehlgeschlagen") { try await work.move(task, to: status, after: after, before: before) }
    }

    private func run(_ title: String, _ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                feedback += 1
            } catch let error as APIError {
                failure = ActionFailure(title, error)
            } catch {}
        }
    }
}

/// One task in a list: title first, then the context (project, dates, person).
struct TaskRowView: View {
    let work: WorkStore
    let task: TaskItem
    var showProject = true

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            StatusIcon(status: task.status, size: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(task.title)
                    .font(.body)
                    .foregroundStyle(task.status == .done ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                    .lineLimit(3)
                HStack(spacing: Tokens.Spacing.sm) {
                    if showProject, let project = work.project(task.projectId) {
                        HStack(spacing: 4) {
                            ProjectDot(colorKey: project.color)
                            Text(project.name).lineLimit(1)
                        }
                    }
                    if let group = work.group(task.groupId, in: task.projectId) {
                        Text(group.name).lineLimit(1)
                    }
                    if task.startDate != nil || task.endDate != nil {
                        Label(Formatting.range(task.startDate, task.endDate), systemImage: "calendar")
                            .labelStyle(.titleAndIcon)
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            if let person = work.person(task.assigneeId) {
                Avatar(fullName: person.fullName, email: person.email, size: 26)
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Öffnet die Details")
    }

    private var accessibilityText: String {
        var parts = [task.title, "Status \(task.status.label)"]
        if let project = work.project(task.projectId), showProject { parts.append("Projekt \(project.name)") }
        if task.startDate != nil || task.endDate != nil { parts.append(Formatting.range(task.startDate, task.endDate)) }
        parts.append(work.person(task.assigneeId).map { "Verantwortlich \($0.displayName)" } ?? "Nicht zugewiesen")
        return parts.joined(separator: ", ")
    }
}
