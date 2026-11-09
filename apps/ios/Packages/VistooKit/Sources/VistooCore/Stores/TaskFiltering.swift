import Foundation

/// Task filter semantics shared with the web (packages/domain/src/filters.ts).
/// Values within one filter are OR-ed, different filters AND-ed; the search
/// matches the title case-insensitively; `24` or `#24` also matches issue #24. Verified against
/// packages/contracts/fixtures/task-filters.json in the tests.
public struct TaskFilters: Equatable, Sendable {
    public var query: String = ""
    public var projects: Set<String> = []
    /// User ids or `DomainDefaults.unassigned`.
    public var assignees: Set<String> = []
    public var statuses: Set<TaskStatus> = []

    public init(query: String = "", projects: Set<String> = [], assignees: Set<String> = [], statuses: Set<TaskStatus> = []) {
        self.query = query
        self.projects = projects
        self.assignees = assignees
        self.statuses = statuses
    }

    public var isActive: Bool {
        !query.trimmingCharacters(in: .whitespaces).isEmpty || !projects.isEmpty || !assignees.isEmpty || !statuses.isEmpty
    }

    /// Number of active attribute filters (search excluded), for the toolbar badge.
    public var count: Int { projects.count + assignees.count + statuses.count }

    private static let locale = Locale(identifier: "de_DE")

    public func matches(title: String, number: Int? = nil, projectId: String, assigneeId: String?, status: TaskStatus) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: Self.locale)
        if !q.isEmpty, !title.lowercased(with: Self.locale).contains(q), !Self.matchesIssueNumber(number, q) { return false }
        if !projects.isEmpty, !projects.contains(projectId) { return false }
        if !assignees.isEmpty, !assignees.contains(assigneeId ?? DomainDefaults.unassigned) { return false }
        if !statuses.isEmpty, !statuses.contains(status) { return false }
        return true
    }

    /// `24` or `#24` names issue #24 (exact match, ASCII digits only).
    static func matchesIssueNumber(_ number: Int?, _ q: String) -> Bool {
        guard let number else { return false }
        let digits = q.hasPrefix("#") ? q.dropFirst() : Substring(q)
        guard (1...9).contains(digits.count), digits.allSatisfy({ ("0"..."9").contains($0) }) else { return false }
        return Int(digits) == number
    }

    public func matches(_ task: TaskItem) -> Bool {
        matches(title: task.title, number: task.number, projectId: task.projectId, assigneeId: task.assigneeId, status: task.status)
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
