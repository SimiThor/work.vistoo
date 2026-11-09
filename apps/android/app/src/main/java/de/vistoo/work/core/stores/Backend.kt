package de.vistoo.work.core.stores

import android.net.Uri
import de.vistoo.work.core.api.ApiClient
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Endpoint
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.support.AppConfiguration

/**
 * What every store needs to talk to the server. Errors that concern the whole
 * session (revoked access, expired session, outdated app) are reported to the
 * app model, which then tears the session down or asks for an update.
 */
class Backend(
    val api: ApiClient,
    val configuration: AppConfiguration,
    private val report: (ApiError) -> Unit,
) {
    suspend fun <R> send(endpoint: Endpoint<R>): R {
        try {
            return api.send(endpoint)
        } catch (error: ApiError) {
            when (error.code) {
                ErrorCode.Unauthenticated, ErrorCode.Forbidden, ErrorCode.ClientOutdated -> report(error)
                else -> Unit
            }
            throw error
        }
    }
}

/** Loading state of a screen's data. */
sealed interface LoadState {
    data object Idle : LoadState
    data object Loading : LoadState
    data object Loaded : LoadState
    data class Failed(val message: String) : LoadState
}

/** Destinations reachable by link (App Links; notifications in the future). */
sealed interface DeepLink {
    data class Task(val id: String, val projectId: String?) : DeepLink
    data class Project(val id: String) : DeepLink
    data class Conversation(val id: String) : DeepLink

    companion object {
        private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private fun isId(s: String?) = s != null && uuid.matches(s)

        /** Parses web URLs of the same server: /tasks?task=…, /projects/<id>[?task=…], /chat/<id>. */
        fun parse(uri: Uri, serverHost: String?): DeepLink? {
            if (uri.host == null || uri.host != serverHost) return null
            val parts = uri.pathSegments
            val task = uri.getQueryParameter("task")
            return when (parts.firstOrNull()) {
                "tasks" -> if (isId(task)) Task(task!!.lowercase(), null) else null
                "projects" -> {
                    val id = parts.getOrNull(1)
                    if (!isId(id)) null else if (isId(task)) Task(task!!.lowercase(), id!!.lowercase()) else Project(id!!.lowercase())
                }
                "chat" -> parts.getOrNull(1)?.takeIf { isId(it) }?.let { Conversation(it.lowercase()) }
                else -> null
            }
        }
    }
}
