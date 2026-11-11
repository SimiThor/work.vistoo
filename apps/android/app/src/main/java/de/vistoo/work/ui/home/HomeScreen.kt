package de.vistoo.work.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FactCheck
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.generated.ConversationKind
import de.vistoo.work.core.generated.ConversationSummary
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.Todo
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.ui.app.AccountButton
import de.vistoo.work.ui.app.Navigator
import de.vistoo.work.ui.app.TodosRoute
import de.vistoo.work.ui.app.navigator
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FailureView
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.rememberPreference
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.TaskCreateView
import de.vistoo.work.ui.tasks.TaskDeleteConfirmation
import de.vistoo.work.ui.tasks.TaskDetailView
import de.vistoo.work.ui.tasks.TaskListItem
import de.vistoo.work.ui.todos.TodoEditView
import de.vistoo.work.ui.todos.TodoQuickAddRow
import de.vistoo.work.ui.todos.TodoRow
import kotlinx.coroutines.launch

/**
 * Start tab: what needs me now. Unread conversations first, then my own to-dos (with an
 * inline field to add one in a second), then my open tasks grouped by urgency (overdue,
 * today, next 7 days, later, without date). Everything else is one tap away but not here.
 */
@Composable
fun HomeScreen(session: SessionModel, nav: NavHostController) {
    val work = session.work
    val todos = session.todos
    val navigator = navigator()
    val runner = rememberActionRunner()
    var lastProjectId by rememberPreference("vistoo.work.lastProject", "")
    var draft by remember { mutableStateOf<WorkStore.TaskDraft?>(null) }
    var openTask by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<TaskItem?>(null) }
    var editingTodo by remember { mutableStateOf<Todo?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val todoFocus = remember { FocusRequester() }
    val scope = rememberMainScope()
    /** The start tab shows the first few; the rest is behind "Alle To-dos". */
    val todoPreviewCount = 6

    val unread = session.chat.conversations.filter { it.unread && !it.archived }.sortedByDescending { it.lastMessageAt }
    val myOpenTasks = work.tasks(WorkScope.All).filter { it.assigneeId == session.userId && it.status != TaskStatus.Done }
    val buckets = HomeBucket.group(myOpenTasks)

    fun newTask() {
        val last = work.project(lastProjectId)?.takeIf { !it.archived }?.id
        val projectId = last ?: work.activeProjects.firstOrNull()?.id ?: return
        draft = WorkStore.TaskDraft(projectId = projectId, status = TaskStatus.Open, assigneeId = session.userId)
    }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar(
                "Für mich",
                large = true,
                navigationIcon = { AccountButton(session) },
                actions = {
                    MenuButton(Icons.Filled.Add, "Neu", {
                        listOf(
                            MenuEntry.Item("Neues To-do", Icons.Outlined.Checklist) { runCatching { todoFocus.requestFocus() } },
                            MenuEntry.Item("Neue Aufgabe", Icons.AutoMirrored.Outlined.FactCheck, enabled = work.activeProjects.isNotEmpty()) { newTask() },
                        )
                    })
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                work.state == LoadState.Loading && work.tasksById.isEmpty() -> LoadingView()
                work.state is LoadState.Failed && work.tasksById.isEmpty() -> FailureView((work.state as LoadState.Failed).message) { work.reload() }
                else -> PullToRefreshBox(refreshing, onRefresh = {
                    scope.launch {
                        refreshing = true
                        val a = launch { work.reload() }
                        val b = launch { session.chat.reload() }
                        val c = launch { todos.reload() }
                        a.join(); b.join(); c.join()
                        refreshing = false
                    }
                }) {
                    GroupedList {
                        if (unread.isNotEmpty()) {
                            section("unread", header = "Ungelesen") {
                                for (c in unread.take(5)) row(c.id) {
                                    ListRow(onClick = { navigator.openConversation(c.id) }) { ConversationRowLabel(c) }
                                }
                                if (unread.size > 5) row("all") {
                                    ListRow(onClick = { navigator.tab = Navigator.Tab.Chat }) {
                                        Text("Alle ${unread.size} ungelesenen anzeigen", color = Tokens.Palette.accentBlue)
                                    }
                                }
                            }
                        }
                        val open = todos.open
                        section("todos", header = "Meine To-dos", headerTrailing = if (open.isNotEmpty()) "${open.size}" else null) {
                            row("add") { TodoQuickAddRow(todos, todoFocus) { runner.failure = it } }
                            for (todo in open.take(todoPreviewCount)) row(todo.id) {
                                TodoRow(
                                    todo,
                                    toggle = { runner.run("Ändern fehlgeschlagen") { todos.setCompleted(todo, !todo.completed) } },
                                    open = { editingTodo = todo },
                                    delete = { runner.run("Löschen fehlgeschlagen") { todos.delete(todo) } },
                                )
                            }
                            if (open.size > todoPreviewCount || todos.completed.isNotEmpty()) row("allTodos") {
                                ListRow(onClick = { nav.navigate(TodosRoute) }) {
                                    Text(if (open.size > todoPreviewCount) "Alle ${open.size} To-dos" else "Alle To-dos und erledigte", color = Tokens.Palette.accentBlue)
                                }
                            }
                        }
                        for (bucket in buckets) {
                            section(
                                "bucket-${bucket.kind.name}",
                                header = bucket.kind.title,
                                headerTrailing = "${bucket.tasks.size}",
                                headerColor = if (bucket.kind == HomeBucket.Kind.Overdue) Tokens.Palette.destructive else null,
                            ) {
                                for (task in bucket.tasks) row(task.id) {
                                    TaskListItem(session, task, runner, onOpen = { openTask = task.id }, onDelete = { confirmDelete = task }, showProject = true, showAssignee = false)
                                }
                            }
                        }
                        if (myOpenTasks.isEmpty()) {
                            item("empty") {
                                EmptyState(
                                    if (work.activeProjects.isEmpty()) "Noch keine Projekte" else "Nichts offen für dich",
                                    Icons.Outlined.CheckCircle,
                                    if (work.activeProjects.isEmpty()) "Aufgaben gehören immer zu einem Projekt. Lege zuerst ein Projekt an."
                                    else "Dir ist gerade keine offene Aufgabe zugewiesen.",
                                ) {
                                    if (work.activeProjects.isEmpty()) {
                                        Button(onClick = { navigator.tab = Navigator.Tab.Projects }) { Text("Zu den Projekten") }
                                    } else {
                                        TextButton(onClick = { navigator.tab = Navigator.Tab.Tasks }) { Text("Aufgaben des Teams ansehen") }
                                        TextButton(onClick = { newTask() }) { Text("Neue Aufgabe für mich") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    draft?.let { d -> TaskCreateView(session, d, onCreated = { lastProjectId = it.projectId }) { draft = null } }
    editingTodo?.let { t -> TodoEditView(todos, t) { editingTodo = null } }
    openTask?.let { id -> TaskDetailView(session, id) { openTask = null } }
    TaskDeleteConfirmation(confirmDelete, { confirmDelete = null }) { t -> runner.run("Löschen fehlgeschlagen") { work.deleteTask(t) } }
    runner.Alerts()
}

/** One group of the start tab. */
data class HomeBucket(val kind: Kind, val tasks: List<TaskItem>) {
    enum class Kind(val title: String) { Overdue("Überfällig"), Today("Heute"), Soon("Nächste 7 Tage"), Later("Später"), Undated("Ohne Termin") }

    companion object {
        /** Display grouping only (dates are calendar dates, as on the web). */
        fun kind(task: TaskItem, today: CalendarDate): Kind {
            val start = task.startDate
            val end = task.endDate
            if (end != null && end < today) return Kind.Overdue
            if (start == null && end == null) return Kind.Undated
            val from = start ?: end!!
            val to = end ?: start!!
            if (from <= today && today <= to) return Kind.Today
            if (from <= today.adding(7)) return Kind.Soon
            return Kind.Later
        }

        /** Work already started first, then by end date, then by number. */
        fun group(tasks: List<TaskItem>, today: CalendarDate = CalendarDate.today()): List<HomeBucket> {
            fun rank(s: TaskStatus) = when (s) {
                TaskStatus.InProgress -> 0
                TaskStatus.InReview -> 1
                else -> 2
            }
            val grouped = tasks.groupBy { kind(it, today) }
            return Kind.entries.mapNotNull { kind ->
                val items = grouped[kind]?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                HomeBucket(
                    kind,
                    items.sortedWith(
                        compareBy<TaskItem>({ rank(it.status) }, { (it.endDate ?: it.startDate)?.dayNumber ?: Long.MAX_VALUE }, { it.number }),
                    ),
                )
            }
        }
    }
}

/** Conversation row content shared by the chat list and the start tab. */
@Composable
fun ConversationRowLabel(conversation: ConversationSummary) {
    val c = conversation
    val kind = when (c.kind) {
        ConversationKind.Dm -> "Direktnachricht"
        ConversationKind.PrivateChannel -> "Geschlossener Kanal"
        else -> "Kanal"
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 32.dp).semantics(mergeDescendants = true) {
            contentDescription = "$kind ${c.title}" + if (c.unread) ", ungelesene Nachrichten" else ""
        },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val partner = c.dmPartner
        if (partner != null) {
            Avatar(partner.fullName, partner.email, size = 28.dp)
        } else {
            Icon(
                if (c.kind == ConversationKind.PrivateChannel) Icons.Outlined.Lock else Icons.Outlined.Tag,
                null,
                tint = Tokens.Palette.mutedForeground,
                modifier = Modifier.width(28.dp),
            )
        }
        Text(c.title, fontWeight = if (c.unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (c.unread) Box(Modifier.size(9.dp).background(Tokens.Palette.accentBlue, CircleShape))
    }
}
