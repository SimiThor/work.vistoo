package de.vistoo.work.ui.team

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.Member
import de.vistoo.work.core.generated.MemberRole
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.TeamStore
import de.vistoo.work.ui.chat.PersonRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.EmailKeyboard
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.SmallProgress
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

/** Team management (members, invitations, roles), reached from Settings. */
@Composable
fun TeamScreen(session: SessionModel, onBack: () -> Unit) {
    val team = session.team
    val runner = rememberActionRunner()
    var showInvite by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Member?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberMainScope()
    LaunchedEffect(Unit) { if (team.state == LoadState.Idle) team.reload() }

    Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = {
        VistooTopBar("Team", onBack = onBack, actions = {
            if (team.isAdmin) IconButton(onClick = { showInvite = true }) { Icon(Icons.Outlined.PersonAdd, "Einladen") }
        })
    }) { padding ->
        PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; team.reload(); refreshing = false } }, Modifier.fillMaxSize().padding(padding)) {
            GroupedList {
                section("members", header = "Mitglieder (${team.members.size})") {
                    if (team.state == LoadState.Loading && team.members.isEmpty()) row("l") { ListRow { SmallProgress() } }
                    (team.state as? LoadState.Failed)?.takeIf { team.members.isEmpty() }?.let { f -> row("f") { ListRow { Text(f.message, color = Tokens.Palette.destructive) } } }
                    for (m in team.members) row(m.userId) { MemberRow(session, team, m, runner) { removing = m } }
                }
                if (team.invitations.isNotEmpty() || team.isAdmin) {
                    section("invitations", header = "Offene Einladungen · ${team.invitations.size}") {
                        if (team.invitations.isEmpty()) row("none") { ListRow { Text("Keine offenen Einladungen.", color = Tokens.Palette.mutedForeground) } }
                        for (inv in team.invitations) row(inv.id) {
                            val resend = { runner.run("Nicht gesendet") { team.resend(inv); notice = "Einladung an ${inv.email} erneut gesendet." } }
                            val revoke = { runner.run("Widerruf fehlgeschlagen") { team.revoke(inv) } }
                            SwipeRow(
                                start = if (team.isAdmin) SwipeAction("Erneut senden", Icons.AutoMirrored.Filled.Send, Tokens.Palette.accentBlue, resend) else null,
                                end = if (team.isAdmin) SwipeAction("Widerrufen", Icons.Filled.Close, Tokens.Palette.destructive, revoke) else null,
                            ) {
                                MenuTarget({
                                    if (!team.isAdmin) emptyList() else listOf(
                                        MenuEntry.Item("Erneut senden", Icons.AutoMirrored.Filled.Send, onClick = resend),
                                        MenuEntry.Item("Widerrufen", Icons.Filled.Close, destructive = true, onClick = revoke),
                                    )
                                }, onClick = null) {
                                    ListRow {
                                        Column {
                                            Text(inv.email)
                                            Text(
                                                if (inv.expired) "Abgelaufen" else "${inv.role.label} · gültig bis ${Formatting.instant(inv.expiresAt)}",
                                                style = VType.caption,
                                                color = if (inv.expired) Tokens.Palette.warningFg else Tokens.Palette.mutedForeground,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (showInvite) InviteSheet(team) { showInvite = false }
    removing?.let { m ->
        ConfirmDialog("Mitglied entfernen?", "${m.displayName} verliert sofort den Zugriff. Aufgaben bleiben erhalten, Zuweisungen werden gelöst.", "Entfernen", onConfirm = {
            runner.run("Entfernen fehlgeschlagen") {
                val n = team.remove(m)
                notice = if (n == 0L) "${m.displayName} wurde entfernt." else "${m.displayName} wurde entfernt. $n Aufgaben sind jetzt nicht zugewiesen."
            }
        }, onDismiss = { removing = null })
    }
    notice?.let { text ->
        AlertDialog(onDismissRequest = { notice = null }, title = { Text("Erledigt") }, text = { Text(text) },
            confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }, containerColor = Tokens.Palette.background)
    }
    runner.Alerts()
}

@Composable
private fun MemberRow(session: SessionModel, team: TeamStore, member: Member, runner: de.vistoo.work.ui.components.ActionRunner, onRemove: () -> Unit) {
    val isMe = member.userId == session.userId
    SwipeRow(start = null, end = if (team.isAdmin && !isMe) SwipeAction("Entfernen", Icons.Outlined.PersonRemove, Tokens.Palette.destructive, onRemove) else null) {
        MenuTarget({
            if (!team.isAdmin) emptyList() else buildList {
                add(MenuEntry.Submenu("Rolle", Icons.Outlined.ManageAccounts, MemberRole.knownCases.map { role ->
                    MenuEntry.Item(role.label, checked = role == member.role) { runner.run("Rolle nicht geändert") { team.changeRole(member, role) } }
                }))
                if (!isMe) add(MenuEntry.Item("Entfernen …", Icons.Outlined.PersonRemove, destructive = true, onClick = onRemove))
            }
        }, onClick = null) {
            ListRow(trailing = { Text(if (isMe) "${member.role.label} · Du" else member.role.label, style = VType.caption, color = Tokens.Palette.mutedForeground) }) {
                PersonRow(member.fullName, member.email, member.email)
            }
        }
    }
}

@Composable
private fun InviteSheet(team: TeamStore, onDismiss: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf<MemberRole>(MemberRole.Member) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberMainScope()
    FormSheet("Einladen", onDismiss, confirmLabel = "Senden", confirmEnabled = !saving && email.contains("@"), onConfirm = {
        saving = true
        scope.launch {
            try {
                team.invite(email.trim().lowercase(), role)
                onDismiss()
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }) {
        GroupedList {
            section("main", footer = "Die Einladung ist ${DomainDefaults.invitationTtlDays} Tage gültig und nur für diese Adresse nutzbar.") {
                row("e") { FormTextField(email, { email = it }, "E-Mail-Adresse", singleLine = true, keyboardOptions = EmailKeyboard, autoFocus = true) }
                row("r") { PickerRow("Rolle", role, MemberRole.knownCases.map { PickerOption(it, it.label) }, { role = it }) }
            }
            failure?.let { f -> section("f") { row { FieldError(f.fieldErrors["email"] ?: f.message) } } }
        }
    }
}
