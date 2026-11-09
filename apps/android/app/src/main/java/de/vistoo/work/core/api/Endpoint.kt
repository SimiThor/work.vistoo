package de.vistoo.work.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObjectBuilder

/** HTTP method of an API operation (generated descriptors use these). */
enum class HttpMethod { GET, POST, PUT, PATCH, DELETE }

/** Authentication level declared by the contract. */
enum class AuthLevel { Anonymous, Session, Member, Admin }

/** How an operation may be retried after a network failure (from the contract). */
enum class RetryPolicy {
    /** Repeating has the same effect (reads, PUT-style setters, idempotent sends). */
    Safe,

    /** Safe to repeat because the request carries a client-generated id. */
    IdempotentWithClientId,

    /** May have been applied already: re-read state / inspect a CONFLICT before repeating. */
    CheckConflict,

    /** Deletes: NOT_FOUND on a repeat means the first attempt succeeded. */
    NotFoundMeansDone;

    /** Whether the client may transparently repeat the request after a transport error. */
    val allowsAutomaticRetry: Boolean get() = this == Safe || this == IdempotentWithClientId
}

/** Marker for 204 responses. */
object NoContent

/** A typed request description created by the generated `API` factory. */
class Endpoint<R>(
    val method: HttpMethod,
    val path: String,
    val query: List<Pair<String, String>>,
    val body: JsonElement?,
    val auth: AuthLevel,
    val retry: RetryPolicy,
    /** null: no JSON body expected (204). */
    val response: KSerializer<R>?,
)

/** Request bodies encode themselves (explicit null vs. omitted, see [Patchable]). */
interface ApiRequest {
    fun toJson(): JsonElement
}

/** Contract enums are open: unknown raw values survive as `Unknown(raw)`. */
interface OpenEnum {
    val rawValue: String
}

open class OpenEnumSerializer<T : OpenEnum>(name: String, private val from: (String) -> T) : KSerializer<T> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("de.vistoo.work.$name", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: T) = encoder.encodeString(value.rawValue)
    override fun deserialize(decoder: Decoder): T = from(decoder.decodeString())
}

/** Tri-state field of partial updates: leave unchanged, clear (JSON null) or set. */
sealed interface Patchable<out T> {
    data object Unset : Patchable<Nothing>
    data object Null : Patchable<Nothing>
    data class Value<T>(val value: T) : Patchable<T>

    companion object {
        /** `null` clears the field. */
        fun <T> of(value: T?): Patchable<T> = if (value == null) Null else Value(value)
    }
}

inline fun <T> Patchable<T>.encodeInto(builder: JsonObjectBuilder, key: String, encode: (T) -> JsonElement) {
    when (this) {
        Patchable.Unset -> Unit
        Patchable.Null -> builder.put(key, JsonNull)
        is Patchable.Value -> builder.put(key, encode(value))
    }
}

/** Percent-encodes a path segment (ids are UUIDs, this is defensive). */
fun pathSegment(value: String): String {
    val unreserved = ('A'..'Z') + ('a'..'z') + ('0'..'9') + listOf('-', '.', '_', '~')
    val out = StringBuilder()
    for (b in value.toByteArray(Charsets.UTF_8)) {
        val c = (b.toInt() and 0xFF).toChar()
        if (c in unreserved) out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
    }
    return out.toString()
}
