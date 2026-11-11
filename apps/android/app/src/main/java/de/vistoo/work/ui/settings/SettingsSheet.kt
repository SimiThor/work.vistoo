package de.vistoo.work.ui.settings

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import de.vistoo.work.core.generated.UpdateNotificationSettingsRequest
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.ui.chat.StorageUsageRow
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.FullScreenSheet
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.NavRow
import de.vistoo.work.ui.components.SmallProgress
import de.vistoo.work.ui.components.ToggleRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.team.TeamScreen
import de.vistoo.work.ui.theme.VType
import kotlinx.serialization.Serializable

@Serializable private data object SettingsRoute
@Serializable private data object TeamRoute

/**
 * Settings sheet (behind the avatar): own account, notifications, team management,
 * chat storage (admins), sign-out. Deliberately out of the tab bar: rarely needed.
 */
@Composable
fun SettingsSheet(app: AppModel, session: SessionModel, onDismiss: () -> Unit) {
    val nav = rememberNavController()
    FullScreenSheet(onDismiss) {
        NavHost(nav, startDestination = SettingsRoute) {
            composable<SettingsRoute> { SettingsScreen(app, session, onDismiss) { nav.navigate(TeamRoute) } }
            composable<TeamRoute> { TeamScreen(session) { nav.popBackStack() } }
        }
    }
}

@Composable
private fun SettingsScreen(app: AppModel, session: SessionModel, onDone: () -> Unit, openTeam: () -> Unit) {
    val context = LocalContext.current
    val runner = rememberActionRunner()
    val notifications = session.notifications
    var editingName by remember { mutableStateOf(false) }
    var nameText by remember { mutableStateOf("") }
    var confirmSignOut by remember { mutableStateOf(false) }
    // Android 13+: notification permission (prepared for push; see README).
    fun granted() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    var permission by remember { mutableStateOf(granted()) }
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission = it }
    LaunchedEffect(Unit) { if (notifications.settings == null) notifications.load() }

    fun toggle(patch: UpdateNotificationSettingsRequest) = runner.run("Nicht gespeichert") { notifications.update(patch) }

    Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = {
        VistooTopBar("Einstellungen", actions = { BarButton("Fertig", onDone, bold = true) })
    }) { padding ->
        GroupedList(Modifier.fillMaxSize().padding(padding)) {
            section("account", header = "Mein Konto") {
                row("me") {
                    ListRow(leading = { Avatar(session.viewer.fullName, session.viewer.email, size = 44.dp) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(session.viewer.displayName, style = VType.headline)
                            Text(session.viewer.email, style = VType.caption, color = Tokens.Palette.mutedForeground)
                            Text("${session.viewer.role.label} · ${session.viewer.workspaceName}", style = VType.caption, color = Tokens.Palette.mutedForeground)
                        }
                    }
                }
                row("name") {
                    ActionRow("Namen ändern", onClick = {
                        nameText = session.viewer.fullName ?: ""
                        editingName = true
                    })
                }
            }
            section(
                "notifications",
                header = "Mitteilungen",
                footer = "Du bekommst eine Mitteilung, wenn dir jemand schreibt oder dir eine Aufgabe zuweist. Eigene Aktionen lösen keine Mitteilung aus. " +
                    "Die Auswahl gilt für alle deine Geräte. Push-Mitteilungen auf Android-Geräten folgen; bis dahin kommen sie auf deinen iOS-Geräten an.",
            ) {
                if (!permission && Build.VERSION.SDK_INT >= 33) row("perm") {
                    ActionRow("Mitteilungen erlauben", onClick = { requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS) })
                }
                val s = notifications.settings
                if (s != null) {
                    row("dm") { ToggleRow("Direktnachrichten", s.directMessages, { toggle(UpdateNotificationSettingsRequest(directMessages = it)) }, Icons.AutoMirrored.Outlined.Message) }
                    row("ch") { ToggleRow("Nachrichten in Kanälen", s.channelMessages, { toggle(UpdateNotificationSettingsRequest(channelMessages = it)) }, Icons.Outlined.Tag) }
                    row("ta") { ToggleRow("Neue Aufgaben für mich", s.taskAssignments, { toggle(UpdateNotificationSettingsRequest(taskAssignments = it)) }, Icons.Outlined.Checklist) }
                } else {
                    row("load") { ListRow { SmallProgress() } }
                }
                row("system") {
                    ActionRow("Android-Einstellungen öffnen", onClick = {
                        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                    })
                }
            }
            section("team", header = "Team") {
                row {
                    NavRow(
                        if (session.isAdmin) "Mitglieder & Einladungen" else "Mitglieder",
                        openTeam,
                        icon = { Icon(Icons.Outlined.Groups, null, tint = Tokens.Palette.accentBlue) },
                        detail = "${session.work.members.size}",
                    )
                }
            }
            session.chat.storageUsage?.let { usage -> section("chat", header = "Chat") { row { StorageUsageRow(usage) } } }
            section("signout", footer = app.configuration?.let { "Vistoo Work · Version ${it.version} (${it.build})" }) {
                row { ActionRow("Abmelden", destructive = true, onClick = { confirmSignOut = true }) }
            }
        }
    }
    if (editingName) {
        AlertDialog(
            onDismissRequest = { editingName = false },
            title = { Text("Dein Name") },
            text = { OutlinedTextField(nameText, { nameText = it }, label = { Text("Vor- und Nachname") }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    editingName = false
                    runner.run("Name nicht gespeichert") {
                        session.team.updateOwnName(nameText.trim())
                        // The own name appears in the account section and in every person picker/row.
                        session.refreshViewer()
                    }
                }) { Text("Sichern") }
            },
            dismissButton = { TextButton(onClick = { editingName = false }) { Text("Abbrechen") } },
            containerColor = Tokens.Palette.background,
        )
    }
    if (confirmSignOut) {
        ConfirmDialog(
            "Abmelden?",
            "Lokale Daten dieser Anmeldung werden von diesem Gerät entfernt.",
            "Abmelden",
            onConfirm = { runner.run("Abmelden fehlgeschlagen") { app.signOut() } },
            onDismiss = { confirmSignOut = false },
        )
    }
    runner.Alerts()
}
