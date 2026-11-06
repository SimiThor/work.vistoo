import Foundation

/// Task filter semantics shared with the web (packages/domain/src/filters.ts).
/// Values within one filter are OR-ed, different filters AND-ed; the search
/// matches the title case-insensitively. Verified against
/// packages/contracts/fixtures/task-filters.json in the tests.
public struct TaskFilters: Equatable, Sendable {
    public var query: String = ""
    public var projects: Set<String> = []
    /// Group ids or `DomainDefaults.noGroup`.
    public var groups: Set<String> = []
    /// User ids or `DomainDefaults.unassigned`.
    public var assignees: Set<String> = []
    public var statuses: Set<TaskStatus> = []

    public init(query: String = "", projects: Set<String> = [], groups: Set<String> = [], assignees: Set<String> = [], statuses: Set<TaskStatus> = []) {
        self.query = query
        self.projects = projects
        self.groups = groups
        self.assignees = assignees
        self.statuses = statuses
    }

    public var isActive: Bool {
        !query.trimmingCharacters(in: .whitespaces).isEmpty || !projects.isEmpty || !groups.isEmpty || !assignees.isEmpty || !statuses.isEmpty
    }

    /// Number of active attribute filters (search excluded), for the toolbar badge.
    public var count: Int { projects.count + groups.count + assignees.count + statuses.count }

    private static let locale = Locale(identifier: "de_DE")

    public func matches(title: String, projectId: String, groupId: String?, assigneeId: String?, status: TaskStatus) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: Self.locale)
        if !q.isEmpty, !title.lowercased(with: Self.locale).contains(q) { return false }
        if !projects.isEmpty, !projects.contains(projectId) { return false }
        if !groups.isEmpty, !groups.contains(groupId ?? DomainDefaults.noGroup) { return false }
        if !assignees.isEmpty, !assignees.contains(assigneeId ?? DomainDefaults.unassigned) { return false }
        if !statuses.isEmpty, !statuses.contains(status) { return false }
        return true
    }

    public func matches(_ task: TaskItem) -> Bool {
        matches(title: task.title, projectId: task.projectId, groupId: task.groupId, assigneeId: task.assigneeId, status: task.status)
    }
}

extension TaskItem {
    /// Board order within a column (same as the server: position, created, id).
    public static func boardOrder(_ a: TaskItem, _ b: TaskItem) -> Bool {
        if a.position != b.position { return a.position < b.position }
        if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
        return a.id < b.id
    }

    public var hasCompleteRange: Bool { startDate != nil && endDate != nil }
}
