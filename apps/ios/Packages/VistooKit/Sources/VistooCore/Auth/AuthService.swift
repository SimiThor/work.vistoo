import Foundation
import OSLog
import Supabase

private let log = Logger(subsystem: "work.vistoo", category: "auth")

/// Supabase Auth for the app: e-mail one-time codes and login links.
///
/// - Sessions (access + refresh token) live in the Keychain (supabase-swift's
///   `KeychainLocalStorage`), never in UserDefaults or logs.
/// - Tokens are refreshed automatically; API calls get them via `AccessTokenProvider`.
/// - The same Supabase client powers Realtime, which therefore always joins
///   with the user's JWT (RLS decides what is delivered).
public final class AuthService: AccessTokenProvider, @unchecked Sendable {
    // @unchecked: SupabaseClient is Sendable; the only stored properties are immutable.
    public let client: SupabaseClient
    public let supabaseURL: URL

    public init(meta: Meta) throws {
        guard let url = URL(string: meta.supabaseUrl) else { throw APIError.invalidResponse }
        supabaseURL = url
        let host = url.host ?? "supabase"
        client = SupabaseClient(
            supabaseURL: url,
            supabaseKey: meta.supabasePublishableKey,
            options: SupabaseClientOptions(
                auth: .init(
                    storage: KeychainLocalStorage(service: "work.vistoo.auth"),
                    // One Keychain entry per Supabase project: environments never share a session.
                    storageKey: "vistoo-\(host)",
                    autoRefreshToken: true,
                    emitLocalSessionAsInitialSession: true
                ),
                global: .init(session: APIClient.makeSession())
            )
        )
    }

    // MARK: AccessTokenProvider

    public func accessToken() async -> String? {
        try? await client.auth.session.accessToken
    }

    public func refreshedAccessToken() async -> String? {
        try? await client.auth.refreshSession().accessToken
    }

    /// Lower-cased user id of the stored session (the same format the API uses).
    public var currentUserId: String? {
        client.auth.currentSession?.user.id.uuidString.lowercased()
    }

    // MARK: Sign-in

    public enum SignInError: Error, Equatable {
        case invalidCode
        case invalidLink
        case offline
        /// The server accepted the code, but the session could not be stored on this device.
        case notStored
    }

    /// Verifies the 6-digit code from the e-mail. Invited, not yet confirmed
    /// accounts receive an invitation code, which Supabase verifies as `.invite`.
    public func verify(email: String, code: String) async throws(SignInError) {
        let trimmed = code.filter(\.isNumber)
        for type in [EmailOTPType.email, .invite] {
            do {
                _ = try await client.auth.verifyOTP(email: email, token: trimmed, type: type)
                return
            } catch let error as URLError where error.code == .notConnectedToInternet {
                throw .offline
            } catch AuthError.api(_, let errorCode, _, _) {
                // The server rejected the code for this type; an invitation code is checked as `.invite`.
                log.info("verify(\(type.rawValue, privacy: .public)) rejected: \(errorCode.rawValue, privacy: .public)")
                continue
            } catch {
                // Not a rejection: the code may have been accepted (and is now used up).
                log.error("verify(\(type.rawValue, privacy: .public)) failed locally: \(String(describing: error), privacy: .public)")
                if client.auth.currentSession != nil { return }
                throw .notStored
            }
        }
        throw .invalidCode
    }

    /// Handles `https://<server>/auth/ios/confirm?token_hash=…&type=…` (Universal Link).
    /// Returns false if the URL is not a login link.
    public func handleLoginLink(_ url: URL) async throws(SignInError) -> Bool {
        guard url.path.hasSuffix("/auth/ios/confirm"),
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { return false }
        guard let hash = items.first(where: { $0.name == "token_hash" })?.value,
              let rawType = items.first(where: { $0.name == "type" })?.value,
              let type = EmailOTPType(rawValue: rawType)
        else { throw .invalidLink }
        do {
            _ = try await client.auth.verifyOTP(tokenHash: hash, type: type)
            return true
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw .offline
        } catch {
            // Expired, already used or for another account.
            throw .invalidLink
        }
    }

    /// Signs out on this device only (the web session stays). Clears the Keychain entry.
    public func signOut() async {
        try? await client.auth.signOut(scope: .local)
        await client.removeAllChannels()
    }

    /// Emits the user id whenever the session appears, changes owner or ends.
    public func sessionUserChanges() -> AsyncStream<String?> {
        AsyncStream { continuation in
            let task = Task {
                for await (event, session) in client.auth.authStateChanges {
                    switch event {
                    case .initialSession, .signedIn, .signedOut, .userDeleted:
                        continuation.yield(session?.user.id.uuidString.lowercased())
                    default:
                        continue
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
