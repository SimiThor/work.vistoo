package de.vistoo.work.core.auth

import android.net.Uri
import android.util.Log
import de.vistoo.work.core.api.AccessTokenProvider
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.ApiJson
import de.vistoo.work.core.api.Http
import de.vistoo.work.core.api.await
import de.vistoo.work.core.generated.Meta
import java.io.IOException
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Stored Supabase session (access + refresh token). */
@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    /** Epoch seconds. */
    @SerialName("expires_at") val expiresAt: Long = 0,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    val user: AuthUser,
)

@Serializable
data class AuthUser(val id: String, val email: String? = null)

/**
 * Supabase Auth for the app: e-mail one-time codes and login links — the same
 * flow as iOS (supabase-swift), implemented against the Auth REST API.
 *
 * - The session lives encrypted in [SecureSessionStore], never in logs.
 * - Tokens are refreshed on demand (a minute before expiry); API calls get them
 *   via [AccessTokenProvider]. Realtime joins with the same user token, so RLS
 *   decides what is delivered.
 */
class AuthService(
    meta: Meta,
    private val store: SecureSessionStore,
    private val http: OkHttpClient = Http.client,
) : AccessTokenProvider {
    val supabaseUrl: String = meta.supabaseUrl.trimEnd('/')
    val publishableKey: String = meta.supabasePublishableKey
    private val storageKey: String

    private val mutex = Mutex()
    private val session = MutableStateFlow<AuthSession?>(null)

    init {
        val host = runCatching { URI(supabaseUrl).host }.getOrNull() ?: throw ApiError.invalidResponse
        if (!supabaseUrl.startsWith("http")) throw ApiError.invalidResponse
        storageKey = "vistoo-$host"
        session.value = store.load(storageKey)?.let { runCatching { ApiJson.decodeFromString(AuthSession.serializer(), it) }.getOrNull() }
    }

    /** Lower-cased user id of the stored session (the same format the API uses). */
    val currentUserId: String? get() = session.value?.user?.id?.lowercase()

    /** Emits the user id whenever the session appears, changes owner or ends. */
    fun sessionUserChanges(): Flow<String?> = session.map { it?.user?.id?.lowercase() }.distinctUntilChanged()

    // MARK: AccessTokenProvider

    override suspend fun accessToken(): String? {
        val current = session.value ?: return null
        val now = System.currentTimeMillis() / 1000
        if (current.expiresAt > now + 60) return current.accessToken
        return refresh(current.refreshToken)?.accessToken
    }

    override suspend fun refreshedAccessToken(): String? {
        val current = session.value ?: return null
        return refresh(current.refreshToken, force = true)?.accessToken
    }

    /**
     * One refresh at a time (refresh tokens are single-use). A rejected refresh
     * token ends the session; a connectivity problem keeps it (offline is not a sign-out).
     */
    private suspend fun refresh(refreshToken: String, force: Boolean = false): AuthSession? = mutex.withLock {
        val current = session.value ?: return null
        // Another caller refreshed meanwhile.
        if (current.refreshToken != refreshToken && (!force || current.expiresAt > System.currentTimeMillis() / 1000 + 60)) {
            return current
        }
        val body = buildJsonObject { put("refresh_token", JsonPrimitive(current.refreshToken)) }
        when (val result = post("/token?grant_type=refresh_token", body)) {
            is AuthResult.Success -> adopt(result.session)
            is AuthResult.Rejected -> {
                Log.i(TAG, "refresh rejected: ${result.errorCode}")
                clear()
                null
            }
            AuthResult.Offline -> throw ApiError.offline()
        }
    }

    // MARK: Sign-in

    enum class SignInError { InvalidCode, InvalidLink, Offline, NotStored }

    class SignInException(val reason: SignInError) : Exception(reason.name)

    /**
     * Verifies the 6-digit code from the e-mail. Invited, not yet confirmed
     * accounts receive an invitation code, which Supabase verifies as `invite`.
     */
    suspend fun verify(email: String, code: String) {
        val trimmed = code.filter { it.isDigit() }
        for (type in listOf("email", "invite")) {
            val body = buildJsonObject {
                put("email", JsonPrimitive(email))
                put("token", JsonPrimitive(trimmed))
                put("type", JsonPrimitive(type))
            }
            when (val result = post("/verify", body)) {
                is AuthResult.Success -> {
                    if (adopt(result.session) == null) throw SignInException(SignInError.NotStored)
                    return
                }
                is AuthResult.Rejected -> {
                    Log.i(TAG, "verify($type) rejected: ${result.errorCode}")
                    continue
                }
                AuthResult.Offline -> throw SignInException(SignInError.Offline)
            }
        }
        throw SignInException(SignInError.InvalidCode)
    }

    /**
     * Handles `https://<server>/auth/ios/confirm?token_hash=…&type=…` (the login link of
     * the e-mail; Android opens it as an App Link). Returns false if the URL is not a login link.
     */
    suspend fun handleLoginLink(uri: Uri): Boolean {
        if (uri.path?.endsWith("/auth/ios/confirm") != true) return false
        val hash = uri.getQueryParameter("token_hash")
        val type = uri.getQueryParameter("type")
        if (hash.isNullOrBlank() || type !in setOf("email", "magiclink", "invite", "signup", "recovery", "email_change")) {
            throw SignInException(SignInError.InvalidLink)
        }
        val body = buildJsonObject {
            put("token_hash", JsonPrimitive(hash))
            put("type", JsonPrimitive(type))
        }
        when (val result = post("/verify", body)) {
            is AuthResult.Success -> {
                if (adopt(result.session) == null) throw SignInException(SignInError.NotStored)
                return true
            }
            // Expired, already used or for another account.
            is AuthResult.Rejected -> throw SignInException(SignInError.InvalidLink)
            AuthResult.Offline -> throw SignInException(SignInError.Offline)
        }
    }

    /** Signs out on this device only (the web session stays). Removes the stored session. */
    suspend fun signOut() {
        val token = session.value?.accessToken
        clear()
        if (token != null) {
            runCatching {
                val request = Request.Builder().url("$supabaseUrl/auth/v1/logout?scope=local")
                    .header("apikey", publishableKey)
                    .header("Authorization", "Bearer $token")
                    .post("{}".toRequestBody(JSON))
                    .build()
                http.newCall(request).await().close()
            }
        }
    }

    // MARK: Internals

    private sealed interface AuthResult {
        data class Success(val session: AuthSession) : AuthResult
        data class Rejected(val errorCode: String?) : AuthResult
        data object Offline : AuthResult
    }

    private suspend fun post(path: String, body: JsonObject): AuthResult {
        val request = Request.Builder().url("$supabaseUrl/auth/v1$path")
            .header("apikey", publishableKey)
            .header("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON))
            .build()
        return try {
            http.newCall(request).await().use { response ->
                val text = withContext(Dispatchers.IO) { response.body?.string().orEmpty() }
                if (response.isSuccessful) {
                    val s = runCatching { ApiJson.decodeFromString(AuthSession.serializer(), text) }.getOrNull()
                    if (s != null) AuthResult.Success(s) else AuthResult.Rejected("invalid_response")
                } else if (response.code >= 500) {
                    AuthResult.Offline
                } else {
                    val code = runCatching { ApiJson.parseToJsonElement(text) as? JsonObject }.getOrNull()
                        ?.let { (it["error_code"] ?: it["error"])?.toString()?.trim('"') }
                    AuthResult.Rejected(code)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: IOException) {
            AuthResult.Offline
        }
    }

    private fun adopt(new: AuthSession): AuthSession? {
        val withExpiry = if (new.expiresAt > 0) new else new.copy(expiresAt = System.currentTimeMillis() / 1000 + new.expiresIn)
        return try {
            store.save(storageKey, ApiJson.encodeToString(AuthSession.serializer(), withExpiry))
            session.value = withExpiry
            withExpiry
        } catch (e: Exception) {
            Log.e(TAG, "session not stored: ${e.javaClass.simpleName}")
            null
        }
    }

    private fun clear() {
        store.remove(storageKey)
        session.value = null
    }

    private companion object {
        const val TAG = "auth"
        val JSON = "application/json".toMediaType()
    }
}
