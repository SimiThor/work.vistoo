package de.vistoo.work.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.delay

// MARK: Text

/** Borderless text field inside a grouped row (iOS form `TextField`). */
@Composable
fun FormTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = false,
    minLines: Int = 1,
    style: TextStyle = VType.body,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    focusRequester: FocusRequester? = null,
    autoFocus: Boolean = false,
) {
    val requester = focusRequester ?: remember { FocusRequester() }
    if (autoFocus) {
        LaunchedEffect(Unit) {
            // Sheets need a moment before the keyboard can appear.
            delay(350)
            runCatching { requester.requestFocus() }
        }
    }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        textStyle = style.copy(color = if (enabled) Tokens.Palette.foreground else Tokens.Palette.mutedForeground),
        cursorBrush = SolidColor(Tokens.Palette.accentBlue),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .focusRequester(requester)
            .semantics { contentDescription = placeholder }
            .padding(horizontal = 16.dp, vertical = 13.dp),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) Text(placeholder, style = style, color = Tokens.Palette.mutedForeground.copy(alpha = 0.7f))
                inner()
            }
        },
    )
}

val EmailKeyboard = KeyboardOptions(keyboardType = KeyboardType.Email, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false)
val UrlKeyboard = KeyboardOptions(keyboardType = KeyboardType.Uri, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false)
val NameKeyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words, keyboardType = KeyboardType.Text)

/** Search field below the top bar (iOS `.searchable`). */
@Composable
fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Tokens.Palette.surfaceSubtle)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .background(Tokens.Palette.surfaceSunken, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(20.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = VType.body.copy(color = Tokens.Palette.foreground),
            cursorBrush = SolidColor(Tokens.Palette.accentBlue),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 9.dp).semantics { contentDescription = placeholder },
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) Text(placeholder, style = VType.body, color = Tokens.Palette.mutedForeground)
                    inner()
                }
            },
        )
        if (value.isNotEmpty()) {
            IconButton(onClick = { onValueChange("") }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Close, "Suche löschen", tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(18.dp))
            }
        }
    }
}

// MARK: Toggles & pickers

@Composable
fun ToggleRow(title: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit, icon: ImageVector? = null, enabled: Boolean = true) {
    ListRow(
        modifier = Modifier.semantics(mergeDescendants = true) {},
        onClick = { if (enabled) onCheckedChange(!checked) },
        enabled = enabled,
        leading = icon?.let { { Icon(it, null, tint = Tokens.Palette.accentBlue, modifier = Modifier.size(22.dp)) } },
        trailing = {
            Switch(
                checked = checked,
                onCheckedChange = onCheckedChange,
                enabled = enabled,
                colors = SwitchDefaults.colors(checkedTrackColor = Tokens.Palette.statusDone, checkedThumbColor = Color.White),
            )
        },
    ) { Text(title) }
}

/** One option of a picker row. */
data class PickerOption<T>(val value: T, val label: String, val icon: (@Composable () -> Unit)? = null)

/**
 * iOS form `Picker`: title left, current value right, options in a menu.
 */
@Composable
fun <T> PickerRow(
    title: String,
    selection: T,
    options: List<PickerOption<T>>,
    onSelect: (T) -> Unit,
    enabled: Boolean = true,
    icon: (@Composable () -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.value == selection }
    Box {
        ListRow(
            modifier = Modifier.semantics { stateDescription = current?.label ?: "" },
            onClick = { open = true },
            enabled = enabled,
            leading = icon,
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    current?.icon?.invoke()
                    Text(current?.label ?: "", color = Tokens.Palette.mutedForeground, style = VType.body, maxLines = 1)
                    Icon(Icons.Filled.UnfoldMore, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(16.dp))
                }
            },
        ) { Text(title) }
        EntryMenu(
            expanded = open,
            onDismiss = { open = false },
            entries = options.map { o -> MenuEntry.Item(o.label, checked = o.value == selection, onClick = { onSelect(o.value) }) },
        )
    }
}

@Composable
fun <T> Segmented(options: List<PickerOption<T>>, selection: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        options.forEachIndexed { i, o ->
            SegmentedButton(
                selected = o.value == selection,
                onClick = { onSelect(o.value) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                icon = {},
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = Tokens.Palette.background,
                    activeContentColor = Tokens.Palette.foreground,
                    inactiveContainerColor = Tokens.Palette.surfaceSunken,
                    inactiveContentColor = Tokens.Palette.foreground,
                    activeBorderColor = Tokens.Palette.borderStrong,
                    inactiveBorderColor = Tokens.Palette.border,
                ),
            ) { Text(o.label, style = VType.dense, maxLines = 1) }
        }
    }
}

/** "Verantwortlich" picker over the active members (former ones stay visible if selected). */
@Composable
fun PersonPicker(title: String, work: WorkStore, selection: String?, onSelect: (String?) -> Unit, viewerId: String?, noneLabel: String = "Niemand", enabled: Boolean = true) {
    val options = buildList {
        add(PickerOption<String?>(null, noneLabel))
        for (m in work.members) add(PickerOption<String?>(m.userId, if (m.userId == viewerId) "${m.displayName} (ich)" else m.displayName))
        if (selection != null && work.members.none { it.userId == selection }) {
            add(PickerOption<String?>(selection, work.person(selection)?.displayName ?: "Ehemaliges Mitglied"))
        }
    }
    PickerRow(title, selection, options, onSelect, enabled)
}

// MARK: Dates

/** Material date picker on calendar days (UTC millis ↔ day number, no time-zone shifts). */
@Composable
fun CalendarDatePickerDialog(initial: CalendarDate?, onDismiss: () -> Unit, onPick: (CalendarDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = (initial ?: CalendarDate.today()).utcMillis)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(CalendarDate.fromUtcMillis(it)) }
                onDismiss()
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
        colors = DatePickerDefaults.colors(containerColor = Tokens.Palette.background),
    ) {
        DatePicker(state = state, showModeToggle = true)
    }
}

/** Row showing a calendar day; tap opens the date picker. */
@Composable
fun DateValueRow(title: String, date: CalendarDate, onChange: (CalendarDate) -> Unit, enabled: Boolean = true) {
    var picking by remember { mutableStateOf(false) }
    ListRow(onClick = { picking = true }, enabled = enabled, trailing = {
        Text(
            Formatting.short(date),
            color = if (enabled) Tokens.Palette.accentBlue else Tokens.Palette.mutedForeground,
            style = VType.body,
            modifier = Modifier
                .background(Tokens.Palette.surfaceSunken, RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }) { Text(title) }
    if (picking) CalendarDatePickerDialog(date, { picking = false }, onChange)
}

/** Toggle + date for an optional calendar day (iOS `OptionalDateRow`). */
@Composable
fun OptionalDateRow(title: String, date: CalendarDate?, onChange: (CalendarDate?) -> Unit, enabled: Boolean = true, defaultDate: () -> CalendarDate = { CalendarDate.today() }) {
    ToggleRow(title, date != null, { on -> onChange(if (on) (date ?: defaultDate()) else null) }, enabled = enabled)
    if (date != null) {
        androidx.compose.material3.HorizontalDivider(Modifier.padding(start = 16.dp), color = Tokens.Palette.border)
        DateValueRow("Datum", date, { onChange(it) }, enabled)
    }
}

/** Date + time of an instant (CRM activities). */
@Composable
fun InstantRow(title: String, value: Instant, onChange: (Instant) -> Unit) {
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    val zone = ZoneId.systemDefault()
    val local = LocalDateTime.ofInstant(value, zone)
    ListRow(trailing = {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip(Formatting.short(CalendarDate.of(value))) { pickingDate = true }
            Chip(Formatting.time(value)) { pickingTime = true }
        }
    }) { Text(title) }
    if (pickingDate) {
        CalendarDatePickerDialog(CalendarDate.of(value), { pickingDate = false }) { d ->
            val day = java.time.LocalDate.ofEpochDay(d.dayNumber)
            onChange(day.atTime(local.toLocalTime()).atZone(zone).toInstant())
        }
    }
    if (pickingTime) {
        val state = rememberTimePickerState(local.hour, local.minute, is24Hour = true)
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pickingTime = false },
            confirmButton = {
                TextButton(onClick = {
                    onChange(local.toLocalDate().atTime(state.hour, state.minute).atZone(zone).toInstant())
                    pickingTime = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { pickingTime = false }) { Text("Abbrechen") } },
            text = { TimePicker(state) },
            containerColor = Tokens.Palette.background,
        )
    }
}

@Composable
private fun Chip(text: String, onClick: () -> Unit) {
    Text(
        text,
        color = Tokens.Palette.accentBlue,
        style = VType.body,
        modifier = Modifier
            .background(Tokens.Palette.surfaceSunken, RoundedCornerShape(6.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/** Due date in a row: red and with a warning glyph when overdue. */
@Composable
fun DueDateLabel(date: CalendarDate, overdueCheck: Boolean = true, style: TextStyle = VType.caption) {
    val overdue = overdueCheck && date < CalendarDate.today()
    val color = if (overdue) Tokens.Palette.destructive else Tokens.Palette.mutedForeground
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = if (overdue) "Überfällig seit ${Formatting.short(date)}" else "Fällig ${Formatting.short(date)}"
        },
    ) {
        Icon(
            if (overdue) Icons.Filled.ErrorOutline else Icons.Filled.CalendarToday,
            null,
            tint = color,
            modifier = Modifier.size(12.dp),
        )
        Text(Formatting.short(date), style = style.copy(fontWeight = if (overdue) androidx.compose.ui.text.font.FontWeight.Medium else null), color = color)
    }
}

// MARK: Swipe

/** One swipe action (shown while swiping, performed when the swipe completes). */
data class SwipeAction(val label: String, val icon: ImageVector, val color: Color, val onPerform: () -> Unit)

/**
 * Swipe actions on list rows (iOS `.swipeActions`): swipe right performs `start`,
 * swipe left performs `end`. The row snaps back; the remaining actions live in the
 * long-press menu.
 */
@Composable
fun SwipeRow(start: SwipeAction?, end: SwipeAction?, content: @Composable () -> Unit) {
    if (start == null && end == null) {
        content()
        return
    }
    val haptics = LocalHapticFeedback.current
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> start?.let {
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    it.onPerform()
                }
                SwipeToDismissBoxValue.EndToStart -> end?.let {
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    it.onPerform()
                }
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false // always snap back
        },
        positionalThreshold = { it * 0.35f },
    )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = start != null,
        enableDismissFromEndToStart = end != null,
        backgroundContent = {
            val direction = state.dismissDirection
            // Only while swiping: otherwise the hidden label would be part of every row's
            // semantics (TalkBack would read it; the actions are reachable via menu/actions).
            if (direction == SwipeToDismissBoxValue.Settled) return@SwipeToDismissBox
            val action = if (direction == SwipeToDismissBoxValue.StartToEnd) start else end
            val progress by animateFloatAsState(if (state.progress > 0.05f) 1f else 0f, label = "swipe")
            if (action != null) {
                Row(
                    Modifier.fillMaxSize().background(action.color).padding(horizontal = 20.dp).alpha(progress)
                        .clearAndSetSemantics {},
                    horizontalArrangement = if (direction == SwipeToDismissBoxValue.StartToEnd) Arrangement.Start else Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(action.icon, null, tint = Color.White)
                    Text(action.label, color = Color.White, style = VType.dense, modifier = Modifier.padding(start = 8.dp))
                }
            }
        },
    ) {
        Box(Modifier.background(Tokens.Palette.background)) { content() }
    }
}

/** Rounded bordered card surface (web card: white, hairline border). */
fun Modifier.cardSurface(): Modifier = this
    .background(Tokens.Palette.background, RoundedCornerShape(Tokens.Radius.lg))
    .border(1.dp, Tokens.Palette.border, RoundedCornerShape(Tokens.Radius.lg))
