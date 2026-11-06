import Foundation

/// Every failure of an API call, with a German user-facing message.
public struct APIError: Error, Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// No network connection: nothing was (provably) stored.
        case offline
        /// Connection broke during the request: the server MAY have applied it.
        case interrupted
        /// The server answered with an error body.
        case server(ErrorCode)
        /// Unexpected response format (contract mismatch or proxy page).
        case invalidResponse
        case cancelled
    }

    public let kind: Kind
    public let message: String
    public let status: Int?
    public let fieldErrors: [String: String]
    /// For task CONFLICTs: the current server state.
    public let currentTask: TaskItem?

    public init(kind: Kind, message: String, status: Int? = nil, fieldErrors: [String: String] = [:], currentTask: TaskItem? = nil) {
        self.kind = kind
        self.message = message
        self.status = status
        self.fieldErrors = fieldErrors
        self.currentTask = currentTask
    }

    public var code: ErrorCode? {
        if case .server(let code) = kind { return code }
        return nil
    }

    public var isConnectivityProblem: Bool { kind == .offline || kind == .interrupted }

    static func from(urlError: URLError) -> APIError {
        switch urlError.code {
        case .cancelled:
            return APIError(kind: .cancelled, message: "Abgebrochen.")
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed:
            return APIError(kind: .offline, message: "Keine Verbindung. Bitte prüfe dein Netzwerk und versuche es erneut.")
        default:
            return APIError(
                kind: .interrupted,
                message: "Die Verbindung wurde unterbrochen. Bitte versuche es erneut."
            )
        }
    }

    static let invalidResponse = APIError(kind: .invalidResponse, message: "Unerwartete Antwort vom Server. Bitte versuche es später erneut.")
}

/// Standard HTTP status for unknown error codes (mirrors the contract).
extension ErrorCode {
    var isAuthentication: Bool { self == .unauthenticated }
}
