package de.vistoo.work.ui.tasks

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.CreateTaskRequest
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.Milestone
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.UpdateTaskRequest
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.ChoiceDialog
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.FullScreenSheet
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.LabeledRow
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.OptionalDateRow
import de.vistoo.work.ui.components.PersonPicker
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.StatusIcon
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.components.shareLink
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.launch

/** Editable fields shared by "create" and "edit". */
data class TaskFields(
    val title: String = "",
    val description: String = "",
    val status: TaskStatus = TaskStatus.Open,
    val projectId: String = "",
    val assigneeId: String? = null,
    val milestoneId: String? = null,
    val startDate: CalendarDate? = null,
    val endDate: CalendarDate? = null,
) {
    val titleProblem: String?
        get() {
            val t = title.trim()
            if (t.isEmpty()) return "Bitte gib einen Titel ein."
            if (t.length > CreateTaskRequest.titleMaxLength) return "Der Titel darf höchstens ${CreateTaskRequest.titleMaxLength} Zeichen lang sein."
            return null
        }

    val dateProblem: String?
        get() = if (startDate != null && endDate != null && endDate < startDate) "Das Enddatum darf nicht vor dem Startdatum liegen." else null

    val isValid: Boolean get() = titleProblem == null && dateProblem == null && description.length <= CreateTaskRequest.descriptionMaxLength

    companion object {
        fun of(task: TaskItem) = TaskFields(task.title, task.description, task.status, task.projectId, task.assigneeId, task.milestoneId, task.startDate, task.endDate)
        fun of(draft: WorkStore.TaskDraft) = TaskFields(title = draft.title, status = draft.status, projectId = draft.projectId, assigneeId = draft.assigneeId)
    }
}

/** The form sections. */
fun LazyListScope.taskFieldsForm(
    work: WorkStore,
    fields: TaskFields,
    onChange: (TaskFields) -> Unit,
    readOnly: Boolean = false,
    serverErrors: Map<String, String> = emptyMap(),
    viewerId: String?,
    isCreate: Boolean = false,
    milestones: List<Milestone> = emptyList(),
) {
    val projects = work.activeProjects + listOfNotNull(work.project(fields.projectId)?.takeIf { it.archived })
    val projectPicker: @Composable () -> Unit = {
        PickerRow(
            "Projekt",
            fields.projectId,
            projects.map { p -> PickerOption(p.id, p.name) { ProjectDot(p.color) } },
            { onChange(fields.copy(projectId = it)) },
            enabled = !readOnly,
        )
    }
    section("main") {
        row("title") {
            FormTextField(
                fields.title, { onChange(fields.copy(title = it)) }, "Titel",
                style = VType.headline, enabled = !readOnly, autoFocus = isCreate,
            )
        }
        val problem = serverErrors["title"] ?: if (fields.title.isEmpty()) null else fields.titleProblem
        if (problem != null) row("titleError") { FieldError(problem) }
        row("status") {
            val options = TaskStatus.knownCases.map { s -> PickerOption(s, s.label) { StatusIcon(s) } } +
                listOfNotNull((fields.status as? TaskStatus.Unknown)?.let { PickerOption<TaskStatus>(it, it.label) })
            PickerRow("Status", fields.status, options, { onChange(fields.copy(status = it)) }, enabled = !readOnly)
        }
        if (isCreate) row("project") { projectPicker() }
        row("assignee") {
            PersonPicker("Verantwortlich", work, fields.assigneeId, { onChange(fields.copy(assigneeId = it)) }, viewerId, noneLabel = "Nicht zugewiesen", enabled = !readOnly)
        }
        if (viewerId != null && fields.assigneeId != viewerId && !readOnly) {
            row("assignMe") {
                ActionRow("Mir zuweisen", icon = { Icon(Icons.Outlined.HowToReg, null) }, onClick = { onChange(fields.copy(assigneeId = viewerId)) })
            }
        }
    }
    val start = fields.startDate
    val end = fields.endDate
    section(
        "dates",
        header = "Zeitraum",
        footer = if (start != null && end != null && fields.dateProblem == null) {
            val days = CalendarDate.durationDays(start, end)
            if (days == 1L) "1 Tag" else "$days Tage"
        } else null,
    ) {
        row("start") { OptionalDateRow("Start", start, { onChange(fields.copy(startDate = it)) }, enabled = !readOnly, defaultDate = { end ?: CalendarDate.today() }) }
        row("end") { OptionalDateRow("Ende", end, { onChange(fields.copy(endDate = it)) }, enabled = !readOnly, defaultDate = { start ?: CalendarDate.today() }) }
        (serverErrors["endDate"] ?: fields.dateProblem)?.let { p -> row("dateError") { FieldError(p) } }
    }
    section("description", header = "Beschreibung") {
        row { FormTextField(fields.description, { onChange(fields.copy(description = it)) }, "Details, Kontext, Links …", minLines = 4, enabled = !readOnly) }
    }
    if (milestones.isNotEmpty() || fields.milestoneId != null) {
        section("milestone") {
            row {
                val options = listOf(PickerOption<String?>(null, "Kein Meilenstein")) +
                    milestones.filter { !it.completed || it.id == fields.milestoneId }.map { PickerOption<String?>(it.id, it.name) } +
                    listOfNotNull(fields.milestoneId?.takeIf { id -> milestones.none { it.id == id } }?.let { PickerOption<String?>(it, "Meilenstein") })
                PickerRow("Meilenstein", fields.milestoneId, options, { onChange(fields.copy(milestoneId = it)) }, enabled = !readOnly)
            }
        }
    }
    // Rarely changed after creation, so below the everyday fields when editing.
    if (!isCreate) section("project") { row { projectPicker() } }
}

@Composable
fun FailureRow(error: ApiError, footer: String? = null) {
    ListRow(leading = {
        Icon(if (error.isConnectivityProblem) Icons.Outlined.WifiOff else Icons.Outlined.WarningAmber, null, tint = Tokens.Palette.destructive)
    }) { Text(error.message, color = Tokens.Palette.destructive) }
}

/** Section with the error of the last failed save (iOS `FailureSection`). */
fun LazyListScope.failureSection(error: ApiError?, footer: String? = null) {
    if (error == null) return
    section("failure", footer = footer) { row { FailureRow(error) } }
}

// MARK: - Create

@Composable
fun TaskCreateView(session: SessionModel, draft: WorkStore.TaskDraft, onCreated: (TaskItem) -> Unit = {}, onDismiss: () -> Unit) {
    var fields by remember(draft.id) { mutableStateOf(TaskFields.of(draft)) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(Unit) { if (session.milestones.state == LoadState.Idle) session.milestones.reload() }

    fun save() {
        saving = true
        scope.launch {
            // Keeps the client id: retries never duplicate.
            val d = draft.copy(
                title = fields.title, description = fields.description, status = fields.status, projectId = fields.projectId,
                assigneeId = fields.assigneeId, milestoneId = fields.milestoneId, startDate = fields.startDate, endDate = fields.endDate,
            )
            try {
                val task = session.work.createTask(d)
                onCreated(task)
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                onDismiss()
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }

    FormSheet(
        title = "Neue Aufgabe",
        onDismiss = onDismiss,
        dismissEnabled = !saving,
        confirmLabel = "Erstellen",
        confirmEnabled = !saving && fields.isValid,
        onConfirm = ::save,
    ) {
        GroupedList {
            taskFieldsForm(
                session.work, fields, { fields = it }, serverErrors = failure?.fieldErrors.orEmpty(),
                viewerId = session.userId, isCreate = true, milestones = session.milestones.milestones,
            )
            failureSection(failure, if (failure?.isConnectivityProblem == true) "Nichts geht verloren: „Erstellen“ erneut tippen legt die Aufgabe genau einmal an." else null)
        }
    }
}

// MARK: - Detail / edit

/** Task details as a full-screen sheet (from lists, links, milestones, ideas, decisions). */
@Composable
fun TaskDetailView(session: SessionModel, taskId: String, focusDates: Boolean = false, onDismiss: () -> Unit) {
    val work = session.work
    val task = work.task(taskId)
    var fields by remember(taskId) { mutableStateOf(task?.let { TaskFields.of(it) }) }
    /** Fields as last adopted from the server (local edits = fields != base). */
    var base by remember(taskId) { mutableStateOf(fields) }
    /** Version the form is based on (optimistic concurrency). */
    var baseVersion by remember(taskId) { mutableStateOf(task?.version ?: 0L) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    var conflict by remember { mutableStateOf<TaskItem?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val readOnly = task?.let { work.isReadOnly(it) } ?: true
    val isDirty = task != null && fields != null && fields != TaskFields.of(task)
    val title = (if (readOnly) "Aufgabe (archiviert)" else "Aufgabe") + (task?.let { " #${it.number}" } ?: "")

    LaunchedEffect(Unit) { if (session.milestones.state == LoadState.Idle) session.milestones.reload() }
    // Realtime update from someone else: adopt it while there are no local edits.
    LaunchedEffect(task?.version) {
        val t = task ?: return@LaunchedEffect
        if (fields == null || fields == base) {
            fields = TaskFields.of(t)
            base = fields
            baseVersion = t.version
        }
    }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(focusDates) { if (focusDates) listState.animateScrollToItem(4) }

    fun adopt(t: TaskItem) {
        fields = TaskFields.of(t)
        base = fields
        baseVersion = t.version
    }

    /** Sends only the changed fields; `null` clears, omitted stays unchanged. */
    fun save() {
        val t = task ?: return
        val f = fields ?: return
        val original = TaskFields.of(t)
        val patch = UpdateTaskRequest.Patch(
            title = if (f.title != original.title) f.title.trim() else null,
            description = if (f.description != original.description) f.description else null,
            status = if (f.status != original.status) f.status else null,
            projectId = if (f.projectId != original.projectId) f.projectId else null,
            assigneeId = if (f.assigneeId != original.assigneeId) Patchable.of(f.assigneeId) else Patchable.Unset,
            milestoneId = if (f.milestoneId != original.milestoneId) Patchable.of(f.milestoneId) else Patchable.Unset,
            startDate = if (f.startDate != original.startDate) Patchable.of(f.startDate) else Patchable.Unset,
            endDate = if (f.endDate != original.endDate) Patchable.of(f.endDate) else Patchable.Unset,
        )
        saving = true
        scope.launch {
            try {
                val updated = work.updateTask(t.id, baseVersion, patch)
                adopt(updated)
                failure = null
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            } catch (e: ApiError) {
                failure = e
                val current = e.currentTask
                if (e.code == ErrorCode.Conflict && current != null) {
                    work.merge(current)
                    // After a lost response the "conflict" may be our own save.
                    if (TaskFields.of(current) == f) {
                        adopt(current)
                        failure = null
                    } else {
                        conflict = current
                    }
                }
            } finally {
                saving = false
            }
        }
    }

    fun close() = if (isDirty) confirmDiscard = true else onDismiss()

    FullScreenSheet(onDismiss = ::close) {
        Scaffold(
            containerColor = Tokens.Palette.surfaceSubtle,
            topBar = {
                VistooTopBar(
                    title = title,
                    navigationIcon = { BarButton(if (isDirty) "Verwerfen" else "Schließen", ::close) },
                    actions = {
                        if (!readOnly && task != null) BarButton("Sichern", ::save, enabled = !saving && isDirty && fields?.isValid == true, bold = true)
                    },
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                val f = fields
                if (task == null) {
                    EmptyState("Aufgabe gelöscht", Icons.Outlined.DeleteOutline, "Diese Aufgabe gibt es nicht mehr.")
                } else if (f != null) {
                    GroupedList(state = listState) {
                        taskFieldsForm(
                            work, f, { fields = it }, readOnly = readOnly, serverErrors = failure?.fieldErrors.orEmpty(),
                            viewerId = session.userId, milestones = session.milestones.milestones,
                        )
                        if (failure != null && failure?.code != ErrorCode.Conflict) failureSection(failure)
                        section("info") {
                            row("share") {
                                ActionRow("Link zur Aufgabe teilen", icon = { Icon(Icons.Filled.Link, null) }, onClick = {
                                    shareLink(context, session.backend.configuration.taskLink(task.id))
                                })
                            }
                            work.person(task.createdBy)?.let { creator ->
                                row("created") { LabeledRow("Erstellt", "${creator.displayName}, ${Formatting.instant(task.createdAt)}") }
                            }
                            row("updated") { LabeledRow("Zuletzt geändert", Formatting.instant(task.updatedAt)) }
                        }
                        if (!readOnly) section("delete") { row { ActionRow("Aufgabe löschen …", destructive = true, onClick = { confirmDelete = true }) } }
                    }
                }
            }
        }
        if (isDirty) BackHandler { confirmDiscard = true }
    }

    conflict?.let { current ->
        ChoiceDialog("Geändert", "Diese Aufgabe wurde inzwischen von jemand anderem geändert.", { conflict = null }) {
            TextButton(onClick = {
                adopt(current)
                failure = null
                conflict = null
            }) { Text("Aktuelle Version laden") }
            TextButton(onClick = {
                baseVersion = current.version
                conflict = null
                save()
            }) { Text("Trotzdem speichern") }
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            "Aufgabe löschen?", "„${task?.title ?: ""}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.", "Löschen",
            onConfirm = {
                val t = task ?: return@ConfirmDialog
                scope.launch {
                    try {
                        work.deleteTask(t)
                        onDismiss()
                    } catch (e: ApiError) {
                        failure = e
                    }
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
    if (confirmDiscard) {
        ConfirmDialog("Änderungen verwerfen?", null, "Verwerfen", onConfirm = onDismiss, onDismiss = { confirmDiscard = false })
    }
}
