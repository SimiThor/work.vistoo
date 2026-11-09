package de.vistoo.work.core.support

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A calendar day ("YYYY-MM-DD") without time zone — task start/end dates.
 *
 * Mirrors packages/domain/src/dates.ts and the iOS `CalendarDate`: all arithmetic
 * happens on integer day numbers (days since 1970-01-01), so the user's time
 * zone can never shift a date.
 */
@Serializable(with = CalendarDateSerializer::class)
data class CalendarDate(val dayNumber: Long) : Comparable<CalendarDate> {
    private val local: LocalDate get() = LocalDate.ofEpochDay(dayNumber)

    val year: Int get() = local.year
    val month: Int get() = local.monthValue
    val day: Int get() = local.dayOfMonth

    val iso: String get() = "%04d-%02d-%02d".format(year, month, day)

    fun adding(days: Long): CalendarDate = CalendarDate(dayNumber + days)
    fun adding(days: Int): CalendarDate = adding(days.toLong())

    /** 0 = Monday … 6 = Sunday. */
    val weekdayIndex: Int get() = (((dayNumber + 3) % 7 + 7) % 7).toInt()
    val isWeekend: Boolean get() = weekdayIndex >= 5
    val startOfWeek: CalendarDate get() = adding(-weekdayIndex)

    /** ISO 8601 week number. */
    val isoWeek: Int
        get() {
            val thursday = dayNumber - weekdayIndex + 3
            val year = LocalDate.ofEpochDay(thursday).year
            val jan1 = LocalDate.of(year, 1, 1).toEpochDay()
            return ((thursday - jan1) / 7 + 1).toInt()
        }

    /** Midnight UTC of this day, in epoch millis (Material date pickers use UTC millis). */
    val utcMillis: Long get() = dayNumber * 86_400_000L

    override fun compareTo(other: CalendarDate): Int = dayNumber.compareTo(other.dayNumber)
    override fun toString(): String = iso

    companion object {
        /** Strict parser: rejects impossible dates like 2026-02-30. */
        fun parse(iso: String): CalendarDate? {
            val parts = iso.split("-")
            if (parts.size != 3 || parts[0].length != 4 || parts[1].length != 2 || parts[2].length != 2) return null
            val y = parts[0].toIntOrNull() ?: return null
            val m = parts[1].toIntOrNull() ?: return null
            val d = parts[2].toIntOrNull() ?: return null
            if (m !in 1..12 || d !in 1..31) return null
            return try {
                CalendarDate(LocalDate.of(y, m, d).toEpochDay())
            } catch (_: Exception) {
                null
            }
        }

        /** The calendar day of `instant` in the given (local) zone. */
        fun of(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): CalendarDate =
            CalendarDate(instant.atZone(zone).toLocalDate().toEpochDay())

        fun today(zone: ZoneId = ZoneId.systemDefault()): CalendarDate = CalendarDate(LocalDate.now(zone).toEpochDay())

        fun fromUtcMillis(millis: Long): CalendarDate = CalendarDate(Math.floorDiv(millis, 86_400_000L))

        /** Inclusive duration: same start and end = 1 day. */
        fun durationDays(start: CalendarDate, end: CalendarDate): Long = end.dayNumber - start.dayNumber + 1
    }
}

object CalendarDateSerializer : KSerializer<CalendarDate> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("de.vistoo.work.CalendarDate", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: CalendarDate) = encoder.encodeString(value.iso)
    override fun deserialize(decoder: Decoder): CalendarDate {
        val raw = decoder.decodeString()
        return CalendarDate.parse(raw) ?: throw SerializationException("Invalid calendar date $raw")
    }
}
