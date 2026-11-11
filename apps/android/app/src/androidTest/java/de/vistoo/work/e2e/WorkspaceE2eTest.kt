package de.vistoo.work.e2e

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import de.vistoo.work.MainActivity
import java.util.UUID
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * End-to-end walk through every area of the app against the local stack
 * (`npm run supabase:start`, `npm run dev`, `adb reverse` for 3100, 54321, 54324).
 * Same scope as the iOS UI tests (VistooWorkUITests), extended to every screen and action.
 * Skipped when Mailpit is not reachable.
 *
 * Accounts (instrumentation args): `member` (default jonas@vistoo.test), `peer` (lena@vistoo.test,
 * same workspace) and `admin` (an admin of some local workspace).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class WorkspaceE2eTest {
    @get:Rule(order = 0)
    val rule = createAndroidComposeRule<MainActivity>()

    /** Inside the compose rule: logs the real failure before the activity is torn down. */
    @get:Rule(order = 1)
    val watcher = object : org.junit.rules.TestWatcher() {
        override fun failed(e: Throwable, description: org.junit.runner.Description) {
            android.util.Log.e("E2E", "FAILED ${description.methodName}: ${e.message}", e)
        }
    }

    private val ui by lazy { Ui(rule) }
    private val session by lazy { Session(rule, ui) }

    private val args = InstrumentationRegistry.getArguments()
    private val member = args.getString("member") ?: "jonas@vistoo.test"
    private val peer = args.getString("peer") ?: "lena@vistoo.test"
    private val admin = args.getString("admin") ?: "admin-mw7xhzow@e2e.vistoo.test"

    @Before
    fun requireStack() {
        assumeTrue("Local Mailpit not reachable (adb reverse tcp:54324 tcp:54324?)", Mailpit.reachable())
    }

    @Test
    fun t01_signInWithCode() {
        session.ensure(member)
        ui.waitText("Für mich")
        ui.waitText("MEINE TO-DOS")
    }

    @Test
    fun t02_todos() {
        session.ensure(member)
        ui.tab("Für mich")
        val title = "To-do $suffix"
        ui.type("Neues To-do", title, ime = true)
        ui.waitText(title)

        // Tick → leaves the open list; "Wieder öffnen" in the full list.
        ui.tapDesc("Erledigt: $title")
        ui.waitGone(title)
        ui.scrollTo("Alle", substring = true)
        ui.tap("Alle", substring = true)
        ui.waitText("Meine To-dos")
        ui.scrollTo("ERLEDIGT", substring = true)
        ui.tap("ERLEDIGT", substring = true)
        ui.scrollTo(title)
        ui.tapDesc("Wieder öffnen: $title")
        ui.pause(800)

        // Edit: title + due date.
        ui.scrollTo(title)
        ui.tap(title)
        ui.waitText("To-do")
        ui.replace("Titel", "$title bearbeitet")
        ui.tap("Fälligkeitsdatum")
        ui.waitText("Datum")
        ui.tap("Sichern")
        ui.waitText("$title bearbeitet")

        // Swipe left deletes.
        ui.swipeLeft("$title bearbeitet")
        ui.waitGone("$title bearbeitet")
        ui.back()
    }

    @Test
    fun t03_tasksBoardDetailTimeline() {
        session.ensure(member)
        ui.tab("Aufgaben")
        ui.waitText("Alle Aufgaben")
        val title = "Aufgabe $suffix"

        ui.tapDesc("Neue Aufgabe")
        ui.waitText("Erstellen")
        ui.type("Titel", title)
        ui.tap("Erstellen")
        ui.tapDesc("Offen,", substring = true)
        // New tasks go to the end of their column.
        ui.scrollTo(title)

        // Search narrows the long seed columns to this task (kept for the next steps).
        ui.type("Aufgaben suchen", suffix)
        ui.waitText(title)
        ui.waitGone("Release-Notes schreiben")

        // Detail: status via picker, version-checked save.
        ui.tap(title)
        ui.waitText("Aufgabe #", substring = true)
        ui.tap("Status")
        ui.tap("In Arbeit", last = true)
        ui.tap("Sichern")
        ui.waitText("Schließen")
        ui.tap("Schließen")
        ui.tapDesc("In Arbeit,", substring = true)
        ui.scrollTo(title)

        // Swipe left → next status.
        ui.swipeLeft(title)
        ui.tapDesc("Im Review,", substring = true)
        ui.scrollTo(title)

        // Long press → "Mir zuweisen" → shows up on "Für mich".
        ui.longPress(title)
        ui.tap("Mir zuweisen")
        ui.pause(1500)
        ui.tab("Für mich")
        ui.scrollTo(title)
        ui.waitText(title)

        // Timeline: task without dates is listed as "not fully planned".
        ui.tab("Aufgaben")
        ui.tapDesc("Ansicht und Filter", substring = true)
        ui.tap("Zeitachse")
        ui.waitText("Nicht vollständig geplant")
        ui.tapDesc("Termine für „$title“ setzen")
        ui.waitText("ZEITRAUM")
        ui.tap("Schließen")
        ui.tapDesc("Ansicht und Filter", substring = true)
        ui.tap("Board")

        // "Nur meine" filter bar + reset.
        ui.tapDesc("Ansicht und Filter", substring = true)
        ui.tap("Nur meine Aufgaben")
        ui.waitText("Zurücksetzen")
        ui.tap("Zurücksetzen")
        ui.waitGone("Zurücksetzen")

        // Delete with confirmation.
        ui.tapDesc("Im Review,", substring = true)
        ui.scrollTo(title)
        ui.longPress(title)
        ui.tap("Löschen …")
        ui.waitText("Aufgabe löschen?")
        ui.tap("Löschen", last = true)
        ui.waitGone(title)
        ui.replace("Aufgaben suchen", "")
    }

    @Test
    fun t04_projects() {
        session.ensure(member)
        ui.tab("Projekte")
        val name = "Projekt $suffix"
        ui.tapDesc("Neues Projekt")
        ui.type("Name", name)
        ui.tap("Erstellen")
        ui.scrollTo(name)
        ui.tap(name)
        ui.waitText("Keine Aufgaben")

        ui.tapDesc("Ansicht und Filter", substring = true)
        ui.tap("Projekt bearbeiten")
        ui.replace("Name", "$name X")
        ui.tap("Sichern")
        ui.waitText("$name X")

        ui.tapDesc("Ansicht und Filter", substring = true)
        ui.tap("Projekt archivieren")
        ui.waitText("Archiviert – nur lesbar")
        ui.back()
        ui.scrollTo("ARCHIVIERT", substring = true)
        ui.tap("ARCHIVIERT", substring = true)
        ui.scrollTo("$name X")
        ui.longPress("$name X")
        ui.tap("Wiederherstellen")
        ui.pause(1500)
        // Tidy up: archive again via swipe.
        ui.scrollTo("$name X")
        ui.swipeLeft("$name X")
        ui.pause(1500)
    }

    @Test
    fun t05_chatChannelAndDirectMessage() {
        session.ensure(member)
        ui.tab("Chat")
        val channel = "kanal-$suffix"
        ui.tapDesc("Neue Unterhaltung")
        ui.tap("Neuer Kanal")
        ui.type("Name", channel)
        ui.tap("Erstellen")
        ui.waitText("# $channel")

        ui.type("Nachricht", "Hallo $suffix")
        ui.tapDesc("Senden")
        ui.waitText("Hallo $suffix")

        ui.longPress("Hallo $suffix")
        ui.tap("Bearbeiten")
        ui.waitText("Nachricht bearbeiten")
        ui.replace("Nachricht", "Hallo $suffix neu")
        ui.tap("Sichern")
        ui.waitText("(bearbeitet)", substring = true)

        ui.longPress("Hallo $suffix neu", substring = true)
        ui.tap("Löschen …")
        ui.tap("Löschen", last = true)
        ui.waitText("Nachricht gelöscht")

        ui.tapDesc("Details")
        ui.waitText("Archivieren …")
        ui.tap("Archivieren …")
        ui.tap("Archivieren", last = true)
        ui.waitText("Wiederherstellen")
        ui.tap("Fertig")
        ui.waitText("Dieser Kanal ist archiviert", substring = true)
        ui.back()

        // Direct message to the peer.
        ui.tapDesc("Neue Unterhaltung")
        ui.tap("Neue Direktnachricht")
        ui.type("Person suchen", peer.substringBefore('@'))
        ui.tap(peer)
        ui.waitDesc("Nachricht")
        ui.type("Nachricht", "DM $suffix")
        ui.tapDesc("Senden")
        ui.waitText("DM $suffix")
        ui.back()
    }

    @Test
    fun t06_milestones() {
        session.ensure(member)
        ui.tab("Mehr")
        ui.tap("Meilensteine")
        val name = "Meilenstein $suffix"
        ui.tapDesc("Neuer Meilenstein")
        ui.type("Name", name)
        ui.tap("Erstellen")
        ui.waitText(name)
        ui.tap(name)
        ui.waitText("AUFGABEN")
        ui.tapDesc("Aktionen")
        ui.tap("Abschließen")
        ui.pause(1000)
        ui.tapDesc("Aktionen")
        ui.waitText("Wieder öffnen")
        ui.tap("Löschen …")
        ui.waitText("Meilenstein löschen?")
        ui.tap("Löschen", last = true)
        ui.waitText("Meilensteine")
        ui.back()
    }

    @Test
    fun t07_ideasWithIssue() {
        session.ensure(member)
        ui.tab("Mehr")
        ui.tap("Ideen")
        val title = "Idee $suffix"
        ui.tapDesc("Neue Idee")
        ui.type("Titel", title)
        ui.tap("Erstellen")
        ui.waitText(title)
        ui.tap(title)
        ui.waitText("ISSUE")
        ui.tap("Status")
        ui.tap("Geplant", last = true)
        ui.tap("Sichern")
        ui.pause(1000)

        // Issue from the idea → the task opens as a sheet.
        ui.scrollTo("Issue erstellen")
        ui.tap("Issue erstellen")
        ui.waitText("Aufgabe #", substring = true)
        ui.tap("Schließen")
        ui.waitText("#", substring = true)

        ui.scrollTo("Idee löschen …")
        ui.tap("Idee löschen …")
        ui.tap("Löschen", last = true)
        ui.waitGone(title)
        ui.back()
    }

    @Test
    fun t08_decisions() {
        session.ensure(member)
        ui.tab("Mehr")
        ui.tap("Entscheidungen")
        val title = "Entscheidung $suffix"
        ui.tapDesc("Neu")
        ui.type("Was wird entschieden?", title)
        ui.tap("Erstellen")
        ui.waitText("KONTEXT")

        // Concluding needs outcome + reasoning (local pre-check, enforced by the server).
        ui.tap("Status")
        ui.tap("Entschieden", last = true)
        ui.scrollTo("Bitte halte die finale Entscheidung fest.")
        ui.type("Was wurde entschieden?", "Wir machen es.")
        ui.scrollTo("Warum so?")
        ui.type("Warum so?", "Weil es passt.")
        ui.tap("Sichern")
        ui.scrollTo("Durch neue Entscheidung ersetzen …")

        ui.scrollTo("Link hinzufügen")
        ui.tap("Link hinzufügen")
        ui.type("https://…", "https://example.com/doc")
        ui.tap("Hinzufügen")
        ui.scrollTo("example.com")
        ui.waitText("example.com")

        ui.scrollTo("VERLAUF")
        ui.scrollTo("Eintrag löschen …")
        ui.tap("Eintrag löschen …")
        ui.tap("Löschen", last = true)
        ui.waitGone(title)
        ui.back()
    }

    @Test
    fun t09_crm() {
        session.ensure(member)
        ui.tab("Mehr")
        ui.tap("CRM")
        val name = "Zoo $suffix"
        ui.tapDesc("Neue Attraktion")
        ui.type("Name", name)
        ui.tap("Erstellen")
        ui.scrollTo(name)
        ui.tap(name)
        ui.waitText("Aktivität hinzufügen")

        ui.tap("Status")
        ui.tap("Kontaktiert", last = true)
        ui.scrollTo("Status: Neu → Kontaktiert")

        ui.scrollTo("Aktivität hinzufügen")
        ui.tap("Aktivität hinzufügen")
        ui.type("Was wurde besprochen?", "Telefonat $suffix")
        ui.tap("Sichern")
        ui.scrollTo("Telefonat $suffix")

        ui.scrollTo("Eintrag löschen …")
        ui.tap("Eintrag löschen …")
        ui.tap("Löschen", last = true)
        ui.waitGone(name)
        ui.back()
    }

    @Test
    fun t10_settingsAndTeam() {
        session.ensure(member)
        ui.tab("Mehr")
        ui.tapDesc("Konto und Einstellungen")
        ui.waitText("MEIN KONTO")
        ui.tap("Namen ändern")
        ui.replace("Vor- und Nachname", "Jonas Android")
        ui.tap("Sichern")
        ui.waitText("Jonas Android")
        ui.tap("Neue Aufgaben für mich")
        ui.pause(800)
        ui.tap("Neue Aufgaben für mich")
        ui.pause(800)
        ui.scrollTo("Mitglieder", substring = true)
        ui.tap("Mitglieder", substring = true)
        ui.waitText("MITGLIEDER", substring = true)
        ui.waitText(peer)
        ui.back()
        ui.tap("Fertig")
    }

    @Test
    fun t11_peerSeesUnreadDirectMessage() {
        session.ensure(peer)
        ui.tab("Für mich")
        ui.waitText("UNGELESEN")
        rule.waitUntil(15_000) { ui.tabBadge("Chat") > 0 }
        val unreadBefore = ui.tabBadge("Chat")
        ui.tab("Chat")
        ui.waitText("UNGELESEN")
        ui.tap("Jonas Android")
        ui.waitText("DM", substring = true)
        ui.type("Nachricht", "Antwort $suffix")
        ui.tapDesc("Senden")
        ui.waitText("Antwort $suffix")
        ui.back()
        // Read state was written: one unread conversation less.
        rule.waitUntil(15_000) { ui.tabBadge("Chat") < unreadBefore }
    }

    @Test
    fun t12_adminInvitesAndInviteeOnboards() {
        session.ensure(admin)
        ui.tapDesc("Konto und Einstellungen")
        ui.waitText("Speicher für Chat-Dateien")
        ui.scrollTo("Mitglieder & Einladungen")
        ui.tap("Mitglieder & Einladungen")
        val revoked = "widerruf-$suffix@e2e.vistoo.test"
        ui.tapDesc("Einladen")
        ui.type("E-Mail-Adresse", revoked)
        ui.tap("Senden")
        ui.waitText(revoked)
        ui.longPress(revoked)
        ui.tap("Erneut senden")
        ui.waitText("Erledigt")
        ui.tap("OK")
        ui.longPress(revoked)
        ui.tap("Widerrufen")
        ui.waitGone(revoked)

        val invitee = "neu-$suffix@e2e.vistoo.test"
        ui.tapDesc("Einladen")
        ui.type("E-Mail-Adresse", invitee)
        ui.tap("Senden")
        ui.waitText(invitee)
        ui.back()
        ui.tap("Fertig")
        session.signOut()

        // The invitee signs in with the code and accepts the invitation.
        session.signIn(invitee, expectWorkspace = false)
        ui.waitText("Einladung annehmen", timeoutMillis = 30_000)
        ui.type("Vor- und Nachname", "Neu Android")
        ui.tap("Einladung annehmen")
        rule.waitUntil(30_000) { ui.tabExists("Für mich") }
        Session.current = invitee
        session.signOut()
    }

    companion object {
        /** One suffix per test run, so the data of a run belongs together. */
        val suffix: String = UUID.randomUUID().toString().take(5)
    }
}
