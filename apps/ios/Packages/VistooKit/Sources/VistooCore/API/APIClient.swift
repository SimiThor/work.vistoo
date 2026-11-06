import Foundation

/// Supplies (and refreshes) the Supabase access token for API calls.
public protocol AccessTokenProvider: Sendable {
    /// A currently valid access token, refreshed if needed; nil when signed out.
    func accessToken() async -> String?
    /// Forces a refresh after the server rejected the token.
    func refreshedAccessToken() async -> String?
}

/// HTTP client for /api/v1. Stateless apart from configuration; safe to share.
public final class APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let tokens: (any AccessTokenProvider)?
    private let clientHeader: String

    /// - Parameters:
    ///   - baseURL: e.g. https://workvistoo.vercel.app/api/v1
    ///   - build: app build number (sent as `X-Vistoo-Client: ios/<build>` for version gating).
    public init(baseURL: URL, build: Int, tokens: (any AccessTokenProvider)?, session: URLSession = APIClient.makeSession()) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
        self.clientHeader = "ios/\(build)"
    }

    public static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        // User data must never land in a shared cache.
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }

    public func send<Response>(_ endpoint: Endpoint<Response>) async throws(APIError) -> Response {
        var attempt = 0
        var refreshed = false
        while true {
            attempt += 1
            do {
                return try await perform(endpoint, forceRefresh: refreshed)
            } catch let error {
                // Expired token: refresh once, then repeat.
                if error.code == .unauthenticated, endpoint.auth != .anonymous, !refreshed, tokens != nil {
                    refreshed = true
                    continue
                }
                // Transport failure on a request that may be repeated safely.
                if error.isConnectivityProblem, endpoint.retry.allowsAutomaticRetry, attempt < 3 {
                    try? await Task.sleep(for: .milliseconds(400 * attempt))
                    if Task.isCancelled { throw APIError(kind: .cancelled, message: "Abgebrochen.") }
                    continue
                }
                throw error
            }
        }
    }

    private func perform<Response>(_ endpoint: Endpoint<Response>, forceRefresh: Bool) async throws(APIError) -> Response {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(String(endpoint.path.dropFirst())), resolvingAgainstBaseURL: false)
        else { throw APIError.invalidResponse }
        if !endpoint.query.isEmpty { components.queryItems = endpoint.query }
        guard let url = components.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(clientHeader, forHTTPHeaderField: "X-Vistoo-Client")
        if endpoint.auth != .anonymous {
            let token = forceRefresh ? await tokens?.refreshedAccessToken() : await tokens?.accessToken()
            guard let token else {
                throw APIError(kind: .server(.unauthenticated), message: "Bitte melde dich an.", status: 401)
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try ISO8601.encoder().encode(body)
            } catch {
                throw APIError(kind: .invalidResponse, message: "Die Anfrage konnte nicht erstellt werden.")
            }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw APIError.from(urlError: error)
        } catch is CancellationError {
            throw APIError(kind: .cancelled, message: "Abgebrochen.")
        } catch {
            throw APIError(kind: .interrupted, message: "Die Verbindung wurde unterbrochen. Bitte versuche es erneut.")
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

        let decoder = ISO8601.decoder()
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(ErrorResponse.self, from: data) {
                let e = envelope.error
                throw APIError(
                    kind: .server(e.code),
                    message: e.message,
                    status: http.statusCode,
                    fieldErrors: e.fieldErrors ?? [:],
                    currentTask: e.current
                )
            }
            throw APIError(kind: .server(.internalValue), message: APIError.invalidResponse.message, status: http.statusCode)
        }
        if Response.self == NoContent.self, let empty = NoContent() as? Response { return empty }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            #if DEBUG
            print("[api] decoding \(Response.self) failed: \(error)")
            #endif
            throw APIError.invalidResponse
        }
    }
}
