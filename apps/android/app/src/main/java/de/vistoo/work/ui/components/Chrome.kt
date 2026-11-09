package de.vistoo.work.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.userMessage
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

/**
 * Top bar. `large = true` for tab roots (left-aligned title, like iOS large titles),
 * otherwise a centred title (iOS inline titles).
 */
@Composable
fun VistooTopBar(
    title: String,
    large: Boolean = false,
    onBack: (() -> Unit)? = null,
    navigationIcon: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = TopAppBarDefaults.topAppBarColors(
        containerColor = Tokens.Palette.surfaceSubtle,
        scrolledContainerColor = Tokens.Palette.surfaceSubtle,
        titleContentColor = Tokens.Palette.foreground,
        actionIconContentColor = Tokens.Palette.accentBlue,
        navigationIconContentColor = Tokens.Palette.accentBlue,
    )
    val nav: @Composable () -> Unit = {
        when {
            navigationIcon != null -> navigationIcon()
            onBack != null -> IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
        }
    }
    if (large) {
        TopAppBar(
            title = { Text(title, style = VType.pageTitle, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = nav,
            actions = actions,
            colors = colors,
        )
    } else {
        CenterAlignedTopAppBar(
            title = { Text(title, style = VType.headline, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = nav,
            actions = actions,
            colors = colors,
        )
    }
}

/** Text button in a top bar ("Abbrechen", "Sichern" …). */
@Composable
fun BarButton(text: String, onClick: () -> Unit, enabled: Boolean = true, bold: Boolean = false, destructive: Boolean = false) {
    TextButton(onClick = onClick, enabled = enabled) {
        Text(
            text,
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
            color = when {
                !enabled -> Tokens.Palette.borderStrong
                destructive -> Tokens.Palette.destructive
                else -> Tokens.Palette.accentBlue
            },
        )
    }
}

/**
 * Full-screen modal sheet with a toolbar (the Android counterpart of the iOS form
 * sheets): cancel left, title, confirm right. Back closes it unless `dismissEnabled` is false.
 */
@Composable
fun FormSheet(
    title: String,
    onDismiss: () -> Unit,
    dismissLabel: String = "Abbrechen",
    dismissEnabled: Boolean = true,
    confirmLabel: String? = null,
    confirmEnabled: Boolean = true,
    onConfirm: () -> Unit = {},
    extraActions: @Composable RowScope.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = { if (dismissEnabled) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        Scaffold(
            containerColor = Tokens.Palette.surfaceSubtle,
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                VistooTopBar(
                    title = title,
                    navigationIcon = { BarButton(dismissLabel, onClick = onDismiss, enabled = dismissEnabled) },
                    actions = {
                        extraActions()
                        if (confirmLabel != null) BarButton(confirmLabel, onClick = onConfirm, enabled = confirmEnabled, bold = true)
                    },
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding).imePadding()) { content() }
        }
    }
}

/** Full-screen sheet without a form toolbar (the content brings its own scaffold). */
@Composable
fun FullScreenSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        BackHandler(onBack = onDismiss)
        content()
    }
}

/** Alert payload for failed actions. */
data class ActionFailure(val title: String, val message: String) {
    companion object {
        fun of(title: String, error: Throwable) = ActionFailure(title, error.userMessage)
    }
}

@Composable
fun FailureAlert(failure: ActionFailure?, onDismiss: () -> Unit) {
    if (failure == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(failure.title) },
        text = { Text(failure.message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        containerColor = Tokens.Palette.background,
    )
}

/** iOS confirmation dialog: destructive (or plain) confirm + cancel. */
@Composable
fun ConfirmDialog(
    title: String,
    message: String? = null,
    confirmLabel: String,
    destructive: Boolean = true,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = message?.let { { Text(it) } },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                onConfirm()
            }) { Text(confirmLabel, color = if (destructive) Tokens.Palette.destructive else Tokens.Palette.accentBlue, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
        containerColor = Tokens.Palette.background,
    )
}

/** Alert with arbitrary buttons (e.g. the task conflict dialog). */
@Composable
fun ChoiceDialog(
    title: String,
    message: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            androidx.compose.foundation.layout.Column {
                Text(message)
                content()
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
        containerColor = Tokens.Palette.background,
    )
}

/** Error line of a form (server `fieldErrors` or local pre-check). */
@Composable
fun FieldError(message: String?) {
    if (message == null) return
    Text(message, style = VType.footnote, color = Tokens.Palette.destructive, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

/** Whether an error came from connectivity (for the wifi icon). */
val Throwable.isOffline: Boolean get() = (this as? ApiError)?.isConnectivityProblem == true
