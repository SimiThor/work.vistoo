package de.vistoo.work.ui.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.ui.auth.OnboardingScreen
import de.vistoo.work.ui.auth.SignInScreen
import de.vistoo.work.ui.components.BrandMark
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.generated.Tokens
import kotlinx.coroutines.launch

/** Entry of the UI: one screen per app phase. */
@Composable
fun RootScreen(app: AppModel) {
    LaunchedEffect(app.network.reconnects) { app.networkChanged() }
    AnimatedContent(
        targetState = app.phase,
        contentKey = { it::class },
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "phase",
    ) { phase ->
        when (phase) {
            AppModel.Phase.Launching -> LaunchScreen()
            is AppModel.Phase.Misconfigured -> StatusScreen(
                icon = Icons.Outlined.CloudOff,
                title = "Vistoo ist nicht erreichbar",
                message = phase.message,
                actionTitle = "Erneut versuchen",
            ) { app.retryStart() }
            AppModel.Phase.Outdated -> StatusScreen(
                icon = Icons.Outlined.SystemUpdate,
                title = "Update erforderlich",
                message = "Diese Version der Vistoo-App wird nicht mehr unterstützt. Bitte aktualisiere die App.",
                actionTitle = null,
            ) {}
            AppModel.Phase.SignedOut -> SignInScreen(app)
            is AppModel.Phase.Onboarding -> OnboardingScreen(app, phase.me)
            AppModel.Phase.Ready -> {
                val session = app.session
                if (session != null) {
                    // A different account never reuses view state.
                    key(session.userId) { MainScaffold(app, session) }
                } else {
                    LaunchScreen()
                }
            }
        }
    }
}

@Composable
fun LaunchScreen() {
    Column(
        Modifier.fillMaxSize().background(Tokens.Palette.surfaceSubtle),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BrandMark()
        CircularProgressIndicator(Modifier.padding(top = 24.dp).size(24.dp), color = Tokens.Palette.mutedForeground, strokeWidth = 2.dp)
    }
}

@Composable
private fun StatusScreen(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    message: String,
    actionTitle: String?,
    action: suspend () -> Unit,
) {
    val scope = rememberMainScope()
    Box(Modifier.fillMaxSize().background(Tokens.Palette.surfaceSubtle).safeDrawingPadding(), contentAlignment = Alignment.Center) {
        EmptyState(title, icon, message) {
            if (actionTitle != null) Button(onClick = { scope.launch { action() } }) { Text(actionTitle) }
        }
    }
}
