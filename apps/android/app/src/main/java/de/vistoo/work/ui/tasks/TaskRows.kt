package de.vistoo.work.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.DonutLarge
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.stores.isOverdue
import de.vistoo.work.ui.components.ActionRunner
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.StatusIcon
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.next
import de.vistoo.work.ui.components.shareLink
import de.vistoo.work.ui.components.tint
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

/** One task in a list: title first, then the context (project, dates, person). */
@Composable
fun TaskRowView(work: WorkStore, task: TaskItem, showProject: Boolean = true, showAssignee: Boolean = true) {
    val overdue = task.isOverdue()
    val project = work.project(task.projectId)
    val person = work.person(task.assigneeId)
    val description = buildList {
        add("#${task.number} ${task.title}")
        add("Status ${task.status.label}")
        if (project != null && showProject) add("Projekt ${project.name}")
        if (task.startDate != null || task.endDate != null) add(Formatting.range(task.startDate, task.endDate))
        if (overdue) add("überfällig")
        add(person?.let { "Verantwortlich ${it.displayName}" } ?: "Nicht zugewiesen")
    }.joinToString(", ")
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StatusIcon(task.status, size = 18.dp, modifier = Modifier.padding(top = 3.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("#${task.number}", style = VType.body, color = Tokens.Palette.mutedForeground)
                Text(
                    task.title,
                    style = VType.body,
                    color = if (task.status == TaskStatus.Done) Tokens.Palette.mutedForeground else Tokens.Palette.foreground,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (showProject && project != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        ProjectDot(project.color)
                        Text(project.name, style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (task.startDate != null || task.endDate != null) {
                    val color = if (overdue) Tokens.Palette.destructive else Tokens.Palette.mutedForeground
                    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (overdue) Icons.Filled.ErrorOutline else Icons.Filled.CalendarToday, null, tint = color, modifier = Modifier.size(12.dp))
                        Text(
                            Formatting.range(task.startDate, task.endDate),
                            style = VType.caption.copy(fontWeight = if (overdue) FontWeight.Medium else FontWeight.Normal),
                            color = color,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        if (showAssignee && person != null) Avatar(person.fullName, person.email, size = 26.dp)
    }
}

/**
 * The quick actions every task row offers, in the same place on every list:
 *   - swipe right-to-left: next status ("Erledigt" for review, "Wieder öffnen" for done),
 *   - swipe left-to-right: delete (with confirmation),
 *   - long press: open, status, assignment ("Mir zuweisen" first), share, delete.
 */
@Composable
fun TaskListItem(
    session: SessionModel,
    task: TaskItem,
    runner: ActionRunner,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
    showProject: Boolean = true,
    showAssignee: Boolean = true,
    extraEntries: List<MenuEntry> = emptyList(),
) {
    val work = session.work
    val editable = !work.isReadOnly(task)
    val context = LocalContext.current
    fun setStatus(s: TaskStatus) = runner.run("Status nicht geändert") { work.setStatus(task, s) }
    fun assign(userId: String?) = runner.run("Zuweisung fehlgeschlagen") { work.setAssignee(task, userId) }

    val endAction = when {
        !editable -> null
        task.status.next != null -> {
            val next = task.status.next!!
            SwipeAction(next.label, if (next == TaskStatus.Done) Icons.Filled.CheckCircle else Icons.AutoMirrored.Filled.ArrowForward, next.tint) { setStatus(next) }
        }
        task.status == TaskStatus.Done -> SwipeAction("Wieder öffnen", Icons.AutoMirrored.Filled.Undo, TaskStatus.Open.tint) { setStatus(TaskStatus.Open) }
        else -> null
    }
    val startAction = if (editable) SwipeAction("Löschen", Icons.Filled.Delete, Tokens.Palette.destructive, onDelete) else null

    SwipeRow(start = startAction, end = endAction) {
        MenuTarget(
            onClick = onOpen,
            onClickLabel = "Öffnet die Details",
            entries = {
                buildList {
                    add(MenuEntry.Item("Öffnen", Icons.AutoMirrored.Filled.OpenInNew, onClick = onOpen))
                    if (editable) {
                        add(MenuEntry.Submenu("Status ändern", Icons.Outlined.DonutLarge, TaskStatus.knownCases.map { s ->
                            MenuEntry.Item(s.label, checked = s == task.status) { setStatus(s) }
                        }))
                        if (task.status != TaskStatus.Done && task.status.next != TaskStatus.Done) {
                            add(MenuEntry.Item(TaskStatus.Done.label, Icons.Filled.CheckCircle) { setStatus(TaskStatus.Done) })
                        }
                        if (task.assigneeId != session.userId) add(MenuEntry.Item("Mir zuweisen", Icons.Outlined.HowToReg) { assign(session.userId) })
                        add(MenuEntry.Submenu("Zuweisen", Icons.Outlined.AccountCircle, listOf(MenuEntry.Item("Nicht zugewiesen", checked = task.assigneeId == null) { assign(null) }) +
                            work.members.map { m -> MenuEntry.Item(m.displayName, checked = m.userId == task.assigneeId) { assign(m.userId) } }))
                        addAll(extraEntries)
                    }
                    add(MenuEntry.Item("Link teilen", Icons.Filled.Link) { shareLink(context, session.backend.configuration.taskLink(task.id)) })
                    if (editable) {
                        add(MenuEntry.Divider)
                        add(MenuEntry.Item("Löschen …", Icons.Filled.Delete, destructive = true, onClick = onDelete))
                    }
                }
            },
        ) {
            TaskRowView(work, task, showProject, showAssignee)
        }
    }
}

/** Delete confirmation for task lists (the swipe/menu only asks for it). */
@Composable
fun TaskDeleteConfirmation(task: TaskItem?, onDismiss: () -> Unit, onDelete: (TaskItem) -> Unit) {
    if (task == null) return
    ConfirmDialog(
        title = "Aufgabe löschen?",
        message = "#${task.number} „${task.title}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.",
        confirmLabel = "Löschen",
        onConfirm = { onDelete(task) },
        onDismiss = onDismiss,
    )
}
