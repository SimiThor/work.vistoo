package de.vistoo.work.ui.components

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.core.net.toUri
import de.vistoo.work.core.support.UiPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Runs a user action and reports failures as an alert (owned by the screen that
 * shows the rows). Success gives a light haptic confirmation, like iOS `sensoryFeedback`.
 */
class ActionRunner internal constructor(private val scope: CoroutineScope, private val haptics: HapticFeedback) {
    var failure by mutableStateOf<ActionFailure?>(null)

    fun run(title: String, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = ActionFailure.of(title, e)
            }
        }
    }

    fun success() = haptics.performHapticFeedback(HapticFeedbackType.Confirm)
}

@Composable
fun rememberActionRunner(): ActionRunner {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    return remember { ActionRunner(scope, haptics) }
}

/** Alert for the runner's last failure. */
@Composable
fun ActionRunner.Alerts() {
    FailureAlert(failure) { failure = null }
}

/** Per-device UI preference (view mode, last project …), like iOS `@AppStorage`. */
@Composable
fun rememberPreference(key: String, default: String): MutableState<String> {
    val context = LocalContext.current
    val prefs = remember { UiPreferences(context) }
    val state = remember { mutableStateOf(prefs.string(key, default)) }
    return remember {
        object : MutableState<String> {
            override var value: String
                get() = state.value
                set(v) {
                    state.value = v
                    prefs.setString(key, v)
                }

            override fun component1() = value
            override fun component2(): (String) -> Unit = { value = it }
        }
    }
}

/** System share sheet for a link (iOS `ShareLink`). */
fun shareLink(context: Context, link: String, title: String = "Link teilen") {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, link)
    }
    context.startActivity(Intent.createChooser(send, title))
}

/** Opens a URL in the browser (or the matching app). */
fun openUrl(context: Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
