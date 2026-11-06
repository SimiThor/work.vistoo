import Foundation

/// What every store needs to talk to the server. Errors that concern the whole
/// session (revoked access, expired session, outdated app) are reported to the
/// app model, which then tears the session down or asks for an update.
public struct Backend: Sendable {
    public let api: APIClient
    public let configuration: AppConfiguration
    let report: @MainActor @Sendable (APIError) -> Void

    public init(api: APIClient, configuration: AppConfiguration, report: @escaping @MainActor @Sendable (APIError) -> Void) {
        self.api = api
        self.configuration = configuration
        self.report = report
    }

    @MainActor
    public func send<R>(_ endpoint: Endpoint<R>) async throws(APIError) -> R {
        do {
            return try await api.send(endpoint)
        } catch {
            switch error.code {
            case .unauthenticated?, .forbidden?, .clientOutdated?: report(error)
            default: break
            }
            throw error
        }
    }
}

/// Loading state of a screen's data.
public enum LoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Destinations reachable by link (Universal Links, notifications in the future).
public enum DeepLink: Equatable, Sendable {
    case task(id: String, projectId: String?)
    case project(id: String)
    case conversation(id: String)

    /// Parses web URLs of the same server: /tasks?task=…, /projects/<id>[?task=…], /chat/<id>.
    public init?(url: URL, server: URL) {
        guard url.host == server.host, let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let parts = c.path.split(separator: "/").map(String.init)
        let task = c.queryItems?.first(where: { $0.name == "task" })?.value
        let isID: (String) -> Bool = { UUID(uuidString: $0) != nil }
        switch parts.first {
        case "tasks":
            guard let task, isID(task) else { return nil }
            self = .task(id: task.lowercased(), projectId: nil)
        case "projects":
            guard parts.count >= 2, isID(parts[1]) else { return nil }
            if let task, isID(task) { self = .task(id: task.lowercased(), projectId: parts[1].lowercased()) }
            else { self = .project(id: parts[1].lowercased()) }
        case "chat":
            guard parts.count >= 2, isID(parts[1]) else { return nil }
            self = .conversation(id: parts[1].lowercased())
        default:
            return nil
        }
    }
}

/// Lower-cased UUID, the id format of the API.
public func newClientId() -> String { UUID().uuidString.lowercased() }
