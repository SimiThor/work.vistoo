package de.vistoo.work.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material.icons.outlined.ViewTimeline
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.TaskFilters
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.ui.app.AccountButton
import de.vistoo.work.ui.app.Navigator
import de.vistoo.work.ui.app.navigator
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FailureView
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.SearchField
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.rememberPreference
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

enum class WorkMode(val label: String) { Board("Board"), Timeline("Zeitachse") }

/** Bundle-friendly form of [TaskFilters]. */
val TaskFiltersSaver = androidx.compose.runtime.saveable.listSaver<TaskFilters, Any>(
    save = { listOf(it.query, ArrayList(it.projects), ArrayList(it.assignees), ArrayList(it.statuses.map { s -> s.rawValue })) },
    restore = {
        @Suppress("UNCHECKED_CAST")
        TaskFilters(
            query = it[0] as String,
            projects = (it[1] as List<String>).toSet(),
            assignees = (it[2] as List<String>).toSet(),
            statuses = (it[3] as List<String>).map { raw -> TaskStatus.from(raw) }.toSet(),
        )
    },
)

/**
 * Board + timeline over the same tasks, for "Alle Aufgaben" or one project.
 * Search and filters behave exactly like the web (shared semantics).
 *
 * Toolbar: only "+" is always visible. View mode, "Nur meine", filters, sorting and the
 * caller's extra actions (e.g. project actions) share one menu.
 */
@Composable
fun WorkScreen(
    session: SessionModel,
    scope: WorkScope,
    title: String,
    onBack: (() -> Unit)?,
    extraMenu: List<MenuEntry> = emptyList(),
) {
    val work = session.work
    var modeRaw by rememberPreference("vistoo.work.mode", WorkMode.Board.name)
    var lastProjectId by rememberPreference("vistoo.work.lastProject", "")
    // Saveable: search and filters survive tab switches and rotation (iOS keeps each tab alive).
    var filters by rememberSaveable(stateSaver = TaskFiltersSaver) { mutableStateOf(TaskFilters()) }
    var showFilters by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf<WorkStore.TaskDraft?>(null) }
    var openTask by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var boardStatusRaw by rememberSaveable { mutableStateOf(TaskStatus.Open.rawValue) }
    var sorting by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val coroutines = rememberMainScope()
    val nav = navigator()

    val mode = runCatching { WorkMode.valueOf(modeRaw) }.getOrDefault(WorkMode.Board)
    val boardStatus = TaskStatus.from(boardStatusRaw)
    val scopeProject = (scope as? WorkScope.OfProject)?.let { work.project(it.id) }
    val readOnly = scopeProject?.archived ?: false
    val visibleTasks = work.tasks(scope).filter(filters::matches)
    val canSort = mode == WorkMode.Board && !readOnly && visibleTasks.count { it.status == boardStatus } > 1
    val onlyMine = filters.assignees == setOf(session.userId)

    LaunchedEffect(scope) {
        if (scope is WorkScope.OfProject && work.project(scope.id)?.archived == true) work.loadTasks(scope.id)
    }
    LaunchedEffect(modeRaw, boardStatusRaw) { sorting = false }

    /** New tasks inherit unambiguous filter values so they stay visible (web rule); otherwise the last project. */
    fun newTask(status: TaskStatus) {
        val projectId = (scope as? WorkScope.OfProject)?.id ?: filters.projects.singleOrNull()
        val last = work.project(lastProjectId)?.takeIf { !it.archived }?.id
        val fallback = projectId ?: last ?: work.activeProjects.firstOrNull()?.id ?: return
        val assigneeId = filters.assignees.singleOrNull()?.takeIf { it != DomainDefaults.unassigned }
        draft = WorkStore.TaskDraft(projectId = fallback, status = status, assigneeIds = listOfNotNull(assigneeId))
    }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar(
                title = title,
                large = onBack == null,
                onBack = onBack,
                navigationIcon = if (scope == WorkScope.All) ({ AccountButton(session) }) else null,
                actions = {
                    if (sorting) {
                        BarButton("Fertig", { sorting = false }, bold = true)
                    } else {
                        MenuButton(
                            icon = if (filters.count > 0) Icons.Outlined.FilterAlt else Icons.Filled.FilterList,
                            contentDescription = if (filters.count > 0) "Ansicht und Filter, ${filters.count} Filter aktiv" else "Ansicht und Filter",
                            badge = filters.count > 0,
                            entries = {
                                buildList {
                                    add(MenuEntry.Header("Ansicht"))
                                    add(MenuEntry.Item("Board", Icons.Outlined.ViewKanban, checked = mode == WorkMode.Board) { modeRaw = WorkMode.Board.name })
                                    add(MenuEntry.Item("Zeitachse", Icons.Outlined.ViewTimeline, checked = mode == WorkMode.Timeline) { modeRaw = WorkMode.Timeline.name })
                                    add(MenuEntry.Divider)
                                    add(MenuEntry.Item("Nur meine Aufgaben", Icons.Outlined.AccountCircle, checked = onlyMine) {
                                        filters = filters.copy(assignees = if (onlyMine) emptySet() else setOf(session.userId))
                                    })
                                    add(MenuEntry.Item(if (filters.count > 0) "Filter (${filters.count}) …" else "Filter …", Icons.Filled.FilterList) { showFilters = true })
                                    if (filters.count > 0) add(MenuEntry.Item("Filter zurücksetzen", Icons.Filled.Close) { filters = TaskFilters(query = filters.query) })
                                    if (canSort) {
                                        add(MenuEntry.Divider)
                                        add(MenuEntry.Item("Reihenfolge ändern", Icons.AutoMirrored.Filled.Sort) { sorting = true })
                                    }
                                    if (extraMenu.isNotEmpty()) {
                                        add(MenuEntry.Divider)
                                        addAll(extraMenu)
                                    }
                                }
                            },
                        )
                        if (!readOnly) {
                            IconButton(onClick = { newTask(if (mode == WorkMode.Board) boardStatus else TaskStatus.Open) }, enabled = work.activeProjects.isNotEmpty()) {
                                Icon(Icons.Filled.Add, "Neue Aufgabe")
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                work.state == LoadState.Loading && work.tasksById.isEmpty() -> LoadingView()
                work.state is LoadState.Failed && work.tasksById.isEmpty() -> FailureView((work.state as LoadState.Failed).message) { work.reload() }
                work.activeProjects.isEmpty() && scope == WorkScope.All -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState("Noch keine Projekte", Icons.Outlined.CreateNewFolder, "Aufgaben gehören immer zu einem Projekt. Lege zuerst ein Projekt an.") {
                        Button(onClick = { nav.tab = Navigator.Tab.Projects }) { Text("Zu den Projekten") }
                    }
                }
                else -> {
                    SearchField(filters.query, { filters = filters.copy(query = it) }, "Aufgaben suchen")
                    if (readOnly) {
                        Row(
                            Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle).padding(vertical = 4.dp),
                            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Archive, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(14.dp))
                            Text("Archiviert – nur lesbar", style = VType.footnote, color = Tokens.Palette.mutedForeground, modifier = Modifier.padding(start = 6.dp))
                        }
                    }
                    if (filters.count > 0) {
                        // Always visible while filters hide tasks, so nothing seems to be "missing".
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 40.dp).background(Tokens.Palette.accentBlueSoft).padding(start = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.FilterAlt, null, tint = Tokens.Palette.accentBlue, modifier = Modifier.size(18.dp))
                            Text(
                                if (onlyMine) "Nur meine Aufgaben" else if (filters.count == 1) "1 Filter aktiv" else "${filters.count} Filter aktiv",
                                style = VType.footnote,
                                modifier = Modifier.weight(1f).padding(start = 8.dp).clickable { showFilters = true },
                            )
                            TextButton(onClick = { filters = TaskFilters(query = filters.query) }) { Text("Zurücksetzen", style = VType.footnote) }
                        }
                    }
                    PullToRefreshBox(
                        isRefreshing = refreshing,
                        onRefresh = {
                            coroutines.launch {
                                refreshing = true
                                work.reload()
                                refreshing = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        when (mode) {
                            WorkMode.Board -> BoardView(
                                session = session,
                                scope = scope,
                                tasks = visibleTasks,
                                filtersActive = filters.isActive,
                                status = boardStatus,
                                onStatus = { boardStatusRaw = it.rawValue },
                                sorting = sorting,
                                onOpen = { openTask = it.id to false },
                                onAdd = if (readOnly) null else ({ newTask(it) }),
                            )
                            WorkMode.Timeline -> TimelineView(session, scope, visibleTasks) { task, dates -> openTask = task.id to dates }
                        }
                    }
                }
            }
        }
    }

    if (showFilters) FilterSheet(work, scope, filters, { filters = it }) { showFilters = false }
    draft?.let { d -> TaskCreateView(session, d, onCreated = { lastProjectId = it.projectId }) { draft = null } }
    openTask?.let { (id, dates) -> TaskDetailView(session, id, focusDates = dates) { openTask = null } }
}
