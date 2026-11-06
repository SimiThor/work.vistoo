import Foundation
import Observation

/// Top-level state machine of the app.
///
///   launching → (misconfigured | outdated | signedOut | onboarding | ready)
///
/// - The environment (Supabase project) comes from the configured server's
///   /api/v1/meta; web and app therefore always share one environment.
/// - A changed session owner (sign-out, other account) discards the whole
///   SessionModel, its realtime subscriptions and downloaded files.
/// - Revoked membership (403) and expired sessions (401) are detected on any
///   request and lead back to onboarding / sign-in.
@MainActor
@Observable
public final class AppModel {
    public enum Phase: Equatable {
        case launching
        case misconfigured(String)
        case outdated
        case signedOut
        /// Signed in, but no active membership (invitation to accept, expired or none).
        case onboarding(Me)
        case ready
    }

    public private(set) var phase: Phase = .launching
    public private(set) var session: SessionModel?
    public let configuration: AppConfiguration?
    public let network = NetworkMonitor()
    /// Destination to open once the workspace is ready (resumed after sign-in).
    public var pendingLink: DeepLink?
    /// Message for the sign-in screen (e.g. an expired login link).
    public var signInNotice: String?

    @ObservationIgnored private var auth: AuthService?
    @ObservationIgnored private var anonymousAPI: APIClient?
    @ObservationIgnored private var sessionWatch: Task<Void, Never>?
    @ObservationIgnored private var backgroundedAt: Date?
    @ObservationIgnored private var lastReconnects = 0
    /// A link that arrived before the environment was ready (cold start via Universal Link).
    @ObservationIgnored private var queuedURL: URL?

    public init(configuration: AppConfiguration?) {
        self.configuration = configuration
    }

    // MARK: Start

    public func start() async {
        guard phase == .launching || phase.isMisconfigured else { return }
        guard let configuration else {
            phase = .misconfigured("Die App ist nicht konfiguriert (VistooServerURL fehlt).")
            return
        }
        TemporaryFiles.purge()
        let api = APIClient(baseURL: configuration.apiBaseURL, build: configuration.build, tokens: nil)
        anonymousAPI = api

        // Fresh meta when online, cached meta for offline starts.
        var meta: Meta
        do {
            meta = try await api.send(API.getMeta())
            if let cached = MetaCache.load(configuration), cached.supabaseUrl != meta.supabaseUrl {
                // The server now points to another Supabase project: never reuse the old session.
                TemporaryFiles.purgeAll()
            }
            MetaCache.store(meta, configuration)
        } catch {
            guard let cached = MetaCache.load(configuration) else {
                phase = .misconfigured(error.isConnectivityProblem
                    ? "Keine Verbindung. Vistoo braucht beim ersten Start eine Internetverbindung."
                    : "Der Server ist nicht erreichbar. Bitte versuche es später erneut.")
                return
            }
            meta = cached
        }
        if meta.minimumIosBuild > configuration.build {
            phase = .outdated
            return
        }
        do {
            auth = try AuthService(meta: meta)
        } catch {
            phase = .misconfigured("Die Server-Konfiguration ist ungültig.")
            return
        }
        watchSession()
        // Decide right away from the stored session (Keychain) instead of waiting
        // for the client's first auth event, which may be delayed by a token refresh.
        await sessionOwnerChanged(auth?.currentUserId)
        if let url = queuedURL {
            queuedURL = nil
            await open(url)
        }
    }

    private func watchSession() {
        guard let auth else { return }
        sessionWatch?.cancel()
        sessionWatch = Task { [weak self] in
            for await userId in auth.sessionUserChanges() {
                await self?.sessionOwnerChanged(userId)
            }
        }
    }

    private func sessionOwnerChanged(_ userId: String?) async {
        if session?.userId != nil, session?.userId != userId {
            await tearDownSession()
        }
        guard userId != nil else {
            phase = .signedOut
            return
        }
        if userId == session?.userId, phase == .ready { return }
        await refreshAccess()
    }

    @ObservationIgnored private var accessCheck: Task<Void, Never>?

    /// Decides between workspace, invitation and "no access" (same rule as web /invite).
    /// Concurrent calls (start, auth events, 403s) share one check.
    public func refreshAccess() async {
        if let running = accessCheck { return await running.value }
        let check = Task { await performAccessCheck() }
        accessCheck = check
        await check.value
        accessCheck = nil
    }

    private func performAccessCheck() async {
        guard let auth, let configuration else { return }
        let api = APIClient(baseURL: configuration.apiBaseURL, build: configuration.build, tokens: auth)
        let backend = Backend(api: api, configuration: configuration) { [weak self] error in
            self?.handleSessionError(error)
        }
        do {
            let me = try await api.send(API.getMe())
            guard me.access == .member else {
                await tearDownSession()
                phase = .onboarding(me)
                return
            }
            if session?.userId == me.userId, phase == .ready { return }
            let bootstrap = try await api.send(API.getBootstrap())
            let model = SessionModel(bootstrap: bootstrap, backend: backend, auth: auth)
            await tearDownSession()
            session = model
            phase = .ready
            await model.start()
            await setUpPush()
        } catch {
            switch error.code {
            case .unauthenticated?: await signOut()
            case .clientOutdated?: phase = .outdated
            default:
                // Offline etc.: keep the current phase if we have data; otherwise show sign-in with a note.
                if session == nil {
                    signInNotice = error.message
                    if phase == .launching { phase = .signedOut }
                }
            }
        }
    }

    private func handleSessionError(_ error: APIError) {
        switch error.code {
        case .clientOutdated?:
            phase = .outdated
        case .unauthenticated?:
            Task { await signOut() }
        case .forbidden?:
            // Either an admin-only action or revoked membership: /me tells which.
            Task { await refreshAccess() }
        default:
            break
        }
    }

    // MARK: Sign-in

    public func requestCode(email: String) async throws(APIError) {
        guard let anonymousAPI else { throw APIError.invalidResponse }
        _ = try await anonymousAPI.send(API.requestLoginCode(body: LoginCodeRequest(email: email)))
    }

    /// Returns an error message, or nil on success (the session watcher continues).
    public func verify(email: String, code: String) async -> String? {
        guard let auth else { return "Die App ist nicht bereit." }
        do {
            try await auth.verify(email: email, code: code)
            signInNotice = nil
            return nil
        } catch .offline {
            return "Keine Verbindung. Bitte versuche es erneut."
        } catch .notStored {
            return "Die Anmeldung konnte auf diesem Gerät nicht gespeichert werden. Bitte fordere einen neuen Code an."
        } catch {
            return "Der Code ist ungültig oder abgelaufen."
        }
    }

    public func acceptInvitation(_ invitationId: String, fullName: String) async -> APIError? {
        guard let auth, let configuration else { return APIError.invalidResponse }
        let api = APIClient(baseURL: configuration.apiBaseURL, build: configuration.build, tokens: auth)
        do {
            _ = try await api.send(API.acceptInvitation(body: AcceptInvitationRequest(invitationId: invitationId, fullName: fullName)))
            await refreshAccess()
            return nil
        } catch {
            return error
        }
    }

    public func signOut() async {
        // Stop pushes for this account before the session (and its token) is gone.
        if let token = PushCenter.shared.deviceToken, let auth, let configuration {
            let api = APIClient(baseURL: configuration.apiBaseURL, build: configuration.build, tokens: auth)
            _ = try? await api.send(API.unregisterDevice(token: token))
        }
        await tearDownSession()
        await auth?.signOut()
        phase = .signedOut
    }

    private func tearDownSession() async {
        guard let current = session else { return }
        session = nil
        pendingLink = nil
        await current.stop()
        TemporaryFiles.purgeAll()
    }

    // MARK: Push

    /// Asks for permission once after the first sign-in, then registers the device.
    private func setUpPush() async {
        let push = PushCenter.shared
        await push.refreshAuthorization()
        if push.authorization == .notDetermined { await push.requestAuthorization() }
        await pushTokenChanged()
    }

    /// iOS delivered (or renewed) the APNs token.
    public func pushTokenChanged() async {
        guard let token = PushCenter.shared.deviceToken, let session, phase == .ready else { return }
        await session.registerDevice(token)
    }

    /// A notification was tapped.
    public func notificationTapped() {
        guard let link = PushCenter.shared.tappedLink else { return }
        PushCenter.shared.tappedLink = nil
        pendingLink = link
    }

    // MARK: Links

    /// Universal Links: login links and shared web links of this server.
    public func open(_ url: URL) async {
        guard let auth, let configuration else {
            queuedURL = url
            return
        }
        do {
            if try await auth.handleLoginLink(url) {
                signInNotice = nil
                return
            }
        } catch .offline {
            signInNotice = "Keine Verbindung. Bitte öffne den Link erneut, sobald du online bist."
            return
        } catch {
            signInNotice = "Der Anmeldelink ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Code an."
            return
        }
        if let link = DeepLink(url: url, server: configuration.serverURL) {
            pendingLink = link
        }
    }

    // MARK: Lifecycle

    public func scenePhaseChanged(isActive: Bool) async {
        guard let session else { return }
        if isActive {
            let away = backgroundedAt.map { Date.now.timeIntervalSince($0) } ?? 0
            backgroundedAt = nil
            if away > 0 {
                await session.resume()
                // Access may have changed while away (removed, role changed).
                if away > 60 { await refreshAccess() }
            }
        } else if backgroundedAt == nil {
            backgroundedAt = .now
            await session.suspend()
        }
    }

    /// Connection restored: reload what may have been missed.
    public func networkChanged() async {
        guard network.reconnects != lastReconnects else { return }
        lastReconnects = network.reconnects
        if let session { await session.resume() } else if phase.isMisconfigured { phase = .launching; await start() }
    }

    public func retryStart() async {
        phase = .launching
        await start()
    }
}

extension AppModel.Phase {
    var isMisconfigured: Bool {
        if case .misconfigured = self { return true }
        return false
    }
}
