import Foundation
import Observation

/// CRM: potential partner attractions and their timelines. Status, owner and
/// follow-up changes are logged by the server in the same transaction.
@MainActor
@Observable
public final class CRMStore {
    public private(set) var attractions: [Attraction] = []
    public private(set) var activities: [String: [Activity]] = [:]
    public private(set) var state: LoadState = .idle

    private let backend: Backend

    init(backend: Backend) {
        self.backend = backend
    }

    public func attraction(_ id: String) -> Attraction? { attractions.first { $0.id == id } }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            attractions = try await backend.send(API.listAttractions()).attractions
            state = .loaded
        } catch {
            state = attractions.isEmpty ? .failed(error.message) : .loaded
        }
    }

    @discardableResult
    public func create(_ body: CreateAttractionRequest) async throws(APIError) -> Attraction {
        let attraction = try await backend.send(API.createAttraction(body: body))
        upsert(attraction)
        return attraction
    }

    @discardableResult
    public func update(_ id: String, _ patch: UpdateAttractionRequest) async throws(APIError) -> Attraction {
        let attraction = try await backend.send(API.updateAttraction(id: id, body: patch))
        upsert(attraction)
        // The server may have added a timeline entry.
        if activities[id] != nil { await loadActivities(id) }
        return attraction
    }

    public func delete(_ attraction: Attraction) async throws(APIError) {
        let previous = attractions
        attractions.removeAll { $0.id == attraction.id }
        do {
            _ = try await backend.send(API.deleteAttraction(id: attraction.id))
        } catch where error.code == .notFound {
        } catch {
            attractions = previous
            throw error
        }
        activities[attraction.id] = nil
    }

    // MARK: Timeline

    public func loadActivities(_ attractionId: String) async {
        guard let list = try? await backend.send(API.listActivities(id: attractionId)) else { return }
        activities[attractionId] = list.activities
    }

    public func addActivity(
        to attractionId: String,
        id: String,
        type: ActivityType,
        description: String,
        occurredAt: Date,
        nextFollowUp: Patchable<CalendarDate>
    ) async throws(APIError) {
        let body = CreateActivityRequest(
            id: id,
            type: .init(rawValue: type.rawValue),
            description: description,
            occurredAt: occurredAt,
            nextFollowUp: nextFollowUp
        )
        let change = try await backend.send(API.addActivity(id: attractionId, body: body))
        upsert(change.attraction)
        await loadActivities(attractionId)
    }

    public func updateActivity(_ activity: Activity, type: ActivityType, description: String, occurredAt: Date) async throws(APIError) {
        let body = UpdateActivityRequest(type: .init(rawValue: type.rawValue), description: description, occurredAt: occurredAt)
        let change = try await backend.send(API.updateActivity(id: activity.id, body: body))
        upsert(change.attraction)
        await loadActivities(activity.attractionId)
    }

    public func deleteActivity(_ activity: Activity) async throws(APIError) {
        do {
            let result = try await backend.send(API.deleteActivity(id: activity.id))
            upsert(result.attraction)
        } catch where error.code == .notFound {
        }
        await loadActivities(activity.attractionId)
    }

    private func upsert(_ attraction: Attraction) {
        if let i = attractions.firstIndex(where: { $0.id == attraction.id }) {
            attractions[i] = attraction
        } else {
            attractions.append(attraction)
            attractions.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
    }

    func reset() {
        attractions = []
        activities = [:]
        state = .idle
    }
}
