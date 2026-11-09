import SwiftUI
import VistooCore

/// "Meine To-dos": private checklist (only the signed-in member sees it).
struct TodosScreen: View {
    let session: SessionModel
    @State private var editing: Todo?
    @State private var failure: ActionFailure?
    @State private var showCompleted = false
    @State private var feedback = 0
    @FocusState private var addFocused: Bool

    private var store: TodoStore { session.todos }

    var body: some View {
        AreaContent(state: store.state, isEmpty: store.todos.isEmpty, retry: store.reload) {
            List {
                Section {
                    TodoQuickAddRow(store: store, focused: $addFocused) { failure = $0 }
                    ForEach(store.open) { todo in
                        TodoRow(todo: todo, toggle: { toggle(todo) }, open: { editing = todo })
                            .todoActions(todo: todo, toggle: { toggle(todo) }, edit: { editing = todo }, delete: { delete(todo) })
                    }
                    .onMove { source, destination in
                        Task {
                            do { try await store.move(fromOffsets: source, toOffset: destination) } catch {
                                failure = ActionFailure("Sortieren fehlgeschlagen", error)
                            }
                        }
                    }
                } footer: {
                    if store.open.isEmpty {
                        Text("Nichts offen. Neue To-dos landen oben in der Liste.")
                    } else {
                        Text("Nur du siehst deine To-dos. Halten und ziehen zum Sortieren.")
                    }
                }
                if !store.completed.isEmpty {
                    Section(isExpanded: $showCompleted) {
                        ForEach(store.completed) { todo in
                            TodoRow(todo: todo, toggle: { toggle(todo) }, open: { editing = todo })
                                .todoActions(todo: todo, toggle: { toggle(todo) }, edit: { editing = todo }, delete: { delete(todo) })
                        }
                    } header: {
                        Text("Erledigt (\(store.completed.count))")
                    }
                }
            }
            .groupedListStyle()
        }
        .navigationTitle("Meine To-dos")
        .toolbar {
            #if os(iOS)
            if !store.open.isEmpty {
                ToolbarItem(placement: .trailing) { EditButton() }
            }
            #endif
        }
        .refreshable { await store.reload() }
        .task { if store.state == .idle { await store.reload() } }
        .sheet(item: $editing) { todo in
            NavigationStack { TodoEditView(store: store, todo: todo) }
        }
        .failureAlert($failure)
        .sensoryFeedback(.success, trigger: feedback)
    }

    private func toggle(_ todo: Todo) {
        Task {
            do {
                try await store.setCompleted(todo, !todo.completed)
                feedback += 1
            } catch {
                failure = ActionFailure("Ändern fehlgeschlagen", error)
            }
        }
    }

    private func delete(_ todo: Todo) {
        Task {
            do { try await store.delete(todo) } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) }
        }
    }
}

/// One to-do: checkbox, title, due date.
struct TodoRow: View {
    let todo: Todo
    let toggle: () -> Void
    let open: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Spacing.md) {
            Button(action: toggle) {
                Image(systemName: todo.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(todo.completed ? Tokens.Palette.statusDone : Tokens.Palette.mutedForeground)
                    .frame(minWidth: 32, minHeight: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(todo.completed ? "Wieder öffnen: \(todo.title)" : "Erledigt: \(todo.title)")

            Button(action: open) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(todo.title)
                        .strikethrough(todo.completed)
                        .foregroundStyle(todo.completed ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                        .lineLimit(3)
                    if !todo.description.isEmpty || todo.dueDate != nil {
                        HStack(spacing: Tokens.Spacing.sm) {
                            if let due = todo.dueDate { DueDateLabel(date: due, overdueCheck: !todo.completed) }
                            if !todo.description.isEmpty {
                                Text(todo.description).lineLimit(1).foregroundStyle(Tokens.Palette.mutedForeground)
                            }
                        }
                        .font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // Title and date read as one element; ticking stays reachable as an action.
            .accessibilityElement(children: .combine)
            .accessibilityValue(todo.completed ? "Erledigt" : "")
            .accessibilityAction(named: todo.completed ? "Wieder öffnen" : "Erledigt", toggle)
        }
    }
}

extension View {
    func todoActions(todo: Todo, toggle: @escaping () -> Void, edit: @escaping () -> Void, delete: @escaping () -> Void) -> some View {
        self
            .swipeActions(edge: .leading) {
                Button(action: toggle) {
                    Label(todo.completed ? "Öffnen" : "Erledigt", systemImage: todo.completed ? "arrow.uturn.backward" : "checkmark")
                }
                .tint(Tokens.Palette.statusDone)
            }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive, action: delete) { Label("Löschen", systemImage: "trash") }
            }
            .contextMenu {
                Button(action: toggle) {
                    Label(todo.completed ? "Wieder öffnen" : "Erledigt", systemImage: todo.completed ? "arrow.uturn.backward" : "checkmark")
                }
                Button(action: edit) { Label("Bearbeiten", systemImage: "pencil") }
                Button(role: .destructive, action: delete) { Label("Löschen", systemImage: "trash") }
            }
    }
}

/// Inline "add" field: Return saves and keeps the keyboard open for the next one.
struct TodoQuickAddRow: View {
    let store: TodoStore
    var focused: FocusState<Bool>.Binding
    let onFailure: (ActionFailure) -> Void
    @State private var title = ""
    /// Kept until the server confirmed: a retry after a network error never duplicates.
    @State private var clientId = newClientId()
    @State private var saving = false

    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            Image(systemName: "plus.circle.fill")
                .font(.title3)
                .foregroundStyle(Tokens.Palette.accentBlue)
                .frame(minWidth: 32)
                .accessibilityHidden(true)
            TextField("Neues To-do", text: $title)
                .focused(focused)
                .submitLabel(.done)
                .onSubmit(save)
                .disabled(saving)
            if saving { ProgressView() }
        }
    }

    private func save() {
        let text = title.trimmed
        guard !text.isEmpty, !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.create(id: clientId, title: text)
                title = ""
                clientId = newClientId()
                focused.wrappedValue = true
            } catch {
                onFailure(ActionFailure("To-do nicht gespeichert", error))
            }
        }
    }
}

/// Edit sheet: title, notes, due date, done.
struct TodoEditView: View {
    let store: TodoStore
    let todo: Todo
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var description: String
    @State private var dueDate: CalendarDate?
    @State private var completed: Bool
    @State private var saving = false
    @State private var failure: APIError?
    @State private var confirmDelete = false

    init(store: TodoStore, todo: Todo) {
        self.store = store
        self.todo = todo
        _title = State(initialValue: todo.title)
        _description = State(initialValue: todo.description)
        _dueDate = State(initialValue: todo.dueDate)
        _completed = State(initialValue: todo.completed)
    }

    private var isDirty: Bool {
        title != todo.title || description != todo.description || dueDate != todo.dueDate || completed != todo.completed
    }
    private var isValid: Bool { !title.trimmed.isEmpty && title.count <= UpdateTodoRequest.titleMaxLength }

    var body: some View {
        Form {
            Section {
                TextField("Titel", text: $title, axis: .vertical).lineLimit(1...4)
                FieldError(message: failure?.fieldErrors["title"])
                Toggle("Erledigt", isOn: $completed)
            }
            Section("Fällig") {
                OptionalDateRow(title: "Fälligkeitsdatum", date: $dueDate)
            }
            Section("Notizen") {
                TextField("Details …", text: $description, axis: .vertical).lineLimit(3...)
            }
            FailureSection(error: failure)
            Section {
                Button("To-do löschen …", role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle("To-do")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(isDirty ? "Verwerfen" : "Schließen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Sichern") { Task { await save() } }.disabled(saving || !isDirty || !isValid)
            }
        }
        .interactiveDismissDisabled(isDirty)
        .confirmationDialog("To-do löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                Task {
                    do {
                        try await store.delete(todo)
                        dismiss()
                    } catch { failure = error as? APIError }
                }
            }
        }
    }

    private func save() async {
        var patch = UpdateTodoRequest()
        if title != todo.title { patch.title = title.trimmed }
        if description != todo.description { patch.description = description }
        if dueDate != todo.dueDate { patch.dueDate = Patchable(dueDate) }
        if completed != todo.completed { patch.completed = completed }
        saving = true
        defer { saving = false }
        do {
            try await store.update(todo.id, patch)
            dismiss()
        } catch {
            failure = error
        }
    }
}
