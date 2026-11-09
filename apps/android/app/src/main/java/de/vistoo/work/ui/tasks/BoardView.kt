package de.vistoo.work.ui.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Inbox
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.StatusIcon
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

/**
 * Kanban on a phone: a status strip (with counts) and the focused column as a list.
 * Every capability of the web board is available:
 *   - status change: swipe (next status), long press, detail form,
 *   - order: "Reihenfolge ändern" mode (up/down buttons, toggled by the parent's menu)
 *     or long press (an den Anfang / eins nach oben / unten / ans Ende) — also for TalkBack,
 *   - assignment ("Mir zuweisen"), deletion, opening.
 */
@Composable
fun BoardView(
    session: SessionModel,
    scope: WorkScope,
    tasks: List<TaskItem>,
    filtersActive: Boolean,
    status: TaskStatus,
    onStatus: (TaskStatus) -> Unit,
    sorting: Boolean,
    onOpen: (TaskItem) -> Unit,
    onAdd: ((TaskStatus) -> Unit)?,
) {
    val work = session.work
    val runner = rememberActionRunner()
    var confirmDelete by remember { mutableStateOf<TaskItem?>(null) }
    val column = tasks.filter { it.status == status }
    // Known statuses always; unknown ones (newer server) only when present.
    val columns = TaskStatus.knownCases + tasks.map { it.status }.filter { it !in TaskStatus.knownCases }.distinct()

    fun place(id: String, ordered: List<String>) {
        val i = ordered.indexOf(id)
        val task = work.task(id) ?: return
        if (i < 0) return
        val after = if (i > 0) ordered[i - 1] else null
        val before = if (i < ordered.size - 1) ordered[i + 1] else null
        runner.run("Verschieben fehlgeschlagen") { work.move(task, status, after, before) }
    }

    fun reorder(task: TaskItem, index: Int) {
        val ids = column.map { it.id }.toMutableList()
        val from = ids.indexOf(task.id)
        if (from < 0) return
        val target = index.coerceIn(0, ids.size - 1)
        if (target == from) return
        ids.removeAt(from)
        ids.add(target, task.id)
        place(task.id, ids)
    }

    fun step(task: TaskItem, delta: Int) {
        val i = column.indexOfFirst { it.id == task.id }
        if (i >= 0) reorder(task, i + delta)
    }

    Column(Modifier.fillMaxSize()) {
        StatusStrip(columns, { s -> tasks.count { it.status == s } }, status, onStatus)
        HorizontalDivider(color = Tokens.Palette.border)
        if (column.isEmpty()) {
            Box(Modifier.fillMaxSize().background(Tokens.Palette.background), contentAlignment = Alignment.Center) {
                EmptyState(
                    if (filtersActive) "Keine Treffer" else "Keine Aufgaben",
                    Icons.Outlined.Inbox,
                    if (filtersActive) "Keine Aufgabe in „${status.label}“ passt zu den Filtern." else "In „${status.label}“ ist nichts.",
                ) {
                    if (onAdd != null) OutlinedButton(onClick = { onAdd(status) }) { Text("Aufgabe hinzufügen") }
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().background(Tokens.Palette.background), contentPadding = PaddingValues(bottom = 24.dp)) {
                if (filtersActive) {
                    item {
                        Text(
                            "Gefiltert: Beim Sortieren wird zwischen die sichtbaren Nachbarn einsortiert.",
                            style = VType.footnote,
                            color = Tokens.Palette.mutedForeground,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                }
                items(column, key = { it.id }) { task ->
                    Column(Modifier.animateItem()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) {
                                val readOnly = work.isReadOnly(task) || onAdd == null
                                TaskListItem(
                                    session, task, runner,
                                    onOpen = { onOpen(task) },
                                    onDelete = { confirmDelete = task },
                                    showProject = scope == WorkScope.All,
                                    extraEntries = if (readOnly) emptyList() else listOf(
                                        MenuEntry.Submenu("Reihenfolge", Icons.AutoMirrored.Filled.Sort, listOf(
                                            MenuEntry.Item("An den Anfang") { reorder(task, 0) },
                                            MenuEntry.Item("Eins nach oben") { step(task, -1) },
                                            MenuEntry.Item("Eins nach unten") { step(task, 1) },
                                            MenuEntry.Item("Ans Ende") { reorder(task, column.size - 1) },
                                        )),
                                    ),
                                )
                            }
                            if (sorting) {
                                val i = column.indexOf(task)
                                IconButton(onClick = { step(task, -1) }, enabled = i > 0) {
                                    Icon(Icons.Filled.KeyboardArrowUp, "Eins nach oben: ${task.title}")
                                }
                                IconButton(onClick = { step(task, 1) }, enabled = i < column.size - 1) {
                                    Icon(Icons.Filled.KeyboardArrowDown, "Eins nach unten: ${task.title}")
                                }
                            }
                        }
                        HorizontalDivider(Modifier.padding(start = 46.dp), color = Tokens.Palette.border)
                    }
                }
            }
        }
    }
    TaskDeleteConfirmation(confirmDelete, { confirmDelete = null }) { t -> runner.run("Löschen fehlgeschlagen") { work.deleteTask(t) } }
    runner.Alerts()
}

/**
 * Horizontal status selector with counts. Readable at every text size, unlike a
 * segmented control with four long German labels.
 */
@Composable
fun StatusStrip(statuses: List<TaskStatus>, count: (TaskStatus) -> Int, selection: TaskStatus, onSelect: (TaskStatus) -> Unit) {
    val state = rememberLazyListState()
    LaunchedEffect(selection) {
        val i = statuses.indexOf(selection)
        if (i >= 0) state.animateScrollToItem(i, -120)
    }
    LazyRow(
        state = state,
        modifier = Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle).padding(vertical = 6.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(statuses, key = { it.rawValue }) { s ->
            val selected = s == selection
            Row(
                Modifier
                    .heightIn(min = 44.dp)
                    .background(if (selected) Tokens.Palette.surfaceSunken else Tokens.Palette.surfaceSubtle, CircleShape)
                    .border(BorderStroke(1.dp, if (selected) Tokens.Palette.borderStrong else Tokens.Palette.border), CircleShape)
                    .clickable { onSelect(s) }
                    .padding(horizontal = 12.dp)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${s.label}, ${count(s)} Aufgaben"
                        this.selected = selected
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                StatusIcon(s, size = 14.dp)
                Text(s.label, style = VType.dense.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal))
                Text("${count(s)}", style = VType.dense, color = Tokens.Palette.mutedForeground)
            }
        }
    }
}
