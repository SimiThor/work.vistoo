package de.vistoo.work.ui.auth

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import de.vistoo.work.core.generated.Me
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.NameKeyboard
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import kotlinx.coroutines.launch

/**
 * Signed in without membership: accept the invitation addressed to this e-mail,
 * or explain why there is no access (same states as the web /invite page).
 */
@Composable
fun OnboardingScreen(app: AppModel, me: Me) {
    var fullName by rememberSaveable { mutableStateOf(me.fullName ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberMainScope()
    LaunchedEffect(me.userId) { if (fullName.isEmpty()) fullName = me.fullName ?: "" }

    Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = { VistooTopBar("Einladung") }) { padding ->
        GroupedList(Modifier.fillMaxSize().padding(padding)) {
            when (me.access) {
                Me.Access.Invited -> me.invitation?.let { invitation ->
                    section("welcome", header = "Willkommen bei ${invitation.workspaceName}") {
                        row { ListRow { Text("Du wurdest als ${invitation.role.label} eingeladen (${me.email}).") } }
                    }
                    section("name", header = "Dein Name") {
                        row { FormTextField(fullName, { fullName = it }, "Vor- und Nachname", singleLine = true, keyboardOptions = NameKeyboard) }
                    }
                    section("accept", footer = error) {
                        row {
                            ActionRow(
                                "Einladung annehmen",
                                enabled = !busy && fullName.isNotBlank(),
                                busy = busy,
                                onClick = {
                                    busy = true
                                    scope.launch {
                                        val failure = app.acceptInvitation(invitation.id, fullName.trim())
                                        if (failure != null) error = failure.fieldErrors["fullName"] ?: failure.message
                                        busy = false
                                    }
                                },
                            )
                        }
                    }
                }
                Me.Access.Expired -> section("expired", header = "Einladung abgelaufen") {
                    row { ListRow { Text("Deine Einladung ist abgelaufen. Bitte einen Admin, sie erneut zu senden.") } }
                }
                else -> section("none", header = "Kein Zugang") {
                    row { ListRow { Text("Für ${me.email} gibt es keinen Zugang zu Vistoo. Bitte einen Admin um eine Einladung.") } }
                }
            }
            section("actions") {
                row { ActionRow("Erneut prüfen", onClick = { scope.launch { app.refreshAccess() } }) }
                row { ActionRow("Abmelden", destructive = true, onClick = { scope.launch { app.signOut() } }) }
            }
        }
    }
}
