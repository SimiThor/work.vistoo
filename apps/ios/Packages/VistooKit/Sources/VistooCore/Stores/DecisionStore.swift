import Foundation
import Observation

/// Decisions and experiments. Search and filters run on the server (full
/// text); status/type/completion rules are enforced there as well — the app
/// only shows the server's field errors.
@MainActor
@Observable
public final class DecisionStore {
    public struct Query: Equatable, Sendable {
        public var text = ""
        public var type: DecisionType?
        public var status: DecisionStatus?
        /// Member id or `DomainDefaults.unassigned`.
        public var assigneeId: String?
        public var sort: DecisionSort = .updated

        public init() {}

        public var filterCount: Int { [type != nil, status != nil, assigneeId != nil].filter { $0 }.count }
    }

    public private(set) var decisions: [DecisionSummary] = []
    public private(set) var details: [String: DecisionDetail] = [:]
    public private(set) var state: LoadState = .idle
    public var query = Query()

    private let backend: Backend
    @ObservationIgnored private var generation = 0

    init(backend: Backend) {
        self.backend = backend
    }

    public func reload() async {
        generation += 1
        let current = generation
        if state != .loaded { state = .loading }
        do {
            let q = query
            let trimmed = q.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let list = try await backend.send(API.listDecisions(
                query: trimmed.isEmpty ? nil : trimmed,
                type: q.type,
                status: q.status,
                assigneeId: q.assigneeId,
                sort: q.sort
            ))
            // A newer search started meanwhile: its result wins.
            guard current == generation else { return }
            decisions = list.decisions
            state = .loaded
        } catch {
            guard current == generation else { return }
            state = decisions.isEmpty ? .failed(error.message) : .loaded
        }
    }

    @discardableResult
    public func create(id: String, type: DecisionType, title: String) async throws(APIError) -> DecisionSummary {
        let body = CreateDecisionRequest(id: id, type: type, title: title.trimmingCharacters(in: .whitespacesAndNewlines))
        let summary = try await backend.send(API.createDecision(body: body))
        decisions.removeAll { $0.id == summary.id }
        decisions.insert(summary, at: 0)
        return summary
    }

    public func loadDetail(_ id: String) async throws(APIError) {
        apply(try await backend.send(API.getDecision(id: id)))
    }

    @discardableResult
    public func update(_ id: String, _ patch: UpdateDecisionRequest) async throws(APIError) -> DecisionDetail {
        let detail = try await backend.send(API.updateDecision(id: id, body: patch))
        apply(detail)
        return detail
    }

    public func delete(_ id: String) async throws(APIError) {
        do {
            let result = try await backend.send(API.deleteDecision(id: id))
            for restored in result.restored { details[restored] = nil }
        } catch where error.code == .notFound {
        }
        decisions.removeAll { $0.id == id }
        details[id] = nil
        await reload()
    }

    // MARK: Supersede

    public func supersedeCandidates(_ id: String) async throws(APIError) -> [DecisionRef] {
        try await backend.send(API.listSupersedeCandidates(id: id)).decisions
    }

    /// Either an existing successor or a new decision (`newId` keeps retries idempotent).
    public func supersede(_ id: String, successorId: String? = nil, newTitle: String? = nil, newId: String? = nil) async throws(APIError) -> DecisionSummary {
        let body = SupersedeDecisionRequest(successorId: successorId, newTitle: newTitle, newId: newId)
        let result = try await backend.send(API.supersedeDecision(id: id, body: body))
        apply(result.decision)
        details[result.successor.id] = nil
        await reload()
        return result.successor
    }

    // MARK: Links

    public func addLink(to decisionId: String, id: String, url: String, title: String?) async throws(APIError) {
        _ = try await backend.send(API.createDecisionLink(id: decisionId, body: CreateDecisionLinkRequest(id: id, url: url, title: Patchable(title))))
        try await loadDetail(decisionId)
    }

    public func deleteLink(_ link: DecisionLink) async throws(APIError) {
        do {
            _ = try await backend.send(API.deleteDecisionLink(id: link.id))
        } catch where error.code == .notFound {
        }
        try await loadDetail(link.decisionId)
    }

    // MARK: Linked issues and ideas

    public func relationCandidates(_ decisionId: String, query: String) async throws(APIError) -> [RelationCandidate] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await backend.send(API.listRelationCandidates(id: decisionId, query: q.isEmpty ? nil : q)).candidates
    }

    public func addRelation(to decisionId: String, _ candidate: RelationCandidate) async throws(APIError) {
        let result = try await backend.send(API.addDecisionRelation(id: decisionId, body: AddDecisionRelationRequest(kind: candidate.kind, targetId: candidate.targetId)))
        if var detail = details[decisionId] {
            detail.relations = result.relations
            details[decisionId] = detail
        }
    }

    public func removeRelation(_ relation: DecisionRelation, from decisionId: String) async throws(APIError) {
        do {
            _ = try await backend.send(API.removeDecisionRelation(id: relation.id))
        } catch where error.code == .notFound {
        }
        if var detail = details[decisionId] {
            detail.relations.removeAll { $0.id == relation.id }
            details[decisionId] = detail
        }
    }

    private func apply(_ detail: DecisionDetail) {
        details[detail.decision.id] = detail
        let d = detail.decision
        if let i = decisions.firstIndex(where: { $0.id == d.id }) {
            let preview = d.type == .experiment ? d.results : d.outcome
            decisions[i] = DecisionSummary(
                id: d.id, type: d.type, title: d.title, status: d.status, assigneeId: d.assigneeId,
                createdBy: d.createdBy, concludedOn: d.concludedOn, createdAt: d.createdAt, updatedAt: d.updatedAt,
                outcomePreview: Self.preview(preview)
            )
        }
    }

    /// Display only (the server sends the authoritative preview on reload).
    static func preview(_ text: String) -> String {
        let line = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return line.count > 180 ? String(line.prefix(179)) + "…" : line
    }

    func reset() {
        decisions = []
        details = [:]
        state = .idle
        query = Query()
    }
}
