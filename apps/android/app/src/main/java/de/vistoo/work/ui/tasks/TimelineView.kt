package de.vistoo.work.ui.tasks

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.stores.hasCompleteRange
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.Segmented
import de.vistoo.work.ui.components.StatusIcon
import de.vistoo.work.ui.components.rememberPreference
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

enum class TimelineScale(val label: String, val dayWidth: Dp) { Day("Tage", 36.dp), Week("Wochen", 14.dp) }

private sealed interface TimelineRowItem {
    data class Header(val id: String, val label: String, val color: String?) : TimelineRowItem
    data class Task(val task: TaskItem) : TimelineRowItem
}

/**
 * Timeline/Gantt for the narrow screen (same design as iOS).
 *
 * - Task names sit above their bar in full width and stay pinned to the left edge
 *   while the time axis scrolls horizontally.
 * - Zoom (Tage/Wochen) and "Heute" sit in a bottom bar within thumb reach.
 * - Tapping a row opens the task; dates are edited in the task form.
 * - Tasks without a complete range are listed above ("Termine setzen").
 */
@Composable
fun TimelineView(session: SessionModel, scope: WorkScope, tasks: List<TaskItem>, onOpen: (TaskItem, Boolean) -> Unit) {
    val work = session.work
    var scaleRaw by rememberPreference("vistoo.timeline.scale", TimelineScale.Day.name)
    val scale = runCatching { TimelineScale.valueOf(scaleRaw) }.getOrDefault(TimelineScale.Day)
    var showUnplanned by remember { mutableStateOf(true) }
    val today = CalendarDate.today()
    val planned = tasks.filter { it.hasCompleteRange }.sortedWith(compareBy({ it.startDate!! }, { it.endDate!! }, { it.title }))
    val unplanned = tasks.filter { !it.hasCompleteRange }

    // Visible range: always Monday-aligned, padded around today and all bars.
    var minDay = today.dayNumber
    var maxDay = today.dayNumber
    for (t in planned) {
        minDay = minOf(minDay, t.startDate!!.dayNumber)
        maxDay = maxOf(maxDay, t.endDate!!.dayNumber)
    }
    val start = CalendarDate(minDay - if (scale == TimelineScale.Day) 7 else 14).startOfWeek
    val end = CalendarDate(maxDay + if (scale == TimelineScale.Day) 21 else 56).startOfWeek.adding(6)
    val days = (end.dayNumber - start.dayNumber + 1).toInt()

    val rows: List<TimelineRowItem> = when (scope) {
        WorkScope.All -> planned.groupBy { it.projectId }
            .toSortedMap(compareBy(String.CASE_INSENSITIVE_ORDER) { work.project(it)?.name ?: "" })
            .flatMap { (pid, list) ->
                val p = work.project(pid)
                listOf(TimelineRowItem.Header(pid, p?.name ?: "Projekt", p?.color)) + list.map { TimelineRowItem.Task(it) }
            }
        is WorkScope.OfProject -> planned.map { TimelineRowItem.Task(it) }
    }

    val hScroll = rememberScrollState()
    val density = LocalDensity.current
    val coroutines = rememberMainScope()
    fun todayOffsetPx(): Int = with(density) { ((today.dayNumber - start.dayNumber) * scale.dayWidth.toPx() - 80.dp.toPx()).toInt().coerceAtLeast(0) }
    LaunchedEffect(scale, planned.isEmpty()) { hScroll.scrollTo(todayOffsetPx()) }

    Column(Modifier.fillMaxSize().background(Tokens.Palette.background)) {
        if (unplanned.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle).padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 36.dp).clickable { showUnplanned = !showUnplanned },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Nicht vollständig geplant", style = VType.dense.copy(fontWeight = FontWeight.SemiBold))
                    Text("${unplanned.size}", style = VType.dense, color = Tokens.Palette.mutedForeground, modifier = Modifier.padding(start = 8.dp).weight(1f))
                    Icon(if (showUnplanned) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, if (showUnplanned) "Einklappen" else "Ausklappen", tint = Tokens.Palette.accentBlue)
                }
                AnimatedVisibility(showUnplanned) {
                    Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                        for (task in unplanned) {
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                StatusIcon(task.status)
                                Text(
                                    task.title,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp).clickable { onOpen(task, false) },
                                )
                                if (!work.isReadOnly(task)) {
                                    IconButton(onClick = { onOpen(task, true) }) {
                                        Icon(Icons.Outlined.EditCalendar, "Termine für „${task.title}“ setzen", tint = Tokens.Palette.accentBlue)
                                    }
                                }
                            }
                            HorizontalDivider(color = Tokens.Palette.border)
                        }
                    }
                }
            }
        }
        Box(Modifier.weight(1f)) {
            if (planned.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        "Nichts geplant",
                        Icons.Outlined.EventAvailable,
                        "Keine Aufgabe hat bisher einen vollständigen Zeitraum. Öffne eine Aufgabe und setze Start- und Enddatum.",
                    )
                }
            } else {
                Chart(rows, start, days, scale, today, hScroll) { onOpen(it, false) }
            }
        }
        // Controls within thumb reach.
        Row(
            Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Segmented(
                TimelineScale.entries.map { PickerOption(it, it.label) },
                scale,
                { scaleRaw = it.name },
                Modifier.widthIn(max = 200.dp),
            )
            Box(Modifier.weight(1f))
            OutlinedButton(
                onClick = { coroutines.launch { hScroll.animateScrollTo(todayOffsetPx()) } },
                enabled = planned.isNotEmpty(),
                colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = Tokens.Palette.accentBlue),
            ) {
                Icon(Icons.Outlined.Today, null, modifier = Modifier.size(18.dp))
                Text("Heute", modifier = Modifier.padding(start = 6.dp))
            }
        }
    }
}

@Composable
private fun Chart(
    rows: List<TimelineRowItem>,
    start: CalendarDate,
    days: Int,
    scale: TimelineScale,
    today: CalendarDate,
    hScroll: ScrollState,
    open: (TaskItem) -> Unit,
) {
    val w = scale.dayWidth
    val width = w * days
    val todayX = w * (today.dayNumber - start.dayNumber).toInt()
    val surface = Tokens.Palette.surfaceSubtle
    val border = Tokens.Palette.border
    Box(Modifier.fillMaxSize().horizontalScroll(hScroll).semantics { contentDescription = "Zeitachse" }) {
        Column(Modifier.width(width).fillMaxSize()) {
            TimelineHeader(start, days, scale, today)
            Column(
                Modifier
                    .width(width)
                    .weight(1f)
                    .drawBehind {
                        // Weekend shading and week separators behind the rows.
                        val dw = w.toPx()
                        for (i in 0 until days) {
                            val d = start.adding(i)
                            val x = i * dw
                            if (d.isWeekend) drawRect(surface, Offset(x, 0f), Size(dw, size.height))
                            if (d.weekdayIndex == 0) drawRect(border, Offset(x, 0f), Size(1f, size.height))
                        }
                    }
                    .verticalScroll(rememberScrollState()),
            ) {
                for (row in rows) {
                    when (row) {
                        is TimelineRowItem.Header -> Row(
                            Modifier
                                .offset { IntOffset(hScroll.value, 0) }
                                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp)
                                .semantics { heading() },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            row.color?.let { ProjectDot(it) }
                            Text(row.label, style = VType.footnote.copy(fontWeight = FontWeight.SemiBold), color = Tokens.Palette.mutedForeground)
                        }
                        is TimelineRowItem.Task -> TimelineRow(row.task, start, w, width, todayX, hScroll) { open(row.task) }
                    }
                }
                Box(Modifier.height(24.dp))
            }
        }
    }
}

/** Title row + bar. The title is pinned to the visible left edge. */
@Composable
private fun TimelineRow(task: TaskItem, start: CalendarDate, dayWidth: Dp, width: Dp, todayX: Dp, hScroll: ScrollState, open: () -> Unit) {
    val s = task.startDate!!
    val e = task.endDate!!
    val left = dayWidth * (s.dayNumber - start.dayNumber).toInt()
    val barWidth = maxOf(dayWidth * (e.dayNumber - s.dayNumber + 1).toInt() - 4.dp, dayWidth - 4.dp)
    val (fill, stroke) = when (task.status) {
        TaskStatus.Backlog -> Tokens.Palette.background to Tokens.Palette.timelineOpenBorder
        TaskStatus.Open -> Tokens.Palette.timelineOpenBg to Tokens.Palette.timelineOpenBorder
        TaskStatus.InProgress -> Tokens.Palette.accentBlueSoft to Tokens.Palette.timelineProgressBorder
        TaskStatus.InReview -> Tokens.Palette.timelineReviewBg to Tokens.Palette.timelineReviewBorder
        else -> Tokens.Palette.surfaceSubtle to Tokens.Palette.border
    }
    val duration = CalendarDate.durationDays(s, e)
    val description = "#${task.number} ${task.title}, " +
        (if (s == e) Formatting.long(s) else "${Formatting.long(s)} bis ${Formatting.long(e)}") + ", " +
        (if (duration == 1L) "1 Tag" else "$duration Tage") + ", Status ${task.status.label}"
    Column(
        Modifier
            .width(width)
            .clickable(onClick = open)
            .padding(vertical = 6.dp)
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(
            Modifier.offset { IntOffset(hScroll.value, 0) }.widthIn(max = 340.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            StatusIcon(task.status, size = 13.dp)
            Text("#${task.number}", style = VType.dense, color = Tokens.Palette.mutedForeground)
            Text(task.title, style = VType.dense, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Text(Formatting.range(s, e), style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 1)
        }
        Box(Modifier.width(width).height(22.dp).padding(top = 4.dp)) {
            Box(Modifier.offset(x = todayX + dayWidth / 2 - 1.dp).width(2.dp).height(18.dp).background(Tokens.Palette.accentBlue.copy(alpha = 0.7f)))
            Box(
                Modifier
                    .offset(x = left + 2.dp, y = 2.dp)
                    .width(barWidth)
                    .height(14.dp)
                    .background(fill, RoundedCornerShape(Tokens.Radius.sm))
                    .border(1.dp, stroke, RoundedCornerShape(Tokens.Radius.sm)),
            )
        }
    }
}

@Composable
private fun TimelineHeader(start: CalendarDate, days: Int, scale: TimelineScale, today: CalendarDate) {
    val w = scale.dayWidth
    // Months as runs of days.
    val months = mutableListOf<Triple<String, Int, Int>>()
    for (i in 0 until days) {
        val label = Formatting.monthYear(start.adding(i))
        val last = months.lastOrNull()
        if (last != null && last.first == label) months[months.size - 1] = Triple(label, last.second, last.third + 1) else months += Triple(label, i, 1)
    }
    val weekdays = listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
    Column(Modifier.background(Tokens.Palette.background).semantics { invisibleToUser() }) {
        Row(Modifier.height(24.dp), verticalAlignment = Alignment.CenterVertically) {
            for ((label, _, length) in months) {
                Text(
                    if (w * length > 70.dp) label else "",
                    style = VType.caption.copy(fontWeight = FontWeight.Medium),
                    maxLines = 1,
                    modifier = Modifier.width(w * length).padding(start = 6.dp),
                )
            }
        }
        Row(Modifier.height(44.dp)) {
            if (scale == TimelineScale.Day) {
                for (i in 0 until days) {
                    val d = start.adding(i)
                    Column(Modifier.width(w), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(weekdays[d.weekdayIndex], fontSize = 9.sp, color = Tokens.Palette.mutedForeground)
                        Box(
                            Modifier.size(20.dp).background(if (d == today) Tokens.Palette.accentBlue else Color.Transparent, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("${d.day}", fontSize = 11.sp, color = if (d == today) Color.White else Tokens.Palette.foreground)
                        }
                    }
                }
            } else {
                for (i in 0 until (days + 6) / 7) {
                    val d = start.adding(i * 7)
                    val containsToday = today >= d && today < d.adding(7)
                    val color = if (containsToday) Tokens.Palette.accentBlueText else Tokens.Palette.mutedForeground
                    Column(Modifier.width(w * 7).padding(start = 4.dp)) {
                        Text("KW ${d.isoWeek}", fontSize = 9.sp, fontWeight = FontWeight.Medium, color = color)
                        Text("${d.day}.${d.month}.", fontSize = 9.sp, color = color)
                    }
                }
            }
        }
        HorizontalDivider(color = Tokens.Palette.border)
    }
}
