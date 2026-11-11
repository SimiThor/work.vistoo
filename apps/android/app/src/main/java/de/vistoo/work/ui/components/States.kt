package de.vistoo.work.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.launch

@Composable
fun SmallProgress(modifier: Modifier = Modifier) {
    CircularProgressIndicator(modifier.size(18.dp), strokeWidth = 2.dp, color = Tokens.Palette.mutedForeground)
}

@Composable
fun LoadingView(label: String = "Wird geladen …", modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Tokens.Palette.mutedForeground, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
        Text(label, color = Tokens.Palette.mutedForeground, style = VType.dense, modifier = Modifier.padding(top = 12.dp))
    }
}

/** iOS `ContentUnavailableView`: icon, title, description, actions. */
@Composable
fun EmptyState(
    title: String,
    icon: ImageVector,
    description: String? = null,
    modifier: Modifier = Modifier,
    actions: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(44.dp))
        Text(title, style = VType.title3, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        if (description != null) {
            Text(description, style = VType.dense, color = Tokens.Palette.mutedForeground, textAlign = TextAlign.Center)
        }
        if (actions != null) {
            Column(Modifier.padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                actions()
            }
        }
    }
}

@Composable
fun FailureView(message: String, retry: suspend () -> Unit) {
    val scope = rememberMainScope()
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        EmptyState("Nicht geladen", Icons.Outlined.WarningAmber, message) {
            Button(onClick = { scope.launch { retry() } }) { Text("Erneut versuchen") }
        }
    }
}

/** Persistent hint while offline: nothing is pretended to be saved. */
@Composable
fun OfflineBanner() {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Tokens.Palette.warningBg)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.WifiOff, null, tint = Tokens.Palette.warningFg, modifier = Modifier.size(16.dp))
        Text(
            "Offline – Änderungen werden erst mit Verbindung gespeichert.",
            color = Tokens.Palette.warningFg,
            style = VType.footnote.copy(fontWeight = FontWeight.Medium),
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

/** Generic "loaded / loading / failed" wrapper for area lists. */
@Composable
fun AreaContent(state: LoadState, isEmpty: Boolean, retry: suspend () -> Unit, content: @Composable () -> Unit) {
    when {
        isEmpty && (state == LoadState.Loading || state == LoadState.Idle) -> LoadingView()
        isEmpty && state is LoadState.Failed -> FailureView(state.message, retry)
        else -> content()
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) { Text(text) }
}
