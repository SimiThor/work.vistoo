package de.vistoo.work.core.support

import android.content.Context
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Http
import de.vistoo.work.core.api.await
import de.vistoo.work.core.generated.ErrorCode
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Direct upload to the signed Supabase Storage URL (bytes never pass through the API server). */
object Uploader {
    suspend fun put(data: ByteArray, signedUrl: String, contentType: String) {
        val request = try {
            Request.Builder().url(signedUrl)
                .put(data.toRequestBody(contentType.toMediaTypeOrNull()))
                .header("x-upsert", "false")
                .build()
        } catch (_: IllegalArgumentException) {
            throw ApiError.invalidResponse
        }
        try {
            Http.transfer.newCall(request).await().use { response ->
                if (!response.isSuccessful) {
                    throw ApiError(ApiError.Kind.Interrupted, "Der Upload ist fehlgeschlagen. Bitte versuche es erneut.")
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw ApiError.from(e)
        }
    }
}

/**
 * Downloaded attachments live in the cache directory only: opened on explicit
 * request (via FileProvider), removed on sign-out and after 24 hours.
 */
object TemporaryFiles {
    private lateinit var cacheDir: File

    fun init(context: Context) {
        cacheDir = context.cacheDir
    }

    private val root: File get() = File(cacheDir, "VistooAttachments")
    private fun folder(attachmentId: String) = File(root, attachmentId.replace("/", "_"))

    /** File names come from users: keep them, but never let them escape the folder. */
    fun safeName(name: String): String {
        val cleaned = name.replace("/", "_").replace(":", "_").replace("\\", "_")
        return if (cleaned.isEmpty() || cleaned.startsWith(".")) "Datei" else cleaned
    }

    fun cachedFile(attachmentId: String, fileName: String): File? =
        File(folder(attachmentId), safeName(fileName)).takeIf { it.exists() }

    suspend fun download(signedUrl: String, attachmentId: String, fileName: String): File {
        val request = try {
            Request.Builder().url(signedUrl).build()
        } catch (_: IllegalArgumentException) {
            throw ApiError.invalidResponse
        }
        try {
            Http.transfer.newCall(request).await().use { response ->
                if (!response.isSuccessful) {
                    throw ApiError(ApiError.Kind.Server(ErrorCode.NotFound), "Die Datei konnte nicht geladen werden.")
                }
                return withContext(Dispatchers.IO) {
                    val dir = folder(attachmentId).apply { mkdirs() }
                    val target = File(dir, safeName(fileName))
                    val tmp = File(dir, ".download")
                    response.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
                    if (!tmp.renameTo(target)) throw IOException("rename failed")
                    target
                }
            }
        } catch (e: ApiError) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw ApiError.from(e)
        } catch (_: Exception) {
            throw ApiError(ApiError.Kind.Interrupted, "Die Datei konnte nicht gespeichert werden.")
        }
    }

    /** Removes all downloaded files (sign-out / account switch). */
    fun purgeAll() {
        if (::cacheDir.isInitialized) root.deleteRecursively()
    }

    /** Removes downloads older than `ageMillis` (app launch). */
    fun purge(ageMillis: Long = 24 * 3600 * 1000L) {
        if (!::cacheDir.isInitialized) return
        val limit = System.currentTimeMillis() - ageMillis
        root.listFiles()?.forEach { if (it.lastModified() < limit) it.deleteRecursively() }
    }
}

/** "512 KB", "2,4 MB" (German formatting like the web). */
object ByteFormatting {
    fun string(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${Math.round(bytes / 1024.0)} KB"
        val mb = bytes / (1024.0 * 1024.0)
        val digits = if (bytes < 10L * 1024 * 1024) 1 else 0
        return String.format(java.util.Locale.GERMANY, "%.${digits}f", mb) + " MB"
    }
}

/** Lower-cased UUID, the id format of the API. */
fun newClientId(): String = java.util.UUID.randomUUID().toString().lowercase()
