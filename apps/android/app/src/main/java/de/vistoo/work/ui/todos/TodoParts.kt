package de.vistoo.work.ui.todos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.Todo
import de.vistoo.work.core.generated.UpdateTodoRequest
import de.vistoo.work.core.stores.TodoStore
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.components.ActionFailure
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.DueDateLabel
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.OptionalDateRow
import de.vistoo.work.ui.components.SmallProgress
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.ToggleRow
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.failureSection
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

/** One to-do: checkbox, title, due date. Swipe right toggles, swipe left deletes, long press for all actions. */
@Composable
fun TodoRow(todo: Todo, toggle: () -> Unit, open: () -> Unit, delete: () -> Unit) {
    val toggleLabel = if (todo.completed) "Wieder öffnen" else "Erledigt"
    SwipeRow(
        start = SwipeAction(if (todo.completed) "Öffnen" else "Erledigt", if (todo.completed) Icons.AutoMirrored.Filled.Undo else Icons.Filled.Check, Tokens.Palette.statusDone, toggle),
        end = SwipeAction("Löschen", Icons.Filled.Delete, Tokens.Palette.destructive, delete),
    ) {
        MenuTarget(
            onClick = open,
            entries = {
                listOf(
                    MenuEntry.Item(toggleLabel, if (todo.completed) Icons.AutoMirrored.Filled.Undo else Icons.Filled.Check, onClick = toggle),
                    MenuEntry.Item("Bearbeiten", Icons.Filled.Edit, onClick = open),
                    MenuEntry.Item("Löschen", Icons.Filled.Delete, destructive = true, onClick = delete),
                )
            },
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = toggle, modifier = Modifier.semantics { contentDescription = "$toggleLabel: ${todo.title}" }) {
                    Icon(
                        if (todo.completed) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                        null,
                        tint = if (todo.completed) Tokens.Palette.statusDone else Tokens.Palette.mutedForeground,
                    )
                }
                Column(
                    Modifier.weight(1f).semantics(mergeDescendants = true) {
                        if (todo.completed) stateDescription = "Erledigt"
                        customActions = listOf(CustomAccessibilityAction(toggleLabel) { toggle(); true })
                    },
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        todo.title,
                        style = VType.body.copy(textDecoration = if (todo.completed) TextDecoration.LineThrough else null),
                        color = if (todo.completed) Tokens.Palette.mutedForeground else Tokens.Palette.foreground,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (todo.description.isNotEmpty() || todo.dueDate != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            todo.dueDate?.let { DueDateLabel(it, overdueCheck = !todo.completed) }
                            if (todo.description.isNotEmpty()) {
                                Text(todo.description, style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Inline "add" field: Enter saves and keeps the keyboard open for the next one. */
@Composable
fun TodoQuickAddRow(store: TodoStore, focusRequester: FocusRequester, onFailure: (ActionFailure) -> Unit) {
    var title by remember { mutableStateOf("") }
    /** Kept until the server confirmed: a retry after a network error never duplicates. */
    var clientId by remember { mutableStateOf(newClientId()) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberMainScope()

    fun save() {
        val text = title.trim()
        if (text.isEmpty() || saving) return
        saving = true
        scope.launch {
            try {
                store.create(clientId, text)
                title = ""
                clientId = newClientId()
                runCatching { focusRequester.requestFocus() }
            } catch (e: ApiError) {
                onFailure(ActionFailure.of("To-do nicht gespeichert", e))
            } finally {
                saving = false
            }
        }
    }

    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.AddCircle, null, tint = Tokens.Palette.accentBlue, modifier = Modifier.size(24.dp))
        Column(Modifier.weight(1f)) {
            FormTextField(
                title, { title = it }, "Neues To-do",
                singleLine = true,
                enabled = !saving,
                focusRequester = focusRequester,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
            )
        }
        if (saving) SmallProgress()
    }
}

/** Edit sheet: title, notes, due date, done. */
@Composable
fun TodoEditView(store: TodoStore, todo: Todo, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf(todo.title) }
    var description by remember { mutableStateOf(todo.description) }
    var dueDate by remember { mutableStateOf(todo.dueDate) }
    var completed by remember { mutableStateOf(todo.completed) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberMainScope()
    val isDirty = title != todo.title || description != todo.description || dueDate != todo.dueDate || completed != todo.completed
    val isValid = title.isNotBlank() && title.length <= UpdateTodoRequest.titleMaxLength

    FormSheet(
        title = "To-do",
        onDismiss = onDismiss,
        dismissLabel = if (isDirty) "Verwerfen" else "Schließen",
        confirmLabel = "Sichern",
        confirmEnabled = !saving && isDirty && isValid,
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    store.update(
                        todo.id,
                        UpdateTodoRequest(
                            title = if (title != todo.title) title.trim() else null,
                            description = if (description != todo.description) description else null,
                            dueDate = if (dueDate != todo.dueDate) Patchable.of(dueDate) else Patchable.Unset,
                            completed = if (completed != todo.completed) completed else null,
                        ),
                    )
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
                row("title") { FormTextField(title, { title = it }, "Titel") }
                failure?.fieldErrors?.get("title")?.let { row("err") { FieldError(it) } }
                row("done") { ToggleRow("Erledigt", completed, { completed = it }) }
            }
            section("due", header = "Fällig") { row { OptionalDateRow("Fälligkeitsdatum", dueDate, { dueDate = it }) } }
            section("notes", header = "Notizen") { row { FormTextField(description, { description = it }, "Details …", minLines = 3) } }
            failureSection(failure)
            section("delete") { row { ActionRow("To-do löschen …", destructive = true, onClick = { confirmDelete = true }) } }
        }
    }
    if (confirmDelete) {
        ConfirmDialog("To-do löschen?", null, "Löschen", onConfirm = {
            scope.launch {
                try {
                    store.delete(todo)
                    onDismiss()
                } catch (e: ApiError) {
                    failure = e
                }
            }
        }, onDismiss = { confirmDelete = false })
    }
}
