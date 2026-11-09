package de.vistoo.work.ui.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import de.vistoo.work.core.generated.ChatPerson
import de.vistoo.work.core.generated.ConversationDetail
import de.vistoo.work.core.generated.ConversationKind
import de.vistoo.work.core.stores.ConversationModel
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.FullScreenSheet
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.LabeledRow
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens

/**
 * Channel details and management. Who may do what is decided by the server
 * (`canManage`); the UI only hides what would be refused.
 */
@Composable
fun ConversationDetailsView(session: SessionModel, model: ConversationModel, onDismiss: () -> Unit) {
    val detail = model.detail
    val runner = rememberActionRunner()
    var name by remember { mutableStateOf(detail?.title ?: "") }
    var description by remember { mutableStateOf(detail?.description ?: "") }
    var showAddMembers by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<ChatPerson?>(null) }
    var leaving by remember { mutableStateOf(false) }
    var confirmArchive by remember { mutableStateOf(false) }
    LaunchedEffect(detail?.title, detail?.description) {
        name = detail?.title ?: ""
        description = detail?.description ?: ""
    }

    FullScreenSheet(onDismiss) {
        Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = {
            VistooTopBar(if (detail?.kind == ConversationKind.Dm) "Direktnachricht" else "Kanal", actions = { BarButton("Fertig", onDismiss, bold = true) })
        }) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                if (detail == null) {
                    LoadingView()
                } else {
                    GroupedList {
                        if (detail.kind == ConversationKind.Dm) {
                            detail.dmPartner?.let { p ->
                                section("partner") { row { ListRow { PersonRow(p.fullName, p.email, if (p.active) p.email else "Kein aktives Mitglied mehr") } } }
                            }
                        } else {
                            section(
                                "channel",
                                footer = if (detail.kind == ConversationKind.PrivateChannel) "Geschlossener Kanal: nur für hinzugefügte Mitglieder sichtbar."
                                else "Offener Kanal: für alle Mitglieder des Workspaces.",
                            ) {
                                if (detail.canManage && !detail.archived) {
                                    row("n") { FormTextField(name, { name = it }, "Name", singleLine = true) }
                                    row("d") { FormTextField(description, { description = it }, "Beschreibung") }
                                    row("s") {
                                        ActionRow(
                                            "Änderungen sichern",
                                            enabled = name.isNotBlank() && (name != detail.title || description != detail.description),
                                            onClick = { runner.run("Aktion fehlgeschlagen") { model.updateChannel(name.trim(), description.trim()) } },
                                        )
                                    }
                                } else {
                                    row("n") { LabeledRow("Name", detail.title) }
                                    if (detail.description.isNotEmpty()) row("d") { ListRow { Text(detail.description, color = Tokens.Palette.mutedForeground) } }
                                }
                            }
                            if (detail.kind == ConversationKind.PrivateChannel) {
                                section("members", header = "Mitglieder (${detail.members.size})") {
                                    for (p in detail.members) row(p.userId) {
                                        val canRemove = detail.canManage && p.userId != session.userId && !detail.archived
                                        val label = if (p.userId == detail.ownerId) "Verantwortlich" else if (p.active) null else "Kein aktives Mitglied mehr"
                                        SwipeRow(start = null, end = if (canRemove) SwipeAction("Entfernen", Icons.Outlined.PersonRemove, Tokens.Palette.destructive) { removing = p } else null) {
                                            MenuTarget({ if (canRemove) listOf(MenuEntry.Item("Entfernen", Icons.Outlined.PersonRemove, destructive = true) { removing = p }) else emptyList() }, onClick = null) {
                                                ListRow { PersonRow(p.fullName, p.email, label) }
                                            }
                                        }
                                    }
                                    if (detail.canManage && !detail.archived) row("add") {
                                        ActionRow("Mitglieder hinzufügen", icon = { Icon(Icons.Outlined.PersonAdd, null) }, onClick = { showAddMembers = true })
                                    }
                                }
                            }
                            section("actions", footer = if (detail.isDefault) "„Allgemein“ kann nicht archiviert werden." else null) {
                                if (detail.kind == ConversationKind.PrivateChannel && detail.members.any { it.userId == session.userId }) {
                                    row("leave") { ActionRow("Kanal verlassen …", destructive = true, onClick = { leaving = true }) }
                                }
                                if (detail.canManage && !detail.isDefault) {
                                    row("archive") { ActionRow(if (detail.archived) "Wiederherstellen" else "Archivieren …", destructive = !detail.archived, onClick = { confirmArchive = true }) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (detail != null) {
        if (showAddMembers) AddMembersSheet(session, detail, { showAddMembers = false }) { ids -> runner.run("Aktion fehlgeschlagen") { model.addMembers(ids) } }
        removing?.let { p ->
            ConfirmDialog("Aus dem Kanal entfernen?", "${p.displayName} verliert den Zugriff auf diesen Kanal.", "Entfernen",
                onConfirm = { runner.run("Aktion fehlgeschlagen") { model.removeMember(p.userId) } }, onDismiss = { removing = null })
        }
        if (confirmArchive) {
            ConfirmDialog(
                if (detail.archived) "Kanal wiederherstellen?" else "Kanal archivieren?",
                if (detail.archived) "Neue Nachrichten sind danach wieder möglich." else "Der Verlauf bleibt lesbar, neue Nachrichten sind nicht mehr möglich.",
                if (detail.archived) "Wiederherstellen" else "Archivieren",
                destructive = !detail.archived,
                onConfirm = { runner.run("Aktion fehlgeschlagen") { model.setArchived(!detail.archived) } },
                onDismiss = { confirmArchive = false },
            )
        }
        if (leaving) LeaveSheet(session, detail, { leaving = false }) { newOwner, archive ->
            leaving = false
            runner.run("Aktion fehlgeschlagen") {
                model.removeMember(session.userId, newOwner, archive)
                onDismiss()
            }
        }
    }
    runner.Alerts()
}

@Composable
private fun AddMembersSheet(session: SessionModel, detail: ConversationDetail, onDismiss: () -> Unit, onAdd: (List<String>) -> Unit) {
    var selection by remember { mutableStateOf(setOf<String>()) }
    val existing = detail.members.map { it.userId }.toSet()
    FormSheet("Hinzufügen", onDismiss, confirmLabel = "Hinzufügen", confirmEnabled = selection.isNotEmpty(), onConfirm = {
        onDismiss()
        onAdd(selection.toList())
    }) {
        GroupedList {
            section("people", footer = "Neue Mitglieder sehen den bisherigen Verlauf.") {
                memberMultiPicker(session.work.members.filter { it.userId !in existing }, selection) { selection = it }
            }
        }
    }
}

/** The responsible person hands over or archives (server rule: no orphaned private channels). */
@Composable
private fun LeaveSheet(session: SessionModel, detail: ConversationDetail, onDismiss: () -> Unit, leave: (String?, Boolean) -> Unit) {
    var handoverTo by remember { mutableStateOf<String?>(null) }
    val others = detail.members.filter { it.userId != session.userId && it.active }
    val isOwner = detail.ownerId == session.userId
    FormSheet("Kanal verlassen", onDismiss) {
        GroupedList {
            if (isOwner && others.isNotEmpty()) {
                section("handover", footer = "Du bist verantwortlich. Übergib die Verantwortung oder archiviere den Kanal.") {
                    row {
                        PickerRow("Neue verantwortliche Person", handoverTo,
                            listOf(PickerOption<String?>(null, "Bitte wählen")) + others.map { PickerOption<String?>(it.userId, it.displayName) }, { handoverTo = it })
                    }
                }
                section("actions") {
                    row("h") { ActionRow("Verlassen und übergeben", destructive = true, enabled = handoverTo != null, onClick = { leave(handoverTo, false) }) }
                    row("a") { ActionRow("Verlassen und archivieren", destructive = true, onClick = { leave(null, true) }) }
                }
            } else {
                section("leave", footer = if (others.isEmpty()) "Du bist das letzte Mitglied: Der Kanal wird archiviert." else "Du verlierst den Zugriff auf diesen Kanal.") {
                    row { ActionRow("Kanal verlassen", destructive = true, onClick = { leave(null, others.isEmpty()) }) }
                }
            }
        }
    }
}
