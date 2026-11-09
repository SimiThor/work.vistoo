package de.vistoo.work.core.support

import android.content.Context
import androidx.core.content.edit
import de.vistoo.work.BuildConfig
import de.vistoo.work.core.api.ApiJson
import de.vistoo.work.core.generated.Meta
import java.net.URI

/**
 * Build-time configuration of the app (BuildConfig, set per build type in
 * app/build.gradle.kts — the counterpart of the xcconfig files in apps/ios/Config).
 *
 * Only the server URL is configured. Supabase URL and publishable key come
 * from that server's `/api/v1/meta`, so the app always uses exactly the
 * Supabase project of the backend it talks to (no mixed environments).
 */
data class AppConfiguration(
    /** Web origin, e.g. https://workvistoo.vercel.app (also used for share links). */
    val serverUrl: String,
    val build: Int,
    val version: String,
) {
    val apiBaseUrl: String get() = serverUrl.trimEnd('/') + "/api/v1"
    val serverHost: String? get() = runCatching { URI(serverUrl).host }.getOrNull()

    /** Shareable web link of a task (same format the web app copies). */
    fun taskLink(taskId: String, projectId: String? = null): String {
        val path = projectId?.let { "/projects/$it" } ?: "/tasks"
        return serverUrl.trimEnd('/') + path + "?task=" + taskId
    }

    fun conversationLink(conversationId: String): String = serverUrl.trimEnd('/') + "/chat/" + conversationId

    companion object {
        /** HTTPS only (localhost for development builds). */
        fun fromBuildConfig(): AppConfiguration? {
            val raw = BuildConfig.SERVER_URL.trim()
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            val ok = uri.scheme == "https" || uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2")
            if (!ok || uri.host == null) return null
            return AppConfiguration(raw.trimEnd('/'), BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)
        }
    }
}

/**
 * Non-sensitive cache of the last `/meta` answer, so the app can start offline.
 * Keyed by server URL: switching environments never mixes data.
 */
class MetaCache(context: Context) {
    private val prefs = context.getSharedPreferences("vistoo.meta", Context.MODE_PRIVATE)
    private fun key(config: AppConfiguration) = "vistoo.meta.${config.serverUrl}"

    fun load(config: AppConfiguration): Meta? =
        prefs.getString(key(config), null)?.let { runCatching { ApiJson.decodeFromString(Meta.serializer(), it) }.getOrNull() }

    fun store(meta: Meta, config: AppConfiguration) {
        prefs.edit { putString(key(config), ApiJson.encodeToString(Meta.serializer(), meta)) }
    }
}

/** Small per-device UI preferences (view mode, last project …). Never user data. */
class UiPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("vistoo.ui", Context.MODE_PRIVATE)

    fun string(key: String, default: String): String = prefs.getString(key, default) ?: default
    fun setString(key: String, value: String) = prefs.edit { putString(key, value) }
}
