import Foundation
import Observation

/// Which tasks a work view shows (same as the web: "Alle Aufgaben" or one project).
public enum WorkScope: Hashable, Sendable {
    /// All non-archived projects.
    case all
    case project(String)
}

/// Projects, people and tasks of the workspace.
///
/// Mutations go through the API (server rules are authoritative) with an
/// optimistic local update and rollback on failure. Realtime events and API
/// responses are merged by task `version`, so nothing is duplicated or
/// overwritten with older data.
@MainActor
@Observable
public final class WorkStore {
    public private(set) var projects: [Project] = []
    public private(set) var projectStats: [String: ProjectStat] = [:]
    public private(set) var members: [Member] = []
    public private(set) var formerMembers: [Member] = []
    public private(set) var tasksById: [String: TaskItem] = [:]
    public private(set) var state: LoadState = .idle
    /// Archived projects whose tasks were loaded on demand.
    private var loadedArchivedProjects: Set<String> = []

    private let backend: Backend

    public init(backend: Backend, bootstrap: Bootstrap) {
        self.backend = backend
        apply(bootstrap)
    }

    func apply(_ bootstrap: Bootstrap) {
        projects = bootstrap.projects
        members = bootstrap.members
        formerMembers = bootstrap.formerMembers
    }

    // MARK: Lookup

    public func project(_ id: String?) -> Project? {
        guard let id else { return nil }
        return projects.first { $0.id == id }
    }

    public var activeProjects: [Project] { projects.filter { !$0.archived } }
    public var archivedProjects: [Project] { projects.filter(\.archived) }

    /// Active or former member (former only for historical names).
    public func person(_ id: String?) -> Member? {
        guard let id else { return nil }
        return members.first { $0.userId == id } ?? formerMembers.first { $0.userId == id }
    }

    public func task(_ id: String) -> TaskItem? { tasksById[id] }

    /// Archived projects are read-only (server enforces it, the UI hides edits).
    public func isReadOnly(_ task: TaskItem) -> Bool { project(task.projectId)?.archived ?? false }

    public func tasks(in scope: WorkScope) -> [TaskItem] {
        let all = tasksById.values
        let scoped: [TaskItem]
        switch scope {
        case .all:
            let active = Set(activeProjects.map(\.id))
            scoped = all.filter { active.contains($0.projectId) }
        case .project(let id):
            scoped = all.filter { $0.projectId == id }
        }
        return scoped.sorted(by: TaskItem.boardOrder)
    }

    // MARK: Loading

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            async let projectList = backend.send(API.listProjects())
            async let taskList = backend.send(API.listTasks())
            let (p, t) = try await (projectList, taskList)
            projects = p.projects
            projectStats = p.stats
            var next: [String: TaskItem] = [:]
            for task in t.tasks { next[task.id] = task }
            // Keep tasks of opened archived projects (not part of the "all" list).
            for (id, task) in tasksById where loadedArchivedProjects.contains(task.projectId) { next[id] = next[id] ?? task }
            tasksById = next
            state = .loaded
            for id in loadedArchivedProjects { await loadTasks(ofProject: id) }
        } catch {
            state = tasksById.isEmpty ? .failed((error as? APIError)?.message ?? "Laden fehlgeschlagen.") : .loaded
        }
    }

    /// Tasks of one project (needed for archived projects, which "all" excludes).
    public func loadTasks(ofProject projectId: String) async {
        guard let list = try? await backend.send(API.listTasks(projectId: projectId)) else { return }
        if project(projectId)?.archived == true { loadedArchivedProjects.insert(projectId) }
        for task in tasksById.values where task.projectId == projectId && !list.tasks.contains(where: { $0.id == task.id }) {
            tasksById[task.id] = nil
        }
        for task in list.tasks { merge(task) }
    }

    public func reloadPeople() async {
        guard let bootstrap = try? await backend.send(API.getBootstrap()) else { return }
        members = bootstrap.members
        formerMembers = bootstrap.formerMembers
        projects = bootstrap.projects
    }

    public func reloadProjects() async {
        guard let list = try? await backend.send(API.listProjects()) else { return }
        projects = list.projects
        projectStats = list.stats
    }

    /// Fetches a single task (deep links into archived projects).
    public func fetchTask(_ id: String) async throws(APIError) -> TaskItem {
        let task = try await backend.send(API.getTask(id: id))
        merge(task)
        return task
    }

    // MARK: Realtime / merge

    /// Keeps the newer version; equal versions take the server copy.
    public func merge(_ task: TaskItem) {
        if let current = tasksById[task.id], current.version > task.version { return }
        tasksById[task.id] = task
    }

    public func removeTask(_ id: String) {
        tasksById[id] = nil
    }

    // MARK: Task mutations

    public struct TaskDraft: Sendable, Equatable {
        /// Client id: retries after a network failure never create a second task.
        public let id: String = newClientId()
        public var projectId: String
        public var title: String = ""
        public var description: String = ""
        public var status: TaskStatus = .open
        public var assigneeId: String?
        public var milestoneId: String?
        public var startDate: CalendarDate?
        public var endDate: CalendarDate?

        public init(projectId: String, status: TaskStatus = .open, assigneeId: String? = nil) {
            self.projectId = projectId
            self.status = status
            self.assigneeId = assigneeId
        }
    }

    public func createTask(_ draft: TaskDraft) async throws(APIError) -> TaskItem {
        let body = CreateTaskRequest(
            id: draft.id,
            projectId: draft.projectId,
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: draft.description,
            status: draft.status,
            milestoneId: Patchable(draft.milestoneId),
            assigneeId: Patchable(draft.assigneeId),
            startDate: Patchable(draft.startDate),
            endDate: Patchable(draft.endDate)
        )
        let task = try await backend.send(API.createTask(body: body))
        merge(task)
        bumpStats(projectId: task.projectId)
        return task
    }

    /// Full edit with optimistic concurrency (CONFLICT carries the current task).
    public func updateTask(_ id: String, expectedVersion: Int, patch: UpdateTaskRequest.Patch) async throws(APIError) -> TaskItem {
        let task = try await backend.send(API.updateTask(id: id, body: UpdateTaskRequest(expectedVersion: expectedVersion, patch: patch)))
        merge(task)
        return task
    }

    /// Quick action (no version check, as on the web). Task goes to the end of the column.
    public func setStatus(_ task: TaskItem, _ status: TaskStatus) async throws(APIError) {
        guard task.status != status else { return }
        let previous = tasksById[task.id]
        var optimistic = task
        optimistic.status = status
        optimistic.position = (tasks(in: .all).filter { $0.status == status }.map(\.position).max() ?? 0) + 1024
        tasksById[task.id] = optimistic
        do {
            merge(try await backend.send(API.setTaskStatus(id: task.id, body: SetTaskStatusRequest(status: status))))
            bumpStats(projectId: task.projectId)
        } catch {
            tasksById[task.id] = previous
            throw error
        }
    }

    public func setAssignee(_ task: TaskItem, _ userId: String?) async throws(APIError) {
        let previous = tasksById[task.id]
        var optimistic = task
        optimistic.assigneeId = userId
        tasksById[task.id] = optimistic
        do {
            merge(try await backend.send(API.setTaskAssignee(id: task.id, body: SetTaskAssigneeRequest(assigneeId: userId))))
        } catch {
            tasksById[task.id] = previous
            throw error
        }
    }

    /// Board move between the *visible* neighbours (hidden tasks keep their positions, as on the web).
    public func move(_ task: TaskItem, to status: TaskStatus, after afterId: String?, before beforeId: String?) async throws(APIError) {
        let previous = tasksById[task.id]
        var optimistic = task
        optimistic.status = status
        let after = afterId.flatMap { tasksById[$0]?.position }
        let before = beforeId.flatMap { tasksById[$0]?.position }
        switch (after, before) {
        case let (a?, b?): optimistic.position = (a + b) / 2
        case let (a?, nil): optimistic.position = a + 1024
        case let (nil, b?): optimistic.position = b - 1024
        default: break
        }
        tasksById[task.id] = optimistic
        do {
            let body = MoveTaskRequest(status: status, afterId: afterId, beforeId: beforeId)
            merge(try await backend.send(API.moveTask(id: task.id, body: body)))
            bumpStats(projectId: task.projectId)
        } catch {
            tasksById[task.id] = previous
            throw error
        }
    }

    public func deleteTask(_ task: TaskItem) async throws(APIError) {
        let previous = tasksById[task.id]
        tasksById[task.id] = nil
        do {
            _ = try await backend.send(API.deleteTask(id: task.id))
        } catch where error.code == .notFound {
            // Already gone (e.g. a retried request): that is the goal.
        } catch {
            tasksById[task.id] = previous
            throw error
        }
        bumpStats(projectId: task.projectId)
    }

    // MARK: Projects

    public func createProject(id: String = newClientId(), name: String, description: String, color: String) async throws(APIError) -> Project {
        let project = try await backend.send(API.createProject(body: CreateProjectRequest(name: name, description: description, color: ProjectColorKey(rawValue: color), id: id)))
        upsert(project)
        return project
    }

    public func updateProject(_ id: String, name: String, description: String, color: String) async throws(APIError) {
        upsert(try await backend.send(API.updateProject(id: id, body: UpdateProjectRequest(name: name, description: description, color: ProjectColorKey(rawValue: color)))))
    }

    public func setArchived(_ id: String, _ archived: Bool) async throws(APIError) {
        upsert(try await backend.send(API.setProjectArchived(id: id, body: SetArchivedRequest(archived: archived))))
        await reload()
    }


    private func upsert(_ project: Project) {
        if let i = projects.firstIndex(where: { $0.id == project.id }) { projects[i] = project }
        else {
            projects.append(project)
            projects.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
    }

    /// Local recount of the project statistics (the server sends exact numbers on reload).
    private func bumpStats(projectId: String) {
        let tasks = tasksById.values.filter { $0.projectId == projectId }
        projectStats[projectId] = ProjectStat(total: tasks.count, done: tasks.filter { $0.status == .done }.count)
    }
}
