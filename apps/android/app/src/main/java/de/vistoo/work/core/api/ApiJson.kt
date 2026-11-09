package de.vistoo.work.core.api

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

/** JSON settings of the API: unknown keys from newer servers are ignored. */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * Lenient ISO 8601 instant parser (port of the iOS `ISO8601`).
 *
 * The API sends `2026-11-06T07:43:29.456Z`; Supabase Realtime sends Postgres
 * output such as `2026-11-06T07:43:29.456789+00:00` or with a space separator.
 * Both must decode to the same instant.
 */
object Iso8601 {
    private val output: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun parse(raw: String): Instant? {
        val s = raw.trim()
        fun int(from: Int, len: Int): Int? {
            if (from + len > s.length) return null
            var v = 0
            for (i in from until from + len) {
                val c = s[i]
                if (c !in '0'..'9') return null
                v = v * 10 + (c - '0')
            }
            return v
        }
        if (s.length < 19) return null
        val y = int(0, 4) ?: return null
        if (s[4] != '-') return null
        val mo = int(5, 2) ?: return null
        if (s[7] != '-') return null
        val d = int(8, 2) ?: return null
        if (s[10] != 'T' && s[10] != ' ' && s[10] != 't') return null
        val h = int(11, 2) ?: return null
        if (s[13] != ':') return null
        val mi = int(14, 2) ?: return null
        if (s[16] != ':') return null
        val sec = int(17, 2) ?: return null

        var i = 19
        var nanos = 0L
        if (i < s.length && s[i] == '.') {
            i++
            var scale = 100_000_000L
            while (i < s.length && s[i] in '0'..'9') {
                nanos += (s[i] - '0') * scale
                scale /= 10
                i++
            }
        }
        var offsetSeconds = 0
        if (i < s.length) {
            when (s[i]) {
                'Z', 'z' -> offsetSeconds = 0
                '+', '-' -> {
                    val sign = if (s[i] == '+') 1 else -1
                    val oh = int(i + 1, 2) ?: return null
                    var om = 0
                    if (i + 3 < s.length) {
                        val start = if (s[i + 3] == ':') i + 4 else i + 3
                        om = int(start, 2) ?: 0
                    }
                    offsetSeconds = sign * (oh * 3600 + om * 60)
                }
                else -> return null
            }
        }
        return try {
            val date = LocalDate.of(y, mo, d)
            val base = date.atTime(h, mi, sec).toEpochSecond(ZoneOffset.UTC) - offsetSeconds
            Instant.ofEpochSecond(base, nanos)
        } catch (_: Exception) {
            null
        }
    }

    /** API format (UTC, milliseconds). */
    fun format(instant: Instant): String = output.format(instant)
}

object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("de.vistoo.work.Instant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(Iso8601.format(value))
    override fun deserialize(decoder: Decoder): Instant {
        val raw = decoder.decodeString()
        return Iso8601.parse(raw) ?: throw SerializationException("Invalid ISO 8601 instant: $raw")
    }
}
