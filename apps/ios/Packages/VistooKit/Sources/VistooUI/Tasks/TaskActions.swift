import SwiftUI
import VistooCore

/// Runs a task action and reports failures (owned by the list that shows the rows).
typealias TaskActionRunner = (_ failureTitle: String, _ action: @escaping () async throws -> Void) -> Void

/// The quick actions every task row offers, in the same place on every list:
///   - swipe right-to-left: next status (full swipe) and "Erledigt",
///   - swipe left-to-right: delete (with confirmation by the caller),
///   - long press: open, status, assignment (with "Mir zuweisen" first), share, delete.
/// Rarely needed actions (reordering, link) live only in the long-press menu.
struct TaskRowActions<Extra: View>: ViewModifier {
    let session: SessionModel
    let task: TaskItem
    let onOpen: () -> Void
    let onDelete: () -> Void
    let perform: TaskActionRunner
    @ViewBuilder let extraMenu: () -> Extra

    private var work: WorkStore { session.work }
    private var editable: Bool { !work.isReadOnly(task) }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                if editable {
                    if let next = task.status.next {
                        Button { setStatus(next) } label: { Label(next.label, systemImage: next == .done ? "checkmark.circle" : "arrow.right.circle") }
                            .tint(next.tint)
                    }
                    if task.status != .done, task.status.next != .done {
                        Button { setStatus(.done) } label: { Label(TaskStatus.done.label, systemImage: "checkmark.circle") }
                            .tint(TaskStatus.done.tint)
                    }
                    if task.status == .done {
                        Button { setStatus(.open) } label: { Label("Wieder öffnen", systemImage: "arrow.uturn.backward.circle") }
                            .tint(TaskStatus.open.tint)
                    }
                }
            }
            .swipeActions(edge: .leading) {
                if editable {
                    Button(role: .destructive, action: onDelete) { Label("Löschen", systemImage: "trash") }
                }
            }
            .contextMenu { menu }
            .accessibilityActions {
                if editable {
                    if let next = task.status.next {
                        Button("Status: \(next.label)") { setStatus(next) }
                    }
                    if !task.isAssigned(to: session.userId) {
                        Button("Mir zuweisen") { toggle(session.userId) }
                    }
                }
            }
    }

    @ViewBuilder private var menu: some View {
        Button(action: onOpen) { Label("Öffnen", systemImage: "arrow.up.forward.square") }
        if editable {
            Menu {
                ForEach(TaskStatus.knownCases, id: \.self) { s in
                    Button { setStatus(s) } label: {
                        if s == task.status { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                    }
                }
            } label: { Label("Status ändern", systemImage: "circle.dashed") }
            if !task.isAssigned(to: session.userId) {
                Button { toggle(session.userId) } label: { Label("Mir zuweisen", systemImage: "person.crop.circle.badge.checkmark") }
            }
            // Several people possible: each entry adds or removes one person.
            Menu {
                ForEach(work.members, id: \.userId) { m in
                    Button { toggle(m.userId) } label: {
                        if task.isAssigned(to: m.userId) { Label(m.displayName, systemImage: "checkmark") } else { Text(m.displayName) }
                    }
                }
                if !task.assigneeIds.isEmpty {
                    Divider()
                    Button("Niemand zuweisen") { assign([]) }
                }
            } label: { Label("Zuweisen", systemImage: "person.2.crop.square.stack") }
            extraMenu()
        }
        ShareLink(item: session.backend.configuration.taskLink(taskId: task.id)) {
            Label("Link teilen", systemImage: "link")
        }
        if editable {
            Divider()
            Button(role: .destructive, action: onDelete) { Label("Löschen …", systemImage: "trash") }
        }
    }

    private func setStatus(_ status: TaskStatus) {
        perform("Status nicht geändert") { try await work.setStatus(task, status) }
    }

    /// Adds `userId` to the assignees, or removes them if already assigned.
    private func toggle(_ userId: String?) {
        guard let userId else { return }
        let ids = task.isAssigned(to: userId) ? task.assigneeIds.filter { $0 != userId } : task.assigneeIds + [userId]
        assign(ids)
    }

    private func assign(_ userIds: [String]) {
        perform("Zuweisung fehlgeschlagen") { try await work.setAssignees(task, userIds) }
    }
}

extension View {
    func taskActions(
        session: SessionModel,
        task: TaskItem,
        onOpen: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        perform: @escaping TaskActionRunner
    ) -> some View {
        modifier(TaskRowActions(session: session, task: task, onOpen: onOpen, onDelete: onDelete, perform: perform) { EmptyView() })
    }

    func taskActions<Extra: View>(
        session: SessionModel,
        task: TaskItem,
        onOpen: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        perform: @escaping TaskActionRunner,
        @ViewBuilder extraMenu: @escaping () -> Extra
    ) -> some View {
        modifier(TaskRowActions(session: session, task: task, onOpen: onOpen, onDelete: onDelete, perform: perform, extraMenu: extraMenu))
    }

    /// Delete confirmation for task lists (the swipe/menu only asks for it).
    func taskDeleteConfirmation(_ task: Binding<TaskItem?>, delete: @escaping (TaskItem) -> Void) -> some View {
        confirmationDialog(
            "Aufgabe löschen?",
            isPresented: Binding(get: { task.wrappedValue != nil }, set: { if !$0 { task.wrappedValue = nil } }),
            titleVisibility: .visible,
            presenting: task.wrappedValue
        ) { t in
            Button("Löschen", role: .destructive) { delete(t) }
        } message: { t in
            Text("#\(t.number) „\(t.title)“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.")
        }
    }
}

/// Horizontal status selector with counts. Readable at every text size, unlike a
/// segmented control with four long German labels.
struct StatusStrip: View {
    let statuses: [TaskStatus]
    let count: (TaskStatus) -> Int
    @Binding var selection: TaskStatus

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Tokens.Spacing.xs) {
                    ForEach(statuses, id: \.self) { s in chip(s).id(s) }
                }
                .padding(.horizontal, Tokens.Spacing.lg)
            }
            .onChange(of: selection) { _, s in withAnimation { proxy.scrollTo(s, anchor: .center) } }
        }
        .padding(.vertical, Tokens.Spacing.xxs)
    }

    private func chip(_ s: TaskStatus) -> some View {
        let selected = s == selection
        return Button {
            selection = s
        } label: {
            HStack(spacing: 6) {
                StatusIcon(status: s, size: 14)
                Text(s.label)
                Text("\(count(s))")
                    .monospacedDigit()
                    .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .foregroundStyle(Tokens.Palette.foreground)
            .padding(.horizontal, Tokens.Spacing.md)
            .padding(.vertical, Tokens.Spacing.sm)
            .background(Capsule().fill(selected ? Tokens.Palette.surfaceSunken : Color.clear))
            .overlay(Capsule().strokeBorder(selected ? Tokens.Palette.borderStrong : Tokens.Palette.border, lineWidth: 1))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(s.label), \(count(s)) Aufgaben")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
