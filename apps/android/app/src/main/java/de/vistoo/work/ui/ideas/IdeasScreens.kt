package de.vistoo.work.ui.ideas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DonutLarge
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.LibraryAdd
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.Idea
import de.vistoo.work.core.generated.IdeaStatus
import de.vistoo.work.core.generated.UpdateIdeaRequest
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.app.IdeaRoute
import de.vistoo.work.ui.app.navigator
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.AreaContent
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.DotLabel
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.LabeledRow
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.PersonPicker
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.PlainList
import de.vistoo.work.ui.components.PlainRow
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.SearchField
import de.vistoo.work.ui.components.StatusDot
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.failureSection
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

val IdeaStatus.hex: Long
    get() = when (this) {
        IdeaStatus.New -> 0x4A7FD4
        IdeaStatus.Planned -> 0x4F9A5C
        else -> 0x8E8E93
    }

/** Shared idea backlog: search, status filter, newest/oldest first. */
@Composable
fun IdeasScreen(session: SessionModel, nav: NavHostController) {
    val store = session.ideas
    val runner = rememberActionRunner()
    var query by rememberSaveable { mutableStateOf("") }
    var statusRaw by rememberSaveable { mutableStateOf<String?>(null) }
    var newestFirst by rememberSaveable { mutableStateOf(true) }
    var creating by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Idea?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val status = statusRaw?.let { IdeaStatus.from(it) }
    LaunchedEffect(Unit) { if (store.state == LoadState.Idle) store.reload() }

    val q = query.trim().lowercase()
    val visible = store.ideas
        .filter { status == null || it.status == status }
        .filter { q.isEmpty() || it.title.lowercase().contains(q) || it.description.lowercase().contains(q) }
        .let { list -> if (newestFirst) list.sortedByDescending { it.createdAt } else list.sortedBy { it.createdAt } }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Ideen", onBack = { nav.popBackStack() }, actions = {
                MenuButton(if (status == null) Icons.Filled.FilterList else Icons.Outlined.FilterAlt, "Filter", {
                    buildList {
                        add(MenuEntry.Header("Status"))
                        add(MenuEntry.Item("Alle", checked = status == null) { statusRaw = null })
                        for (s in IdeaStatus.knownCases) add(MenuEntry.Item(s.label, checked = s == status) { statusRaw = s.rawValue })
                        add(MenuEntry.Divider)
                        add(MenuEntry.Header("Sortierung"))
                        add(MenuEntry.Item("Neueste zuerst", checked = newestFirst) { newestFirst = true })
                        add(MenuEntry.Item("Älteste zuerst", checked = !newestFirst) { newestFirst = false })
                    }
                }, badge = status != null)
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, "Neue Idee") }
            })
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SearchField(query, { query = it }, "Ideen durchsuchen")
            Box(Modifier.weight(1f)) {
                AreaContent(store.state, store.ideas.isEmpty(), { store.reload() }) {
                    PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; store.reload(); refreshing = false } }) {
                        PlainList {
                            if (store.ideas.isEmpty()) {
                                item("empty") { EmptyState("Noch keine Ideen", Icons.Outlined.Lightbulb, "Halte Ideen fest, bevor sie verloren gehen.") }
                            } else if (visible.isEmpty()) {
                                item("none") { EmptyState("Keine Ergebnisse", Icons.Outlined.SearchOff, if (q.isEmpty()) null else "Keine Treffer für „$query“.") }
                            }
                            for (idea in visible) item(idea.id) {
                                PlainRow {
                                    SwipeRow(start = null, end = SwipeAction("Löschen", Icons.Filled.Delete, Tokens.Palette.destructive) { confirmDelete = idea }) {
                                        MenuTarget({
                                            listOf(
                                                MenuEntry.Submenu("Status", Icons.Outlined.DonutLarge, IdeaStatus.knownCases.map { s ->
                                                    MenuEntry.Item(s.label, checked = idea.status == s) { runner.run("Ändern fehlgeschlagen") { store.setStatus(idea, s) } }
                                                }),
                                                MenuEntry.Item("Löschen", Icons.Filled.Delete, destructive = true) { confirmDelete = idea },
                                            )
                                        }, onClick = { nav.navigate(IdeaRoute(idea.id)) }) { IdeaRow(idea, session.work) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) IdeaCreateView(session) { creating = false }
    confirmDelete?.let { idea ->
        ConfirmDialog("Idee löschen?", "„${idea.title}“ wird gelöscht. Ein daraus erstelltes Issue bleibt bestehen.", "Löschen",
            onConfirm = { runner.run("Löschen fehlgeschlagen") { store.delete(idea) } }, onDismiss = { confirmDelete = null })
    }
    runner.Alerts()
}

@Composable
fun IdeaRow(idea: Idea, work: WorkStore) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(idea.title, color = if (idea.status == IdeaStatus.Irrelevant) Tokens.Palette.mutedForeground else Tokens.Palette.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (idea.description.isNotEmpty()) Text(idea.description, style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.ProvideTextStyle(VType.caption.copy(color = Tokens.Palette.mutedForeground)) {
                    DotLabel(idea.status.label, idea.status.hex)
                    idea.task?.let { Text("#${it.number}") }
                }
            }
        }
        work.person(idea.assigneeId)?.let { Avatar(it.fullName, it.email, size = 24.dp) }
    }
}

/** New idea: title, optional text and owner. */
@Composable
fun IdeaCreateView(session: SessionModel, onDismiss: () -> Unit) {
    val clientId = remember { newClientId() }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var assigneeId by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    FormSheet("Neue Idee", onDismiss, dismissEnabled = !saving, confirmLabel = "Erstellen", confirmEnabled = !saving && title.isNotBlank(), onConfirm = {
        saving = true
        scope.launch {
            try {
                session.ideas.create(clientId, title, description, assigneeId)
                onDismiss()
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }) {
        GroupedList {
            section("main") {
                row("t") { FormTextField(title, { title = it }, "Titel", style = VType.headline, autoFocus = true) }
                failure?.fieldErrors?.get("title")?.let { row("e") { FieldError(it) } }
                row("a") { PersonPicker("Verantwortlich", session.work, assigneeId, { assigneeId = it }, session.userId) }
            }
            section("desc", header = "Beschreibung") { row { FormTextField(description, { description = it }, "Worum geht es?", minLines = 4) } }
            failureSection(failure)
        }
    }
}

/** Idea details: edit fields, create an issue from it, delete. */
@Composable
fun IdeaDetailScreen(session: SessionModel, ideaId: String, nav: NavHostController) {
    val store = session.ideas
    val navigator = navigator()
    val idea = store.idea(ideaId)
    var loadedFrom by remember { mutableStateOf<Idea?>(null) }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<IdeaStatus>(IdeaStatus.New) }
    var assigneeId by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    var issueProjectId by remember { mutableStateOf("") }
    var creatingIssue by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val runner = rememberActionRunner()
    val scope = rememberCoroutineScope()
    val isDirty = loadedFrom?.let { title != it.title || description != it.description || status != it.status || assigneeId != it.assigneeId } ?: false

    fun adopt() {
        val i = store.idea(ideaId) ?: return
        loadedFrom = i
        title = i.title
        description = i.description
        status = i.status
        assigneeId = i.assigneeId
        if (issueProjectId.isEmpty()) issueProjectId = session.work.activeProjects.firstOrNull()?.id ?: ""
    }
    LaunchedEffect(ideaId) {
        if (store.state == LoadState.Idle) store.reload()
        adopt()
    }
    LaunchedEffect(idea) { if (!isDirty) adopt() }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Idee", onBack = { nav.popBackStack() }, actions = {
                if (idea != null) BarButton("Sichern", {
                    saving = true
                    scope.launch {
                        try {
                            store.update(idea.id, UpdateIdeaRequest(
                                title = if (title != idea.title) title.trim() else null,
                                description = if (description != idea.description) description else null,
                                status = if (status != idea.status) status else null,
                                assigneeId = if (assigneeId != idea.assigneeId) Patchable.of(assigneeId) else Patchable.Unset,
                            ))
                            failure = null
                            adopt()
                            runner.success()
                        } catch (e: ApiError) {
                            failure = e
                        } finally {
                            saving = false
                        }
                    }
                }, enabled = !saving && isDirty && title.isNotBlank(), bold = true)
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                idea != null -> GroupedList {
                    section("main") {
                        row("t") { FormTextField(title, { title = it }, "Titel", style = VType.headline) }
                        failure?.fieldErrors?.get("title")?.let { row("te") { FieldError(it) } }
                        row("s") {
                            val options = IdeaStatus.knownCases.map { s -> PickerOption(s, s.label) { StatusDot(s.hex) } } +
                                listOfNotNull((status as? IdeaStatus.Unknown)?.let { PickerOption<IdeaStatus>(it, it.label) })
                            PickerRow("Status", status, options, { status = it })
                        }
                        row("a") { PersonPicker("Verantwortlich", session.work, assigneeId, { assigneeId = it }, session.userId) }
                        failure?.fieldErrors?.get("assigneeId")?.let { row("ae") { FieldError(it) } }
                    }
                    section("desc", header = "Beschreibung") { row { FormTextField(description, { description = it }, "Worum geht es?", minLines = 4) } }
                    failureSection(failure)
                    section("issue", header = "Issue", footer = if (idea.task == null) "Legt eine Aufgabe mit Titel und Beschreibung der Idee an und verknüpft sie." else null) {
                        val task = idea.task
                        when {
                            task != null -> row("task") {
                                ActionRow("#${task.number} ${task.title}", icon = { Icon(Icons.Outlined.Checklist, null) }, onClick = { navigator.linkedTask = task.id })
                            }
                            session.work.activeProjects.isEmpty() -> row("none") {
                                ListRow { Text("Lege zuerst ein Projekt an, um ein Issue zu erstellen.", color = Tokens.Palette.mutedForeground) }
                            }
                            else -> {
                                row("p") {
                                    PickerRow("Projekt", issueProjectId, session.work.activeProjects.map { p -> PickerOption(p.id, p.name) { ProjectDot(p.color) } }, { issueProjectId = it })
                                }
                                row("c") {
                                    ActionRow("Issue erstellen", icon = { Icon(Icons.Outlined.LibraryAdd, null) }, busy = creatingIssue, enabled = issueProjectId.isNotEmpty(), onClick = {
                                        creatingIssue = true
                                        scope.launch {
                                            try {
                                                val t = store.createIssue(idea, issueProjectId)
                                                session.work.merge(t)
                                                failure = null
                                                runner.success()
                                                navigator.linkedTask = t.id
                                            } catch (e: ApiError) {
                                                failure = e
                                            } finally {
                                                creatingIssue = false
                                            }
                                        }
                                    })
                                }
                            }
                        }
                    }
                    section("meta") {
                        session.work.person(idea.createdBy)?.let { c -> row("c") { LabeledRow("Erstellt", "${c.displayName}, ${Formatting.instant(idea.createdAt)}") } }
                        row("u") { LabeledRow("Zuletzt geändert", Formatting.instant(idea.updatedAt)) }
                    }
                    section("delete") { row { ActionRow("Idee löschen …", destructive = true, onClick = { confirmDelete = true }) } }
                }
                store.state == LoadState.Loaded -> EmptyState("Idee gelöscht", Icons.Outlined.DeleteOutline, "Diese Idee gibt es nicht mehr.")
                else -> LoadingView()
            }
        }
    }
    if (confirmDelete && idea != null) {
        ConfirmDialog("Idee löschen?", "Ein daraus erstelltes Issue bleibt bestehen.", "Löschen", onConfirm = {
            scope.launch {
                try {
                    store.delete(idea)
                    nav.popBackStack()
                } catch (e: ApiError) {
                    failure = e
                }
            }
        }, onDismiss = { confirmDelete = false })
    }
    runner.Alerts()
}
