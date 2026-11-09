package de.vistoo.work.ui.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.FolderOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.Project
import de.vistoo.work.core.generated.ProjectColorDefinition
import de.vistoo.work.core.generated.ProjectStat
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.app.AccountButton
import de.vistoo.work.ui.app.ProjectRoute
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.colorOf
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.WorkScreen
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

sealed interface ProjectEditorTarget {
    data object Create : ProjectEditorTarget
    data class Edit(val project: Project) : ProjectEditorTarget
}

@Composable
fun ProjectsScreen(session: SessionModel, nav: NavHostController) {
    val work = session.work
    val runner = rememberActionRunner()
    var editing by remember { mutableStateOf<ProjectEditorTarget?>(null) }
    var showArchived by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun archive(p: Project, archived: Boolean) =
        runner.run(if (archived) "Archivieren fehlgeschlagen" else "Wiederherstellen fehlgeschlagen") { work.setArchived(p.id, archived) }

    fun entries(p: Project): List<MenuEntry> = if (p.archived) {
        listOf(MenuEntry.Item("Wiederherstellen", Icons.AutoMirrored.Filled.Undo) { archive(p, false) })
    } else {
        listOf(
            MenuEntry.Item("Bearbeiten", Icons.Filled.Edit) { editing = ProjectEditorTarget.Edit(p) },
            MenuEntry.Item("Archivieren", Icons.Outlined.Archive) { archive(p, true) },
        )
    }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Projekte", large = true, navigationIcon = { AccountButton(session) }, actions = {
                IconButton(onClick = { editing = ProjectEditorTarget.Create }) { Icon(Icons.Filled.Add, "Neues Projekt") }
            })
        },
    ) { padding ->
        PullToRefreshBox(refreshing, onRefresh = {
            scope.launch {
                refreshing = true
                work.reload()
                refreshing = false
            }
        }, Modifier.fillMaxSize().padding(padding)) {
            GroupedList {
                if (work.activeProjects.isEmpty()) {
                    item("empty") { EmptyState("Noch keine Projekte", Icons.Outlined.CreateNewFolder, "Projekte bündeln Aufgaben, Gruppen und Termine.") }
                }
                section("active") {
                    for (p in work.activeProjects) row(p.id) {
                        SwipeRow(
                            start = SwipeAction("Bearbeiten", Icons.Filled.Edit, Tokens.Palette.accentBlue) { editing = ProjectEditorTarget.Edit(p) },
                            end = SwipeAction("Archivieren", Icons.Outlined.Archive, Tokens.Palette.mutedForeground) { archive(p, true) },
                        ) {
                            MenuTarget({ entries(p) }, onClick = { nav.navigate(ProjectRoute(p.id)) }) { ProjectRow(p, work.projectStats[p.id]) }
                        }
                    }
                }
                if (work.archivedProjects.isNotEmpty()) {
                    section(
                        "archived",
                        header = "Archiviert (${work.archivedProjects.size})",
                        expanded = showArchived,
                        onToggle = { showArchived = !showArchived },
                    ) {
                        for (p in work.archivedProjects) row(p.id) {
                            SwipeRow(start = null, end = SwipeAction("Wiederherstellen", Icons.AutoMirrored.Filled.Undo, Tokens.Palette.accentBlue) { archive(p, false) }) {
                                MenuTarget({ entries(p) }, onClick = { nav.navigate(ProjectRoute(p.id)) }) { ProjectRow(p, work.projectStats[p.id]) }
                            }
                        }
                    }
                }
            }
        }
    }
    editing?.let { ProjectEditor(session, it) { editing = null } }
    runner.Alerts()
}

@Composable
fun ProjectRow(project: Project, stat: ProjectStat?) {
    ListRow(
        modifier = Modifier.semantics(mergeDescendants = true) {},
        leading = { ProjectDot(project.color) },
        trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (stat != null && stat.total > 0) {
                    Text(
                        "${stat.done}/${stat.total}",
                        style = VType.caption,
                        color = Tokens.Palette.mutedForeground,
                        modifier = Modifier.semantics { contentDescription = "${stat.done} von ${stat.total} erledigt" },
                    )
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Tokens.Palette.borderStrong)
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(project.name, style = VType.body)
            if (project.description.isNotEmpty()) {
                Text(project.description, style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** A project's work view (board + timeline), with project actions. */
@Composable
fun ProjectDetailScreen(session: SessionModel, projectId: String, onBack: () -> Unit) {
    val project = session.work.project(projectId)
    val runner = rememberActionRunner()
    var editing by remember { mutableStateOf<ProjectEditorTarget?>(null) }
    if (project == null) {
        Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = { VistooTopBar("Projekt", onBack = onBack) }) { padding ->
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState("Projekt nicht gefunden", Icons.Outlined.FolderOff)
            }
        }
        return
    }
    WorkScreen(
        session, WorkScope.OfProject(projectId), project.name, onBack = onBack,
        extraMenu = buildList {
            if (!project.archived) add(MenuEntry.Item("Projekt bearbeiten", Icons.Filled.Edit) { editing = ProjectEditorTarget.Edit(project) })
            add(
                if (project.archived) {
                    MenuEntry.Item("Wiederherstellen", Icons.AutoMirrored.Filled.Undo) { runner.run("Aktion fehlgeschlagen") { session.work.setArchived(project.id, false) } }
                } else {
                    MenuEntry.Item("Projekt archivieren", Icons.Outlined.Archive) { runner.run("Aktion fehlgeschlagen") { session.work.setArchived(project.id, true) } }
                },
            )
        },
    )
    editing?.let { ProjectEditor(session, it) { editing = null } }
    runner.Alerts()
}

@Composable
fun ProjectEditor(session: SessionModel, target: ProjectEditorTarget, onDismiss: () -> Unit) {
    val edit = (target as? ProjectEditorTarget.Edit)?.project
    var name by remember { mutableStateOf(edit?.name ?: "") }
    var description by remember { mutableStateOf(edit?.description ?: "") }
    var color by remember { mutableStateOf(edit?.color ?: "slate") }
    /** Stable client id for "create": retries never duplicate the project. */
    val clientId = remember { newClientId() }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()

    FormSheet(
        title = if (edit == null) "Neues Projekt" else "Projekt bearbeiten",
        onDismiss = onDismiss,
        dismissEnabled = !saving,
        confirmLabel = if (edit == null) "Erstellen" else "Sichern",
        confirmEnabled = !saving && name.isNotBlank(),
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    if (edit == null) session.work.createProject(clientId, name.trim(), description.trim(), color)
                    else session.work.updateProject(edit.id, name.trim(), description.trim(), color)
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
                row("name") { FormTextField(name, { name = it }, "Name", singleLine = true, autoFocus = edit == null) }
                row("desc") { FormTextField(description, { description = it }, "Beschreibung (optional)", minLines = 2) }
            }
            section("color", header = "Farbe") {
                row {
                    FlowRow(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (c in ProjectColorDefinition.all) {
                            val selected = color == c.key
                            Box(
                                Modifier
                                    .size(48.dp)
                                    .clickable { color = c.key }
                                    .semantics {
                                        contentDescription = c.label
                                        this.selected = selected
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    Modifier
                                        .size(30.dp)
                                        .then(if (selected) Modifier.border(1.dp, Tokens.Palette.foreground.copy(alpha = 0.6f), CircleShape) else Modifier)
                                        .padding(if (selected) 3.dp else 0.dp)
                                        .background(colorOf(c.hex), CircleShape),
                                )
                            }
                        }
                    }
                }
            }
            failure?.let { f -> section("failure") { row { FieldError(f.fieldErrors["name"] ?: f.message) } } }
        }
    }
}
