package de.vistoo.work

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Smoke test like apps/ios/VistooWorkUITests/LaunchTests: the app starts and reaches a
 * real screen (sign-in, onboarding, workspace or the "not reachable" screen when the
 * configured server is down) — never a crash or an endless launch screen.
 */
@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    @Test
    fun reachesAFirstScreen() {
        val candidates = listOf("Anmelden", "Für mich", "Einladung", "Vistoo ist nicht erreichbar")
        rule.waitUntil(timeoutMillis = 30_000) {
            candidates.any { rule.onAllNodesWithText(it).fetchSemanticsNodes().isNotEmpty() }
        }
    }

    @Suppress("unused")
    private val matcher = hasText("Anmelden")
}
