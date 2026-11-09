package de.vistoo.work.ui.milestones

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.SportsScore
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.Milestone
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.app.MilestoneRoute
import de.vistoo.work.ui.app.navigator
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.AreaContent
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.DueDateLabel
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.OptionalDateRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.TaskRowView
import de.vistoo.work.ui.tasks.failureSection
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

/** Workspace-wide milestones: open ones by due date, completed ones folded away. */
@Composable
fun MilestonesScreen(session: SessionModel, nav: NavHostController) {
    val store = session.milestones
    var creating by remember { mutableStateOf(false) }
    var showCompleted by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { store.reload() }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Meilensteine", onBack = { nav.popBackStack() }, actions = {
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, "Neuer Meilenstein") }
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AreaContent(store.state, store.milestones.isEmpty(), { store.reload() }) {
                PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; store.reload(); refreshing = false } }) {
                    GroupedList {
                        if (store.milestones.isEmpty()) {
                            item("empty") { EmptyState("Noch keine Meilensteine", Icons.Outlined.Flag, "Meilensteine bündeln Aufgaben aus allen Projekten zu einem Ziel.") }
                        }
                        section("open") {
                            for (m in store.open.sortedBy { it.dueDate?.dayNumber ?: Long.MAX_VALUE }) row(m.id) {
                                ListRow(onClick = { nav.navigate(MilestoneRoute(m.id)) }) { MilestoneRow(m) }
                            }
                        }
                        if (store.completed.isNotEmpty()) {
                            section("done", header = "Abgeschlossen (${store.completed.size})", expanded = showCompleted, onToggle = { showCompleted = !showCompleted }) {
                                for (m in store.completed) row(m.id) { ListRow(onClick = { nav.navigate(MilestoneRoute(m.id)) }) { MilestoneRow(m) } }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) MilestoneEditor(session, null) { creating = false }
}

@Composable
fun MilestoneRow(m: Milestone) {
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(if (m.completed) Icons.Outlined.SportsScore else Icons.Outlined.Flag, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(18.dp))
            Text(m.name, color = if (m.completed) Tokens.Palette.mutedForeground else Tokens.Palette.foreground, modifier = Modifier.weight(1f))
            m.dueDate?.let { DueDateLabel(it, overdueCheck = !m.completed) }
        }
        if (m.total > 0) {
            LinearProgressIndicator(
                progress = { m.done.toFloat() / m.total.toFloat() },
                modifier = Modifier.fillMaxWidth(),
                color = Tokens.Palette.statusDone,
                trackColor = Tokens.Palette.surfaceSunken,
                drawStopIndicator = {},
            )
            Text("${m.done} von ${m.total} erledigt", style = VType.caption, color = Tokens.Palette.mutedForeground)
        }
    }
}

/** A milestone with its tasks from all projects. */
@Composable
fun MilestoneDetailScreen(session: SessionModel, milestoneId: String, nav: NavHostController) {
    val store = session.milestones
    val navigator = navigator()
    val runner = rememberActionRunner()
    var editing by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val m = store.milestone(milestoneId)
    val tasks = session.work.tasks(WorkScope.All).filter { it.milestoneId == milestoneId }
        .sortedWith(compareBy({ if (it.status == TaskStatus.Done) 1 else 0 }, { it.number }))
    LaunchedEffect(milestoneId) {
        if (store.state == LoadState.Idle) store.reload()
        store.refresh(milestoneId)
    }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar(m?.name ?: "Meilenstein", onBack = { nav.popBackStack() }, actions = {
                if (m != null) MenuButton(Icons.Filled.MoreVert, "Aktionen", {
                    listOf(
                        MenuEntry.Item("Bearbeiten", Icons.Filled.Edit) { editing = true },
                        MenuEntry.Item(if (m.completed) "Wieder öffnen" else "Abschließen", if (m.completed) Icons.AutoMirrored.Filled.Undo else Icons.Outlined.SportsScore) {
                            runner.run("Ändern fehlgeschlagen") { store.setCompleted(m, !m.completed) }
                        },
                        MenuEntry.Item("Löschen …", Icons.Filled.Delete, destructive = true) { confirmDelete = true },
                    )
                })
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                m != null -> PullToRefreshBox(refreshing, onRefresh = {
                    scope.launch { refreshing = true; session.work.reload(); store.refresh(milestoneId); refreshing = false }
                }) {
                    GroupedList {
                        section("head") {
                            row("row") { ListRow { MilestoneRow(m) } }
                            if (m.description.isNotEmpty()) row("desc") { ListRow { Text(m.description, style = VType.callout) } }
                        }
                        section("tasks", header = "Aufgaben") {
                            if (tasks.isEmpty()) row("none") {
                                ListRow { Text("Noch keine Aufgaben. Ordne Aufgaben im Aufgabendetail diesem Meilenstein zu.", style = VType.callout, color = Tokens.Palette.mutedForeground) }
                            }
                            for (t in tasks) row(t.id) {
                                Box(Modifier.fillMaxWidth().clickable { navigator.linkedTask = t.id }) { TaskRowView(session.work, t) }
                            }
                        }
                    }
                }
                store.state == LoadState.Loaded -> EmptyState("Meilenstein gelöscht", Icons.Outlined.DeleteOutline)
                else -> LoadingView()
            }
        }
    }
    if (editing && m != null) MilestoneEditor(session, m) { editing = false }
    if (confirmDelete && m != null) {
        ConfirmDialog("Meilenstein löschen?", "Die Aufgaben bleiben erhalten, nur ohne Meilenstein.", "Löschen", onConfirm = {
            runner.run("Löschen fehlgeschlagen") {
                store.delete(m)
                session.work.reload()
                nav.popBackStack()
            }
        }, onDismiss = { confirmDelete = false })
    }
    runner.Alerts()
}

@Composable
fun MilestoneEditor(session: SessionModel, milestone: Milestone?, onDismiss: () -> Unit) {
    val clientId = remember { newClientId() }
    var name by remember { mutableStateOf(milestone?.name ?: "") }
    var description by remember { mutableStateOf(milestone?.description ?: "") }
    var dueDate by remember { mutableStateOf<CalendarDate?>(milestone?.dueDate) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    FormSheet(
        title = if (milestone == null) "Neuer Meilenstein" else "Meilenstein bearbeiten",
        onDismiss = onDismiss,
        dismissEnabled = !saving,
        confirmLabel = if (milestone == null) "Erstellen" else "Sichern",
        confirmEnabled = !saving && name.isNotBlank(),
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    if (milestone == null) session.milestones.create(clientId, name, description, dueDate)
                    else session.milestones.update(milestone.id, name, description, dueDate)
                    onDismiss()
                } catch (e: ApiError) {
                    failure = e
                } finally {
                    saving = false
                }
            }
        },
    ) {
        GroupedList {
            section("main") {
                row("name") { FormTextField(name, { name = it }, "Name", singleLine = true, style = VType.headline, autoFocus = milestone == null) }
                failure?.fieldErrors?.get("name")?.let { row("err") { FieldError(it) } }
                row("due") { OptionalDateRow("Zieldatum", dueDate, { dueDate = it }) }
            }
            section("desc", header = "Beschreibung") { row { FormTextField(description, { description = it }, "Worum geht es?", minLines = 3) } }
            failureSection(failure?.takeIf { it.fieldErrors.isEmpty() })
        }
    }
}
