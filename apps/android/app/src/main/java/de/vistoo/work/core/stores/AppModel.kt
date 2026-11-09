package de.vistoo.work.core.stores

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.api.ApiClient
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.auth.AuthService
import de.vistoo.work.core.auth.SecureSessionStore
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.AcceptInvitationRequest
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.LoginCodeRequest
import de.vistoo.work.core.generated.Me
import de.vistoo.work.core.generated.Meta
import de.vistoo.work.core.support.AppConfiguration
import de.vistoo.work.core.support.MetaCache
import de.vistoo.work.core.support.NetworkMonitor
import de.vistoo.work.core.support.TemporaryFiles
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/**
 * Top-level state machine of the app (port of the iOS `AppModel`).
 *
 *   launching → (misconfigured | outdated | signedOut | onboarding | ready)
 *
 * - The environment (Supabase project) comes from the configured server's
 *   /api/v1/meta; web and app therefore always share one environment.
 * - A changed session owner (sign-out, other account) discards the whole
 *   SessionModel, its realtime subscriptions and downloaded files.
 * - Revoked membership (403) and expired sessions (401) are detected on any
 *   request and lead back to onboarding / sign-in.
 */
class AppModel(
    context: Context,
    val configuration: AppConfiguration?,
    private val scope: CoroutineScope,
) {
    sealed interface Phase {
        data object Launching : Phase
        data class Misconfigured(val message: String) : Phase
        data object Outdated : Phase
        data object SignedOut : Phase

        /** Signed in, but no active membership (invitation to accept, expired or none). */
        data class Onboarding(val me: Me) : Phase
        data object Ready : Phase
    }

    var phase by mutableStateOf<Phase>(Phase.Launching)
        private set
    var session by mutableStateOf<SessionModel?>(null)
        private set
    val network = NetworkMonitor(context)

    /** Destination to open once the workspace is ready (resumed after sign-in). */
    var pendingLink by mutableStateOf<DeepLink?>(null)

    /** Message for the sign-in screen (e.g. an expired login link). */
    var signInNotice by mutableStateOf<String?>(null)

    private val metaCache = MetaCache(context)
    private val sessionStore = SecureSessionStore(context)
    private var auth: AuthService? = null
    private var anonymousAPI: ApiClient? = null
    private var sessionWatch: Job? = null
    private var backgroundedAt: Long? = null
    private var lastReconnects = 0
    private var accessCheck: Deferred<Unit>? = null

    /** A link that arrived before the environment was ready (cold start via App Link). */
    private var queuedUri: Uri? = null

    // MARK: Start

    suspend fun start() {
        if (phase != Phase.Launching && phase !is Phase.Misconfigured) return
        val configuration = configuration ?: run {
            phase = Phase.Misconfigured("Die App ist nicht konfiguriert (Server-Adresse fehlt).")
            return
        }
        TemporaryFiles.purge()
        val api = ApiClient(configuration.apiBaseUrl, configuration.build, tokens = null)
        anonymousAPI = api

        // Fresh meta when online, cached meta for offline starts.
        val meta: Meta = try {
            val fresh = api.send(API.getMeta())
            val cached = metaCache.load(configuration)
            if (cached != null && cached.supabaseUrl != fresh.supabaseUrl) {
                // The server now points to another Supabase project: never reuse the old session.
                TemporaryFiles.purgeAll()
            }
            metaCache.store(fresh, configuration)
            fresh
        } catch (e: ApiError) {
            metaCache.load(configuration) ?: run {
                phase = Phase.Misconfigured(
                    if (e.isConnectivityProblem) "Keine Verbindung. Vistoo braucht beim ersten Start eine Internetverbindung."
                    else "Der Server ist nicht erreichbar. Bitte versuche es später erneut.",
                )
                return
            }
        }
        // `minimumIosBuild` gates iOS builds only; Android builds are not version-gated (yet).
        auth = try {
            AuthService(meta, sessionStore)
        } catch (_: Exception) {
            phase = Phase.Misconfigured("Die Server-Konfiguration ist ungültig.")
            return
        }
        watchSession()
        // Decide right away from the stored session instead of waiting for the first emission.
        sessionOwnerChanged(auth?.currentUserId)
        queuedUri?.let {
            queuedUri = null
            open(it)
        }
    }

    private fun watchSession() {
        val auth = auth ?: return
        sessionWatch?.cancel()
        sessionWatch = scope.launch {
            auth.sessionUserChanges().collect { sessionOwnerChanged(it) }
        }
    }

    private suspend fun sessionOwnerChanged(userId: String?) {
        if (session?.userId != null && session?.userId != userId) tearDownSession()
        if (userId == null) {
            phase = Phase.SignedOut
            return
        }
        if (userId == session?.userId && phase == Phase.Ready) return
        refreshAccess()
    }

    /**
     * Decides between workspace, invitation and "no access" (same rule as web /invite).
     * Concurrent calls (start, auth events, 403s) share one check.
     */
    suspend fun refreshAccess() {
        accessCheck?.let { return it.await() }
        val check = scope.async { performAccessCheck() }
        accessCheck = check
        try {
            check.await()
        } finally {
            accessCheck = null
        }
    }

    private fun authorizedApi(): ApiClient? {
        val auth = auth ?: return null
        val configuration = configuration ?: return null
        return ApiClient(configuration.apiBaseUrl, configuration.build, tokens = auth)
    }

    private suspend fun performAccessCheck() {
        val auth = auth ?: return
        val configuration = configuration ?: return
        val api = authorizedApi() ?: return
        val backend = Backend(api, configuration) { handleSessionError(it) }
        try {
            val me = api.send(API.getMe())
            if (me.access != Me.Access.Member) {
                tearDownSession()
                phase = Phase.Onboarding(me)
                return
            }
            if (session?.userId == me.userId && phase == Phase.Ready) return
            val bootstrap = api.send(API.getBootstrap())
            val model = SessionModel(bootstrap, backend, auth)
            tearDownSession()
            session = model
            phase = Phase.Ready
            model.start()
        } catch (e: ApiError) {
            when (e.code) {
                ErrorCode.Unauthenticated -> signOut()
                ErrorCode.ClientOutdated -> phase = Phase.Outdated
                else -> {
                    // Offline etc.: keep the current phase if we have data; otherwise show sign-in with a note.
                    if (session == null) {
                        signInNotice = e.message
                        if (phase == Phase.Launching) phase = Phase.SignedOut
                    }
                }
            }
        }
    }

    private fun handleSessionError(error: ApiError) {
        when (error.code) {
            ErrorCode.ClientOutdated -> phase = Phase.Outdated
            ErrorCode.Unauthenticated -> scope.launch { signOut() }
            // Either an admin-only action or revoked membership: /me tells which.
            ErrorCode.Forbidden -> scope.launch { refreshAccess() }
            else -> Unit
        }
    }

    // MARK: Sign-in

    suspend fun requestCode(email: String) {
        val api = anonymousAPI ?: throw ApiError.invalidResponse
        api.send(API.requestLoginCode(body = LoginCodeRequest(email = email)))
    }

    /** Returns an error message, or null on success (the session watcher continues). */
    suspend fun verify(email: String, code: String): String? {
        val auth = auth ?: return "Die App ist nicht bereit."
        return try {
            auth.verify(email, code)
            signInNotice = null
            null
        } catch (e: AuthService.SignInException) {
            when (e.reason) {
                AuthService.SignInError.Offline -> "Keine Verbindung. Bitte versuche es erneut."
                AuthService.SignInError.NotStored -> "Die Anmeldung konnte auf diesem Gerät nicht gespeichert werden. Bitte fordere einen neuen Code an."
                else -> "Der Code ist ungültig oder abgelaufen."
            }
        }
    }

    suspend fun acceptInvitation(invitationId: String, fullName: String): ApiError? {
        val api = authorizedApi() ?: return ApiError.invalidResponse
        return try {
            api.send(API.acceptInvitation(body = AcceptInvitationRequest(invitationId = invitationId, fullName = fullName)))
            refreshAccess()
            null
        } catch (e: ApiError) {
            e
        }
    }

    suspend fun signOut() {
        tearDownSession()
        auth?.signOut()
        phase = Phase.SignedOut
    }

    private fun tearDownSession() {
        val current = session ?: return
        session = null
        pendingLink = null
        current.stop()
        TemporaryFiles.purgeAll()
    }

    // MARK: Links

    /** App Links: login links and shared web links of this server. */
    suspend fun open(uri: Uri) {
        val auth = auth
        val configuration = configuration
        if (auth == null || configuration == null) {
            queuedUri = uri
            return
        }
        try {
            if (auth.handleLoginLink(uri)) {
                signInNotice = null
                return
            }
        } catch (e: AuthService.SignInException) {
            signInNotice = if (e.reason == AuthService.SignInError.Offline) {
                "Keine Verbindung. Bitte öffne den Link erneut, sobald du online bist."
            } else {
                "Der Anmeldelink ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Code an."
            }
            return
        }
        DeepLink.parse(uri, configuration.serverHost)?.let { pendingLink = it }
    }

    // MARK: Lifecycle

    suspend fun foregroundChanged(isActive: Boolean) {
        val session = session ?: return
        if (isActive) {
            val away = backgroundedAt?.let { System.currentTimeMillis() - it } ?: 0
            backgroundedAt = null
            if (away > 0) {
                session.resume()
                // Access may have changed while away (removed, role changed).
                if (away > 60_000) refreshAccess()
            }
        } else if (backgroundedAt == null) {
            backgroundedAt = System.currentTimeMillis()
            session.suspend()
        }
    }

    /** Connection restored: reload what may have been missed. */
    suspend fun networkChanged() {
        if (network.reconnects == lastReconnects) return
        lastReconnects = network.reconnects
        val s = session
        if (s != null) {
            s.resume()
        } else if (phase is Phase.Misconfigured) {
            phase = Phase.Launching
            start()
        }
    }

    suspend fun retryStart() {
        phase = Phase.Launching
        start()
    }
}
