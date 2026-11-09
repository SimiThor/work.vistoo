package de.vistoo.work.ui.components

import de.vistoo.work.core.support.CalendarDate
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** German formatting, identical wording to the web and iOS. */
object Formatting {
    val locale: Locale = Locale.GERMANY
    private val shortFmt = DateTimeFormatter.ofPattern("d. MMM", locale)
    private val shortYearFmt = DateTimeFormatter.ofPattern("d. MMM yyyy", locale)
    private val longFmt = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)
    private val dayFmt = DateTimeFormatter.ofPattern("d. MMMM yyyy", locale)
    private val instantFmt = DateTimeFormatter.ofPattern("d. MMM yyyy", locale)
    private val timeFmt = DateTimeFormatter.ofPattern("HH:mm", locale)
    private val dateTimeFmt = DateTimeFormatter.ofPattern("d. MMM yyyy, HH:mm", locale)
    private val monthYearFmt = DateTimeFormatter.ofPattern("LLLL yyyy", locale)

    private fun local(date: CalendarDate): LocalDate = LocalDate.ofEpochDay(date.dayNumber)

    /** "5. Nov." (adds the year if it differs) — like the web's formatShortDate. */
    fun short(date: CalendarDate, today: CalendarDate = CalendarDate.today()): String =
        (if (date.year != today.year) shortYearFmt else shortFmt).format(local(date))

    fun long(date: CalendarDate): String = longFmt.format(local(date))

    fun range(start: CalendarDate?, end: CalendarDate?): String = when {
        start != null && end != null -> if (start == end) short(start) else "${short(start)} – ${short(end)}"
        end != null -> "bis ${short(end)}"
        start != null -> "ab ${short(start)}"
        else -> "Kein Zeitraum"
    }

    fun time(instant: Instant): String = timeFmt.format(instant.atZone(ZoneId.systemDefault()))

    fun dateTime(instant: Instant): String = dateTimeFmt.format(instant.atZone(ZoneId.systemDefault()))

    fun dayHeading(instant: Instant): String {
        val day = instant.atZone(ZoneId.systemDefault()).toLocalDate()
        val today = LocalDate.now()
        return when (day) {
            today -> "Heute"
            today.minusDays(1) -> "Gestern"
            else -> dayFmt.format(day)
        }
    }

    fun instant(instant: Instant): String = instantFmt.format(instant.atZone(ZoneId.systemDefault()))

    fun monthYear(date: CalendarDate): String = monthYearFmt.format(local(date))

    fun number(n: Long): String = String.format(locale, "%,d", n)
}

val String.trimmed: String get() = trim()

/** Empty → null (optional text fields of the API). */
val String.nilIfBlank: String? get() = trim().ifEmpty { null }
