package de.vistoo.work.core.api

import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.ErrorResponse
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** Supplies (and refreshes) the Supabase access token for API calls. */
interface AccessTokenProvider {
    /** A currently valid access token, refreshed if needed; null when signed out. */
    suspend fun accessToken(): String?

    /** Forces a refresh after the server rejected the token. */
    suspend fun refreshedAccessToken(): String?
}

/** Shared OkHttp client. No HTTP cache: user data must never land in a shared cache. */
object Http {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .cache(null)
            .build()
    }

    /** Uploads/downloads of attachments may take longer than API calls. */
    val transfer: OkHttpClient by lazy {
        client.newBuilder().readTimeout(120, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
    }
}

/** Suspends until the call completes; cancelling the coroutine cancels the call. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }
    })
}

/** HTTP client for /api/v1. Stateless apart from configuration; safe to share. */
class ApiClient(
    /** e.g. https://workvistoo.vercel.app/api/v1 */
    val baseUrl: String,
    build: Int,
    private val tokens: AccessTokenProvider?,
    private val http: OkHttpClient = Http.client,
) {
    /** `X-Vistoo-Client: android/<build>` (the server version-gates iOS builds only). */
    private val clientHeader = "android/$build"

    suspend fun <R> send(endpoint: Endpoint<R>): R {
        var attempt = 0
        var refreshed = false
        while (true) {
            attempt++
            try {
                return perform(endpoint, forceRefresh = refreshed)
            } catch (error: ApiError) {
                // Expired token: refresh once, then repeat.
                if (error.code == ErrorCode.Unauthenticated && endpoint.auth != AuthLevel.Anonymous && !refreshed && tokens != null) {
                    refreshed = true
                    continue
                }
                // Transport failure on a request that may be repeated safely.
                if (error.isConnectivityProblem && endpoint.retry.allowsAutomaticRetry && attempt < 3) {
                    delay(400L * attempt)
                    continue
                }
                throw error
            }
        }
    }

    private suspend fun <R> perform(endpoint: Endpoint<R>, forceRefresh: Boolean): R {
        val url = try {
            val builder = (baseUrl.trimEnd('/') + endpoint.path).toHttpUrl().newBuilder()
            for ((k, v) in endpoint.query) builder.addQueryParameter(k, v)
            builder.build()
        } catch (_: IllegalArgumentException) {
            throw ApiError.invalidResponse
        }
        val request = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("X-Vistoo-Client", clientHeader)
        if (endpoint.auth != AuthLevel.Anonymous) {
            val token = if (forceRefresh) tokens?.refreshedAccessToken() else tokens?.accessToken()
            token ?: throw ApiError(ApiError.Kind.Server(ErrorCode.Unauthenticated), "Bitte melde dich an.", 401)
            request.header("Authorization", "Bearer $token")
        }
        val body = endpoint.body?.let { ApiJson.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), it) }
        val requestBody = when {
            body != null -> body.toRequestBody(JSON)
            endpoint.method == HttpMethod.GET -> null
            else -> "{}".toRequestBody(JSON).takeIf { endpoint.method != HttpMethod.DELETE }
        }
        request.method(endpoint.method.name, requestBody)

        val (status, text) = try {
            http.newCall(request.build()).await().use { response ->
                response.code to withContext(Dispatchers.IO) { response.body?.string().orEmpty() }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw ApiError.from(e)
        }

        if (status !in 200..299) {
            val envelope = runCatching { ApiJson.decodeFromString(ErrorResponse.serializer(), text) }.getOrNull()
            if (envelope != null) {
                val e = envelope.error
                throw ApiError(ApiError.Kind.Server(e.code), e.message, status, e.fieldErrors.orEmpty(), e.current)
            }
            throw ApiError(ApiError.Kind.Server(ErrorCode.Internal), ApiError.invalidResponse.message, status)
        }
        val serializer = endpoint.response
        @Suppress("UNCHECKED_CAST")
        if (serializer == null) return NoContent as R
        return try {
            withContext(Dispatchers.Default) { ApiJson.decodeFromString(serializer, text) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("api", "decoding ${endpoint.path} failed: ${e.message}")
            throw ApiError.invalidResponse
        }
    }

    companion object {
        val JSON = "application/json".toMediaType()
    }
}
