import SwiftUI
import VistooCore

/// Kanban on iPhone: a status strip (with counts) and the focused column as
/// a native list. Every capability of the web board is available:
///   - status change: swipe (next status / "Erledigt"), long press, detail form,
///   - order: drag in "Sortieren" mode (toggled by the parent's menu), or long press
///     (nach oben/unten, an den Anfang/ans Ende) — also for VoiceOver,
///   - assignment ("Mir zuweisen"), deletion, opening.
struct BoardView: View {
    let session: SessionModel
    let scope: WorkScope
    let tasks: [TaskItem]
    let filtersActive: Bool
    @Binding var status: TaskStatus
    /// Drag-to-reorder mode, switched from the parent's toolbar.
    @Binding var sorting: Bool
    let onOpen: (TaskItem) -> Void
    let onAdd: ((TaskStatus) -> Void)?

    @State private var failure: ActionFailure?
    @State private var confirmDelete: TaskItem?
    @State private var feedback = 0

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
        .sensoryFeedback(.success, trigger: feedback)
        .failureAlert($failure)
        .taskDeleteConfirmation($confirmDelete) { task in
            run("Löschen fehlgeschlagen") { try await work.deleteTask(task) }
        }
        .onChange(of: status) { _, _ in sorting = false }
    }

    private func count(_ s: TaskStatus) -> Int { tasks.filter { $0.status == s }.count }

    private var columnPicker: some View {
        StatusStrip(statuses: columns, count: count, selection: $status)
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
        .environment(\.editMode, .constant(sorting ? .active : .inactive))
        #endif
        .animation(.default, value: sorting)
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
        .taskActions(session: session, task: task, onOpen: { onOpen(task) }, onDelete: { confirmDelete = task }, perform: run) {
            Menu {
                Button("An den Anfang") { reorder(task, to: 0) }
                Button("Eins nach oben") { step(task, by: -1) }
                Button("Eins nach unten") { step(task, by: 1) }
                Button("Ans Ende") { reorder(task, to: column.count - 1) }
            } label: { Label("Reihenfolge", systemImage: "arrow.up.arrow.down") }
        }
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

    // MARK: Actions

    @ViewBuilder private func accessibilityMoves(_ task: TaskItem) -> some View {
        if !work.isReadOnly(task) {
            Button("Eins nach oben") { step(task, by: -1) }
            Button("Eins nach unten") { step(task, by: 1) }
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
    var showAssignee = true

    private var overdue: Bool { task.isOverdue() }

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            StatusIcon(status: task.status, size: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: "#\(task.number)")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                    Text(task.title)
                        .font(.body)
                        .foregroundStyle(task.status == .done ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                        .lineLimit(3)
                }
                HStack(spacing: Tokens.Spacing.sm) {
                    if showProject, let project = work.project(task.projectId) {
                        HStack(spacing: 4) {
                            ProjectDot(colorKey: project.color)
                            Text(project.name).lineLimit(1)
                        }
                    }
                    if task.startDate != nil || task.endDate != nil {
                        Label(Formatting.range(task.startDate, task.endDate), systemImage: overdue ? "exclamationmark.circle" : "calendar")
                            .labelStyle(.titleAndIcon)
                            .lineLimit(1)
                            .foregroundStyle(overdue ? Tokens.Palette.destructive : Tokens.Palette.mutedForeground)
                            .fontWeight(overdue ? .medium : .regular)
                    }
                }
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            if showAssignee, !task.assigneeIds.isEmpty {
                AvatarStack(people: task.assigneeIds.compactMap { work.person($0) }, size: 26)
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Öffnet die Details")
    }

    private var accessibilityText: String {
        var parts = ["#\(task.number) \(task.title)", "Status \(task.status.label)"]
        if let project = work.project(task.projectId), showProject { parts.append("Projekt \(project.name)") }
        if task.startDate != nil || task.endDate != nil { parts.append(Formatting.range(task.startDate, task.endDate)) }
        if overdue { parts.append("überfällig") }
        let names = task.assigneeIds.map { work.person($0)?.displayName ?? "Ehemaliges Mitglied" }
        parts.append(names.isEmpty ? "Nicht zugewiesen" : "Verantwortlich \(names.joined(separator: ", "))")
        return parts.joined(separator: ", ")
    }
}

extension TaskItem {
    /// End date passed and not done (display only; the server knows no "overdue").
    func isOverdue(today: CalendarDate = .today()) -> Bool {
        status != .done && (endDate.map { $0 < today } ?? false)
    }
}
