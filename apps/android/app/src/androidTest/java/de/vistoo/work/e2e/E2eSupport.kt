package de.vistoo.work.e2e

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.swipeUp
import androidx.test.ext.junit.rules.ActivityScenarioRule
import de.vistoo.work.MainActivity
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

typealias Rule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/**
 * UI helpers for the end-to-end tests. They find elements the way a user (or TalkBack)
 * does: by visible German labels and content descriptions — the same labels as iOS.
 */
class Ui(private val rule: Rule) {
    private val timeout = 20_000L

    /** Logged first: if the app then crashes during teardown, the cause is still visible. */
    private fun fail(message: String, cause: Throwable): AssertionError {
        android.util.Log.e("E2E", message)
        runCatching {
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
                .executeShellCommand("screencap -p /sdcard/Download/e2e-fail-${System.currentTimeMillis()}.png").close()
            Thread.sleep(1500)
        }
        return AssertionError(message, cause)
    }

    fun exists(text: String, substring: Boolean = false): Boolean =
        rule.onAllNodes(hasText(text, substring = substring), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    fun existsDesc(desc: String, substring: Boolean = false): Boolean =
        rule.onAllNodes(hasContentDescription(desc, substring = substring), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    fun waitText(text: String, substring: Boolean = false, timeoutMillis: Long = timeout) {
        try {
            rule.waitUntil(timeoutMillis) { exists(text, substring) }
        } catch (e: Throwable) {
            throw fail("Text „$text“ did not appear", e)
        }
    }

    fun waitGone(text: String, substring: Boolean = false, timeoutMillis: Long = timeout) {
        try {
            rule.waitUntil(timeoutMillis) { !exists(text, substring) }
        } catch (e: Throwable) {
            throw fail("Text „$text“ did not disappear", e)
        }
    }

    fun waitDesc(desc: String, substring: Boolean = false, timeoutMillis: Long = timeout) {
        try {
            rule.waitUntil(timeoutMillis) { existsDesc(desc, substring) }
        } catch (e: Throwable) {
            throw fail("Element „$desc“ did not appear", e)
        }
    }

    /** The node, scrolled into the visible area of its list (taps on off-screen nodes would miss). */
    fun text(text: String, substring: Boolean = false, last: Boolean = false): SemanticsNodeInteraction {
        // Lazy lists only compose what is visible: scroll first if needed.
        runCatching { if (!exists(text, substring)) scrollTo(text, substring) }
        waitText(text, substring)
        val all = rule.onAllNodes(hasText(text, substring = substring), useUnmergedTree = true)
        runCatching { (if (last) all.onLast() else all.onFirst()).performScrollTo() }
        // Let server-driven reorders (realtime reloads) and menu/sheet animations settle,
        // then re-query: the row may have moved or been recomposed.
        pause(400)
        waitText(text, substring)
        val fresh = rule.onAllNodes(hasText(text, substring = substring), useUnmergedTree = true)
        return if (last) fresh.onLast() else fresh.onFirst()
    }

    private fun log(action: String, node: SemanticsNodeInteraction, label: String) {
        val b = runCatching { node.fetchSemanticsNode().boundsInRoot }.getOrNull()
        android.util.Log.i("E2E", "$action „$label“ at $b")
    }

    fun tap(text: String, substring: Boolean = false, last: Boolean = false) {
        val node = text(text, substring, last)
        log("tap", node, text)
        node.performClick()
        rule.waitForIdle()
    }

    fun tapDesc(desc: String, substring: Boolean = false) {
        waitDesc(desc, substring)
        rule.onAllNodes(hasContentDescription(desc, substring = substring)).onFirst().performClick()
        rule.waitForIdle()
    }

    fun longPress(text: String, substring: Boolean = false) {
        val node = text(text, substring)
        log("longPress", node, text)
        node.performTouchInput { longClick() }
        rule.waitForIdle()
    }

    fun swipeLeft(text: String, substring: Boolean = false) {
        text(text, substring).performTouchInput { swipeLeft(startX = right - 5f, endX = left + 5f, durationMillis = 300) }
        rule.waitForIdle()
    }

    fun swipeRight(text: String, substring: Boolean = false) {
        text(text, substring).performTouchInput { swipeRight(startX = left + 5f, endX = right * 3, durationMillis = 300) }
        rule.waitForIdle()
    }

    /** Text field by its placeholder / label (FormTextField sets it as content description). */
    fun field(label: String): SemanticsNodeInteraction {
        val matcher = hasSetTextAction() and (hasContentDescription(label) or hasText(label))
        rule.waitUntil(timeout) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        return rule.onAllNodes(matcher).onLast()
    }

    fun type(label: String, value: String, ime: Boolean = false) {
        val f = field(label)
        f.performClick()
        f.performTextInput(value)
        if (ime) f.performImeAction()
        rule.waitForIdle()
    }

    fun replace(label: String, value: String) {
        field(label).performTextReplacement(value)
        rule.waitForIdle()
    }

    /** Bottom navigation tab. */
    fun tab(label: String) {
        val matcher = hasContentDescription(label, substring = true) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        rule.waitUntil(timeout) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodes(matcher).onFirst().performClick()
        rule.waitForIdle()
    }

    fun tabExists(label: String): Boolean {
        val matcher = hasContentDescription(label, substring = true) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        return rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
    }

    /** Badge number of a bottom tab (its content description is "Label, N"). */
    fun tabBadge(label: String): Int {
        val matcher = hasContentDescription(label, substring = true) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        val desc = rule.onAllNodes(matcher).fetchSemanticsNodes().firstOrNull()?.config?.getOrNull(SemanticsProperties.ContentDescription)?.firstOrNull() ?: return 0
        return desc.substringAfter(", ", "0").toIntOrNull() ?: 0
    }

    /** Scrolls whichever list contains the text until it is composed. */
    fun scrollTo(text: String, substring: Boolean = false) {
        if (exists(text, substring)) return
        val lists = rule.onAllNodes(hasScrollToNodeAction())
        val count = lists.fetchSemanticsNodes().size
        for (i in count - 1 downTo 0) {
            try {
                lists[i].performScrollToNode(hasText(text, substring = substring))
                rule.waitForIdle()
                if (exists(text, substring)) return
            } catch (_: AssertionError) {
            } catch (_: IllegalStateException) {
            }
        }
        // Fallback: swipe like a user, first down through the lists, then back up.
        for (direction in listOf(true, false)) {
            repeat(12) {
                if (exists(text, substring)) return
                val vertical = rule.onAllNodes(hasScrollToNodeAction())
                val n = vertical.fetchSemanticsNodes().size
                if (n == 0) return@repeat
                runCatching {
                    vertical[n - 1].performTouchInput {
                        if (direction) swipeUp(startY = bottom * 0.85f, endY = top + height * 0.15f, durationMillis = 250)
                        else swipeDown(startY = top + height * 0.15f, endY = bottom * 0.85f, durationMillis = 250)
                    }
                }
                pause(250)
            }
        }
        waitText(text, substring, 3_000)
    }

    /** Like the system Back key/gesture: goes to the top window (dialogs/sheets included). */
    fun back() {
        rule.waitForIdle()
        androidx.test.espresso.Espresso.pressBackUnconditionally()
        pause(500)
    }

    fun pause(millis: Long) {
        Thread.sleep(millis)
        rule.waitForIdle()
    }
}

/** Local Mailpit (reached through `adb reverse tcp:54324 tcp:54324`). */
object Mailpit {
    private const val BASE = "http://127.0.0.1:54324/api/v1"
    private val json = Json { ignoreUnknownKeys = true }

    fun reachable(): Boolean = runCatching { get("$BASE/info"); true }.getOrDefault(false)

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 5_000
        c.readTimeout = 5_000
        return c.inputStream.use { it.readBytes().decodeToString() }
    }

    /** Newest 6–10 digit code sent to `email` after `since`. */
    fun code(email: String, since: Instant, timeoutMillis: Long = 30_000): String {
        val deadline = System.currentTimeMillis() + timeoutMillis
        val q = URLEncoder.encode("to:$email", "UTF-8")
        while (System.currentTimeMillis() < deadline) {
            val found = runCatching {
                val list = json.parseToJsonElement(get("$BASE/search?query=$q&limit=5")).jsonObject["messages"]!!.jsonArray
                list.map { it.jsonObject }.firstOrNull { Instant.parse(it["Created"]!!.jsonPrimitive.content).isAfter(since.minusSeconds(2)) }?.let { m ->
                    val text = json.parseToJsonElement(get("$BASE/message/${m["ID"]!!.jsonPrimitive.content}")).jsonObject["Text"]!!.jsonPrimitive.content
                    Regex("""\b\d{6,10}\b""").find(text)?.value
                }
            }.getOrNull()
            if (found != null) return found
            Thread.sleep(700)
        }
        throw AssertionError("No login code for $email in Mailpit")
    }
}

/** Signs in / out through the real UI (e-mail → code from Mailpit). */
class Session(private val rule: Rule, private val ui: Ui) {
    fun ensure(email: String) {
        rule.waitUntil(40_000) { ui.exists("Code anfordern") || ui.tabExists("Für mich") || ui.exists("Einladung annehmen") }
        if (current == email && ui.tabExists("Für mich")) return
        if (ui.tabExists("Für mich")) signOut()
        signIn(email)
    }

    fun signIn(email: String, expectWorkspace: Boolean = true) {
        ui.waitText("Code anfordern")
        ui.type("E-Mail-Adresse", email)
        val since = Instant.now()
        ui.tap("Code anfordern")
        ui.waitText("Code eingeben")
        val code = Mailpit.code(email, since)
        ui.type("Code aus der E-Mail", code)
        ui.tap("Anmelden", last = true)
        if (expectWorkspace) {
            rule.waitUntil(40_000) { ui.tabExists("Für mich") }
            current = email
        }
    }

    fun signOut() {
        ui.tapDesc("Konto und Einstellungen")
        ui.waitText("Einstellungen")
        ui.scrollTo("Abmelden")
        ui.tap("Abmelden")
        ui.waitText("Abmelden?")
        ui.tap("Abmelden", last = true)
        ui.waitText("Code anfordern", timeoutMillis = 30_000)
        current = null
    }

    companion object {
        var current: String? = null
    }
}
