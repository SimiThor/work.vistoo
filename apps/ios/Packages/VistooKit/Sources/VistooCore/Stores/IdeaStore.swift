import Foundation
import Observation

/// Shared idea backlog ("Ideen"). Every active member reads and edits;
/// the server validates assignees and creates linked issues.
@MainActor
@Observable
public final class IdeaStore {
    public private(set) var ideas: [Idea] = []
    public private(set) var state: LoadState = .idle

    private let backend: Backend

    init(backend: Backend) {
        self.backend = backend
    }

    public func idea(_ id: String) -> Idea? { ideas.first { $0.id == id } }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            ideas = try await backend.send(API.listIdeas()).ideas
            state = .loaded
        } catch {
            state = ideas.isEmpty ? .failed(error.message) : .loaded
        }
    }

    @discardableResult
    public func create(id: String, title: String, description: String, assigneeId: String?) async throws(APIError) -> Idea {
        let body = CreateIdeaRequest(
            id: id,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description,
            assigneeId: Patchable(assigneeId)
        )
        let idea = try await backend.send(API.createIdea(body: body))
        ideas.insert(idea, at: 0)
        ideas = deduplicated(ideas)
        return idea
    }

    @discardableResult
    public func update(_ id: String, _ patch: UpdateIdeaRequest) async throws(APIError) -> Idea {
        let idea = try await backend.send(API.updateIdea(id: id, body: patch))
        upsert(idea)
        return idea
    }

    public func setStatus(_ idea: Idea, _ status: IdeaStatus) async throws(APIError) {
        guard idea.status != status else { return }
        var optimistic = idea
        optimistic.status = status
        upsert(optimistic)
        do {
            upsert(try await backend.send(API.updateIdea(id: idea.id, body: UpdateIdeaRequest(status: status))))
        } catch {
            upsert(idea)
            throw error
        }
    }

    public func delete(_ idea: Idea) async throws(APIError) {
        let previous = ideas
        ideas.removeAll { $0.id == idea.id }
        do {
            _ = try await backend.send(API.deleteIdea(id: idea.id))
        } catch where error.code == .notFound {
        } catch {
            ideas = previous
            throw error
        }
    }

    /// Creates (or returns the already created) issue in `projectId`.
    public func createIssue(from idea: Idea, projectId: String) async throws(APIError) -> TaskItem {
        let result = try await backend.send(API.createIssueFromIdea(id: idea.id, body: CreateIssueFromIdeaRequest(projectId: projectId)))
        upsert(result.idea)
        return result.task
    }

    private func upsert(_ idea: Idea) {
        if let i = ideas.firstIndex(where: { $0.id == idea.id }) { ideas[i] = idea } else { ideas.insert(idea, at: 0) }
    }

    private func deduplicated(_ list: [Idea]) -> [Idea] {
        var seen = Set<String>()
        return list.filter { seen.insert($0.id).inserted }
    }

    func reset() {
        ideas = []
        state = .idle
    }
}
