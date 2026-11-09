import Foundation
import Observation

/// "Meine To-dos": the signed-in member's private checklist. The server scopes
/// every request to the caller; nobody else (also no admin) can see these.
///
/// Creating waits for the server (nothing is shown as saved before it is);
/// ticking, deleting and reordering update the list immediately and roll back
/// if the server refuses.
@MainActor
@Observable
public final class TodoStore {
    public private(set) var todos: [Todo] = []
    public private(set) var state: LoadState = .idle

    private let backend: Backend

    init(backend: Backend) {
        self.backend = backend
    }

    /// Open to-dos in their manual order (new ones on top).
    public var open: [Todo] {
        todos.filter { !$0.completed }.sorted { a, b in
            a.position != b.position ? a.position < b.position : a.createdAt < b.createdAt
        }
    }

    /// Completed to-dos, most recently completed first.
    public var completed: [Todo] {
        todos.filter(\.completed).sorted { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) }
    }

    public func overdueCount(today: CalendarDate = .today()) -> Int {
        open.filter { ($0.dueDate.map { $0 < today }) ?? false }.count
    }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            todos = try await backend.send(API.listTodos()).todos
            state = .loaded
        } catch {
            state = todos.isEmpty ? .failed(error.message) : .loaded
        }
    }

    /// `id` is the client id: retrying after a network failure never creates a second to-do.
    @discardableResult
    public func create(id: String, title: String, description: String = "", dueDate: CalendarDate? = nil) async throws(APIError) -> Todo {
        let body = CreateTodoRequest(
            id: id,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description,
            dueDate: Patchable(dueDate)
        )
        let todo = try await backend.send(API.createTodo(body: body))
        upsert(todo)
        return todo
    }

    @discardableResult
    public func update(_ id: String, _ patch: UpdateTodoRequest) async throws(APIError) -> Todo {
        let todo = try await backend.send(API.updateTodo(id: id, body: patch))
        upsert(todo)
        return todo
    }

    public func setCompleted(_ todo: Todo, _ completed: Bool) async throws(APIError) {
        guard todo.completed != completed else { return }
        let previous = todo
        var optimistic = todo
        optimistic.completed = completed
        optimistic.completedAt = completed ? .now : nil
        upsert(optimistic)
        do {
            upsert(try await backend.send(API.updateTodo(id: todo.id, body: UpdateTodoRequest(completed: completed))))
        } catch {
            upsert(previous)
            throw error
        }
    }

    public func delete(_ todo: Todo) async throws(APIError) {
        let previous = todos
        todos.removeAll { $0.id == todo.id }
        do {
            _ = try await backend.send(API.deleteTodo(id: todo.id))
        } catch where error.code == .notFound {
            // Already gone: that is the goal.
        } catch {
            todos = previous
            throw error
        }
    }

    /// Drag & drop within the open list (`List.onMove` offsets).
    public func move(fromOffsets source: IndexSet, toOffset destination: Int) async throws(APIError) {
        var ordered = open
        let moving = source.sorted().map { ordered[$0] }
        let insertAt = destination - source.filter { $0 < destination }.count
        for index in source.sorted(by: >) { ordered.remove(at: index) }
        ordered.insert(contentsOf: moving, at: insertAt)
        guard ordered.map(\.id) != open.map(\.id) else { return }

        let previous = todos
        for (i, todo) in ordered.enumerated() {
            var t = todo
            t.position = Double(i + 1) * 1024
            upsert(t)
        }
        do {
            let result = try await backend.send(API.reorderTodos(body: ReorderTodosRequest(ids: ordered.map(\.id))))
            for todo in result.todos { upsert(todo) }
        } catch {
            todos = previous
            throw error
        }
    }

    private func upsert(_ todo: Todo) {
        if let i = todos.firstIndex(where: { $0.id == todo.id }) { todos[i] = todo } else { todos.append(todo) }
    }

    func reset() {
        todos = []
        state = .idle
    }
}
