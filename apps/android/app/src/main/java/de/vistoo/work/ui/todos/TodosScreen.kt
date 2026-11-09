package de.vistoo.work.ui.todos

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.focus.FocusRequester
import de.vistoo.work.core.generated.Todo
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.AreaContent
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import kotlinx.coroutines.launch

/** "Meine To-dos": private checklist (only the signed-in member sees it). */
@Composable
fun TodosScreen(session: SessionModel, onBack: () -> Unit) {
    val store = session.todos
    val runner = rememberActionRunner()
    var editing by remember { mutableStateOf<Todo?>(null) }
    var showCompleted by rememberSaveable { mutableStateOf(false) }
    var sorting by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { if (store.state == LoadState.Idle) store.reload() }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Meine To-dos", onBack = onBack, actions = {
                if (store.open.size > 1) BarButton(if (sorting) "Fertig" else "Sortieren", { sorting = !sorting }, bold = sorting)
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AreaContent(store.state, store.todos.isEmpty(), { store.reload() }) {
                PullToRefreshBox(refreshing, onRefresh = {
                    scope.launch {
                        refreshing = true
                        store.reload()
                        refreshing = false
                    }
                }) {
                    GroupedList {
                        val open = store.open
                        section(
                            "open",
                            footer = if (open.isEmpty()) "Nichts offen. Neue To-dos landen oben in der Liste." else "Nur du siehst deine To-dos. „Sortieren“ ändert die Reihenfolge.",
                        ) {
                            row("add") { TodoQuickAddRow(store, focus) { runner.failure = it } }
                            open.forEachIndexed { index, todo ->
                                row(todo.id) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(Modifier.weight(1f)) {
                                            TodoRow(
                                                todo,
                                                toggle = { runner.run("Ändern fehlgeschlagen") { store.setCompleted(todo, !todo.completed) } },
                                                open = { editing = todo },
                                                delete = { runner.run("Löschen fehlgeschlagen") { store.delete(todo) } },
                                            )
                                        }
                                        if (sorting) {
                                            IconButton(onClick = { runner.run("Sortieren fehlgeschlagen") { store.move(todo.id, index - 1) } }, enabled = index > 0) {
                                                Icon(Icons.Filled.KeyboardArrowUp, "Eins nach oben: ${todo.title}")
                                            }
                                            IconButton(onClick = { runner.run("Sortieren fehlgeschlagen") { store.move(todo.id, index + 1) } }, enabled = index < open.size - 1) {
                                                Icon(Icons.Filled.KeyboardArrowDown, "Eins nach unten: ${todo.title}")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        val completed = store.completed
                        if (completed.isNotEmpty()) {
                            section("done", header = "Erledigt (${completed.size})", expanded = showCompleted, onToggle = { showCompleted = !showCompleted }) {
                                for (todo in completed) row(todo.id) {
                                    TodoRow(
                                        todo,
                                        toggle = { runner.run("Ändern fehlgeschlagen") { store.setCompleted(todo, !todo.completed) } },
                                        open = { editing = todo },
                                        delete = { runner.run("Löschen fehlgeschlagen") { store.delete(todo) } },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    editing?.let { TodoEditView(store, it) { editing = null } }
    runner.Alerts()
}
