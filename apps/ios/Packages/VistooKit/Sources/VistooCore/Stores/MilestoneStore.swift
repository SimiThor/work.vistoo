import Foundation
import Observation

/// Workspace-wide milestones. Tasks of any project can be attached
/// (`TaskItem.milestoneId`); the counts come from the server.
@MainActor
@Observable
public final class MilestoneStore {
    public private(set) var milestones: [Milestone] = []
    public private(set) var state: LoadState = .idle

    private let backend: Backend

    init(backend: Backend) {
        self.backend = backend
    }

    public func milestone(_ id: String?) -> Milestone? {
        guard let id else { return nil }
        return milestones.first { $0.id == id }
    }

    public var open: [Milestone] { milestones.filter { !$0.completed } }
    public var completed: [Milestone] { milestones.filter(\.completed) }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            milestones = try await backend.send(API.listMilestones()).milestones
            state = .loaded
        } catch {
            state = milestones.isEmpty ? .failed(error.message) : .loaded
        }
    }

    public func refresh(_ id: String) async {
        guard let m = try? await backend.send(API.getMilestone(id: id)) else { return }
        upsert(m)
    }

    @discardableResult
    public func create(id: String, name: String, description: String, dueDate: CalendarDate?) async throws(APIError) -> Milestone {
        let body = CreateMilestoneRequest(name: name.trimmingCharacters(in: .whitespacesAndNewlines), description: description, dueDate: Patchable(dueDate), id: id)
        let m = try await backend.send(API.createMilestone(body: body))
        upsert(m)
        await reload()
        return m
    }

    public func update(_ id: String, name: String, description: String, dueDate: CalendarDate?) async throws(APIError) {
        let body = UpdateMilestoneRequest(name: name.trimmingCharacters(in: .whitespacesAndNewlines), description: description, dueDate: Patchable(dueDate))
        upsert(try await backend.send(API.updateMilestone(id: id, body: body)))
    }

    public func setCompleted(_ milestone: Milestone, _ completed: Bool) async throws(APIError) {
        upsert(try await backend.send(API.setMilestoneCompleted(id: milestone.id, body: SetCompletedRequest(completed: completed))))
    }

    public func delete(_ milestone: Milestone) async throws(APIError) {
        do {
            _ = try await backend.send(API.deleteMilestone(id: milestone.id))
        } catch where error.code == .notFound {
        }
        milestones.removeAll { $0.id == milestone.id }
    }

    private func upsert(_ m: Milestone) {
        if let i = milestones.firstIndex(where: { $0.id == m.id }) { milestones[i] = m } else { milestones.append(m) }
    }

    func reset() {
        milestones = []
        state = .idle
    }
}
