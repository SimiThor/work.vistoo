package de.vistoo.work.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.ChatStorageUsage
import de.vistoo.work.core.generated.ConversationKind
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.Member
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.support.ByteFormatting
import de.vistoo.work.ui.app.AccountButton
import de.vistoo.work.ui.app.ConversationRoute
import de.vistoo.work.ui.components.ActionFailure
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.FailureAlert
import de.vistoo.work.ui.components.FailureView
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.PersonName
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PlainList
import de.vistoo.work.ui.components.PlainRow
import de.vistoo.work.ui.components.SearchField
import de.vistoo.work.ui.components.Segmented
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.home.ConversationRowLabel
import de.vistoo.work.ui.theme.VType
import androidx.compose.foundation.layout.Box
import kotlinx.coroutines.launch

/**
 * Conversation list: unread first, then channels by name ("Allgemein" first), DMs by recent
 * activity, archived collapsed. The storage gauge only shows up when it matters.
 */
@Composable
fun ChatListScreen(session: SessionModel, nav: NavHostController) {
    val chat = session.chat
    var showNewChannel by remember { mutableStateOf(false) }
    var showNewDM by remember { mutableStateOf(false) }
    var showArchived by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val unread = chat.conversations.filter { it.unread && !it.archived }.sortedByDescending { it.lastMessageAt }
    val channels = chat.conversations.filter { it.kind != ConversationKind.Dm && !it.archived && !it.unread }
        .sortedWith(compareBy<de.vistoo.work.core.generated.ConversationSummary> { !it.isDefault }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.title })
    val dms = chat.conversations.filter { it.kind == ConversationKind.Dm && !it.archived && !it.unread }
        .sortedWith(compareByDescending<de.vistoo.work.core.generated.ConversationSummary> { it.lastMessageAt }.thenBy { it.title })
    val archived = chat.conversations.filter { it.archived }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Chat", large = true, navigationIcon = { AccountButton(session) }, actions = {
                MenuButton(Icons.Outlined.EditNote, "Neue Unterhaltung", {
                    listOf(
                        MenuEntry.Item("Neuer Kanal", Icons.Outlined.Tag) { showNewChannel = true },
                        MenuEntry.Item("Neue Direktnachricht", Icons.AutoMirrored.Outlined.Message) { showNewDM = true },
                    )
                })
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                chat.state == LoadState.Loading && chat.conversations.isEmpty() -> LoadingView()
                chat.state is LoadState.Failed && chat.conversations.isEmpty() -> FailureView((chat.state as LoadState.Failed).message) { chat.reload() }
                else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; chat.reload(); refreshing = false } }) {
                    GroupedList {
                        if (unread.isNotEmpty()) section("unread", header = "Ungelesen") {
                            for (c in unread) row(c.id) { ListRow(onClick = { nav.navigate(ConversationRoute(c.id)) }) { ConversationRowLabel(c) } }
                        }
                        if (channels.isNotEmpty()) section("channels", header = "Kanäle") {
                            for (c in channels) row(c.id) { ListRow(onClick = { nav.navigate(ConversationRoute(c.id)) }) { ConversationRowLabel(c) } }
                        }
                        section("dms", header = "Direktnachrichten") {
                            if (dms.isEmpty() && unread.none { it.kind == ConversationKind.Dm }) row("write") {
                                ActionRow("Direktnachricht schreiben", icon = { Icon(Icons.AutoMirrored.Outlined.Message, null) }, onClick = { showNewDM = true })
                            }
                            for (c in dms) row(c.id) { ListRow(onClick = { nav.navigate(ConversationRoute(c.id)) }) { ConversationRowLabel(c) } }
                        }
                        if (archived.isNotEmpty()) section("archived", header = "Archiviert (${archived.size})", expanded = showArchived, onToggle = { showArchived = !showArchived }) {
                            for (c in archived) row(c.id) { ListRow(onClick = { nav.navigate(ConversationRoute(c.id)) }) { ConversationRowLabel(c) } }
                        }
                        // Admins see the full gauge in the settings; here only when uploads are at risk.
                        val usage = chat.storageUsage
                        if (usage != null && usage.ratio >= DomainDefaults.storageWarnRatio) section("storage") { row { StorageUsageRow(usage) } }
                    }
                }
            }
        }
    }
    if (showNewChannel) NewChannelSheet(session, { showNewChannel = false }) { nav.navigate(ConversationRoute(it)) }
    if (showNewDM) NewDirectMessageSheet(session, { showNewDM = false }) { nav.navigate(ConversationRoute(it)) }
}

@Composable
fun StorageUsageRow(usage: ChatStorageUsage) {
    Column(Modifier.fillMaxWidth().padding(16.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row {
            Text("Speicher für Chat-Dateien", style = VType.dense, modifier = Modifier.weight(1f))
            Text("${ByteFormatting.string(usage.usedBytes)} von ${ByteFormatting.string(usage.budgetBytes)}", style = VType.caption, color = Tokens.Palette.mutedForeground)
        }
        LinearProgressIndicator(
            progress = { minOf(usage.ratio, 1.0).toFloat() },
            modifier = Modifier.fillMaxWidth(),
            color = if (usage.ratio >= DomainDefaults.storageWarnRatio) Tokens.Palette.statusReview else Tokens.Palette.accentBlue,
            trackColor = Tokens.Palette.surfaceSunken,
            drawStopIndicator = {},
        )
        if (usage.ratio >= 1) {
            Text("Speicher voll: Uploads sind gesperrt, Nachrichten ohne Anhang gehen weiter.", style = VType.caption, color = Tokens.Palette.warningFg)
        } else if (usage.ratio >= DomainDefaults.storageWarnRatio) {
            Text("Der Speicher ist fast voll.", style = VType.caption, color = Tokens.Palette.warningFg)
        }
    }
}

// MARK: - New conversations

@Composable
fun NewChannelSheet(session: SessionModel, onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf(setOf<String>()) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    FormSheet("Neuer Kanal", onDismiss, confirmLabel = "Erstellen", confirmEnabled = !saving && name.isNotBlank(), onConfirm = {
        saving = true
        scope.launch {
            try {
                val id = session.chat.createChannel(name.trim(), description.trim(), isPrivate, members.toList())
                onDismiss()
                onCreated(id)
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }) {
        GroupedList {
            section("main") {
                row("n") { FormTextField(name, { name = it }, "Name", singleLine = true, autoFocus = true) }
                row("d") { FormTextField(description, { description = it }, "Beschreibung (optional)") }
            }
            section(
                "visibility",
                footer = if (isPrivate) "Nur ausdrücklich hinzugefügte Mitglieder sehen den Kanal. Die Sichtbarkeit lässt sich später nicht ändern."
                else "Alle Mitglieder des Workspaces können lesen und schreiben.",
            ) {
                row { Box(Modifier.padding(12.dp)) { Segmented(listOf(PickerOption(false, "Offen"), PickerOption(true, "Geschlossen")), isPrivate, { isPrivate = it }) } }
            }
            if (isPrivate) section("members", header = "Mitglieder") {
                memberMultiPicker(session.work.members.filter { it.userId != session.userId }, members) { members = it }
            }
            failure?.let { f -> section("failure") { row { FieldError(f.fieldErrors["name"] ?: f.message) } } }
        }
    }
}

fun de.vistoo.work.ui.components.SectionScope.memberMultiPicker(people: List<Member>, selection: Set<String>, onChange: (Set<String>) -> Unit) {
    for (m in people) row(m.userId) {
        val on = m.userId in selection
        ListRow(
            modifier = Modifier.semantics { selected = on },
            onClick = { onChange(if (on) selection - m.userId else selection + m.userId) },
            trailing = { if (on) Icon(Icons.Filled.Check, null, tint = Tokens.Palette.accentBlue) },
        ) { PersonRow(m.fullName, m.email) }
    }
}

@Composable
fun NewDirectMessageSheet(session: SessionModel, onDismiss: () -> Unit, onOpened: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<ActionFailure?>(null) }
    val scope = rememberCoroutineScope()
    val people = session.work.members.filter {
        it.userId != session.userId && (query.isEmpty() || it.displayName.contains(query, ignoreCase = true) || it.email.contains(query, ignoreCase = true))
    }
    FormSheet("Direktnachricht", onDismiss) {
        Column {
            SearchField(query, { query = it }, "Person suchen")
            PlainList {
                for (p in people) item(p.userId) {
                    PlainRow {
                        ListRow(onClick = {
                            scope.launch {
                                try {
                                    val id = session.chat.openDirectMessage(p.userId)
                                    onDismiss()
                                    onOpened(id)
                                } catch (e: ApiError) {
                                    failure = ActionFailure.of("Unterhaltung nicht geöffnet", e)
                                }
                            }
                        }) { PersonRow(p.fullName, p.email, p.email) }
                    }
                }
            }
        }
    }
    FailureAlert(failure) { failure = null }
}

@Composable
fun PersonRow(fullName: String?, email: String, detail: String? = null) {
    Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Avatar(fullName, email, size = 32.dp)
        Column {
            Text(PersonName.display(fullName, email))
            if (detail != null) Text(detail, style = VType.caption, color = Tokens.Palette.mutedForeground)
        }
    }
}
