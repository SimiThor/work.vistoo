package de.vistoo.work.ui.decisions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.Decision
import de.vistoo.work.core.generated.DecisionDetail
import de.vistoo.work.core.generated.DecisionHistory
import de.vistoo.work.core.generated.DecisionRef
import de.vistoo.work.core.generated.DecisionSort
import de.vistoo.work.core.generated.DecisionStatus
import de.vistoo.work.core.generated.DecisionSummary
import de.vistoo.work.core.generated.DecisionType
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.HistoryKind
import de.vistoo.work.core.generated.IdeaStatus
import de.vistoo.work.core.generated.RelationCandidate
import de.vistoo.work.core.generated.RelationKind
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.UpdateDecisionRequest
import de.vistoo.work.core.generated.hex
import de.vistoo.work.core.generated.isConcluded
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.generated.statuses
import de.vistoo.work.core.generated.textFields
import de.vistoo.work.core.stores.DecisionStore
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.app.DecisionRoute
import de.vistoo.work.ui.app.IdeaRoute
import de.vistoo.work.ui.app.navigator
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.AreaContent
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.DateValueRow
import de.vistoo.work.ui.components.DotLabel
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FailureView
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.LabeledRow
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.NavRow
import de.vistoo.work.ui.components.PersonPicker
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.PlainList
import de.vistoo.work.ui.components.PlainRow
import de.vistoo.work.ui.components.SearchField
import de.vistoo.work.ui.components.Segmented
import de.vistoo.work.ui.components.StatusDot
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.UrlKeyboard
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.openUrl
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.CheckRow
import de.vistoo.work.ui.tasks.failureSection
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

val DecisionType.icon: ImageVector
    get() = when (this) {
        DecisionType.Decision -> Icons.Outlined.Verified
        DecisionType.Experiment -> Icons.Outlined.Science
        else -> Icons.Outlined.HelpOutline
    }

/** Field names as on the web (`fieldLabel` in packages/domain/decisions). */
object DecisionFieldLabel {
    fun label(field: String, type: DecisionType): String = when (field) {
        "title" -> "Titel"
        "description" -> if (type == DecisionType.Decision) "Kontext" else "Beschreibung"
        "optionsConsidered" -> "Betrachtete Optionen"
        "objective" -> "Ziel"
        "testDescription" -> "Was wurde getestet"
        "results" -> "Ergebnis"
        "outcome" -> if (type == DecisionType.Decision) "Entscheidung" else "Fazit"
        "reasoning" -> "Begründung"
        "status" -> "Status"
        "concludedOn" -> if (type == DecisionType.Decision) "Entscheidungsdatum" else "Abschlussdatum"
        else -> field
    }

    fun placeholder(field: String, type: DecisionType): String = when (field) {
        "description" -> if (type == DecisionType.Decision) "Worum geht es, was ist die Ausgangslage?" else "Was wird ausprobiert und warum?"
        "optionsConsidered" -> "Welche Möglichkeiten gab es?"
        "results" -> "Was kam heraus?"
        "outcome" -> "Was wurde entschieden?"
        "reasoning" -> "Warum so?"
        else -> ""
    }
}

// MARK: - List

@Composable
fun DecisionsScreen(session: SessionModel, nav: NavHostController) {
    val store = session.decisions
    var creating by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val q = store.query
    LaunchedEffect(q) {
        // Server-side full-text search: wait until typing pauses.
        if (store.state == LoadState.Loaded) delay(300)
        store.reload()
    }
    val statusOptions = q.type?.statuses ?: DecisionStatus.knownCases

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("Entscheidungen", onBack = { nav.popBackStack() }, actions = {
                MenuButton(if (q.filterCount > 0) Icons.Outlined.FilterAlt else Icons.Filled.FilterList, "Filter", {
                    buildList {
                        add(MenuEntry.Submenu("Typ", Icons.Outlined.Verified, listOf(MenuEntry.Item("Alle Typen", checked = q.type == null) { store.query = q.copy(type = null) }) +
                            DecisionType.knownCases.map { t -> MenuEntry.Item(t.label, t.icon, checked = q.type == t) { store.query = q.copy(type = t, status = q.status?.takeIf { it in t.statuses }) } }))
                        add(MenuEntry.Submenu("Status", null, listOf(MenuEntry.Item("Alle Status", checked = q.status == null) { store.query = q.copy(status = null) }) +
                            statusOptions.map { s -> MenuEntry.Item(s.label, checked = q.status == s) { store.query = q.copy(status = s) } }))
                        add(MenuEntry.Submenu("Verantwortlich", null, listOf(
                            MenuEntry.Item("Alle Personen", checked = q.assigneeId == null) { store.query = q.copy(assigneeId = null) },
                            MenuEntry.Item("Niemand", checked = q.assigneeId == DomainDefaults.unassigned) { store.query = q.copy(assigneeId = DomainDefaults.unassigned) },
                        ) + session.work.members.map { m -> MenuEntry.Item(m.displayName, checked = q.assigneeId == m.userId) { store.query = q.copy(assigneeId = m.userId) } }))
                        add(MenuEntry.Submenu("Sortierung", null, DecisionSort.knownCases.map { s -> MenuEntry.Item(s.label, checked = q.sort == s) { store.query = q.copy(sort = s) } }))
                        if (q.filterCount > 0) {
                            add(MenuEntry.Divider)
                            add(MenuEntry.Item("Filter zurücksetzen", destructive = true) { store.query = q.copy(type = null, status = null, assigneeId = null) })
                        }
                    }
                }, badge = q.filterCount > 0)
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, "Neu") }
            })
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SearchField(q.text, { store.query = q.copy(text = it) }, "Titel, Kontext, Ergebnis …")
            Box(Modifier.weight(1f)) {
                AreaContent(store.state, store.decisions.isEmpty() && q == DecisionStore.Query(), { store.reload() }) {
                    PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; store.reload(); refreshing = false } }) {
                        PlainList {
                            if (store.decisions.isEmpty()) {
                                item("empty") {
                                    if (q == DecisionStore.Query()) {
                                        EmptyState("Noch nichts festgehalten", Icons.Outlined.Verified, "Halte Entscheidungen und Experimente fest, damit sie später auffindbar sind.")
                                    } else {
                                        EmptyState("Keine Treffer", Icons.Outlined.Search, "Passe Suche oder Filter an.")
                                    }
                                }
                            }
                            for (d in store.decisions) item(d.id) {
                                PlainRow { Box(Modifier.clickable { nav.navigate(DecisionRoute(d.id)) }) { DecisionRow(d, session.work) } }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) DecisionCreateView(session, { creating = false }) { id -> nav.navigate(DecisionRoute(id)) }
}

@Composable
fun DecisionRow(d: DecisionSummary, work: WorkStore) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(d.type.icon, d.type.label, tint = Tokens.Palette.mutedForeground, modifier = Modifier.width(22.dp).padding(top = 2.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val superseded = d.status == DecisionStatus.Superseded
            Text(
                d.title,
                color = if (superseded) Tokens.Palette.mutedForeground else Tokens.Palette.foreground,
                style = VType.body.copy(textDecoration = if (superseded) TextDecoration.LineThrough else null),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (d.outcomePreview.isNotEmpty()) Text(d.outcomePreview, style = VType.caption, color = Tokens.Palette.mutedForeground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.ProvideTextStyle(VType.caption.copy(color = Tokens.Palette.mutedForeground)) {
                    DotLabel(d.status.label, d.status.hex)
                    d.concludedOn?.let { Text(Formatting.short(it)) }
                }
            }
        }
        work.person(d.assigneeId)?.let { Avatar(it.fullName, it.email, size = 24.dp) }
    }
}

/** Capture in seconds: type + title, the rest happens in the detail. */
@Composable
fun DecisionCreateView(session: SessionModel, onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    val clientId = remember { newClientId() }
    var type by remember { mutableStateOf<DecisionType>(DecisionType.Decision) }
    var title by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    FormSheet("Neu festhalten", onDismiss, dismissEnabled = !saving, confirmLabel = "Erstellen", confirmEnabled = !saving && title.isNotBlank(), onConfirm = {
        saving = true
        scope.launch {
            try {
                val created = session.decisions.create(clientId, type, title)
                onDismiss()
                onCreated(created.id)
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }) {
        GroupedList {
            section("main", footer = "Nur der Titel ist Pflicht. Kontext, Optionen und Ergebnis ergänzt du danach.") {
                row("type") {
                    Box(Modifier.padding(12.dp)) { Segmented(DecisionType.knownCases.map { PickerOption(it, it.label) }, type, { type = it }) }
                }
                row("title") {
                    FormTextField(title, { title = it }, if (type == DecisionType.Decision) "Was wird entschieden?" else "Was wird ausprobiert?", style = VType.headline, autoFocus = true)
                }
                failure?.fieldErrors?.get("title")?.let { row("e") { FieldError(it) } }
            }
            failureSection(failure)
        }
    }
}

// MARK: - Detail

/** Editable values of the detail form. */
private data class DecisionFields(
    val type: DecisionType,
    val title: String,
    val status: DecisionStatus,
    val assigneeId: String?,
    val texts: Map<String, String>,
    val concludedOn: CalendarDate?,
) {
    fun text(key: String) = texts[key] ?: ""

    /** Quick local check; the server enforces the same rule (`completionErrors`). */
    val completionProblems: Map<String, String>
        get() {
            if (!status.isConcluded) return emptyMap()
            val errors = mutableMapOf<String, String>()
            if (type == DecisionType.Experiment) {
                if (text("results").isBlank()) errors["results"] = "Bitte halte das Ergebnis fest."
            } else {
                if (text("outcome").isBlank()) errors["outcome"] = "Bitte halte die finale Entscheidung fest."
                if (text("reasoning").isBlank()) errors["reasoning"] = "Bitte begründe den Abschluss."
            }
            return errors
        }

    companion object {
        fun of(d: Decision) = DecisionFields(
            d.type, d.title, d.status, d.assigneeId,
            mapOf(
                "description" to d.description, "optionsConsidered" to d.optionsConsidered, "objective" to d.objective,
                "testDescription" to d.testDescription, "results" to d.results, "outcome" to d.outcome, "reasoning" to d.reasoning,
            ),
            d.concludedOn,
        )
    }
}

@Composable
fun DecisionDetailScreen(session: SessionModel, decisionId: String, nav: NavHostController) {
    val store = session.decisions
    val navigator = navigator()
    val context = LocalContext.current
    val runner = rememberActionRunner()
    val detail = store.details[decisionId]
    var fields by remember { mutableStateOf<DecisionFields?>(null) }
    var base by remember { mutableStateOf<DecisionFields?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var superseding by remember { mutableStateOf(false) }
    var addingLink by remember { mutableStateOf(false) }
    var addingRelation by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val isDirty = fields != null && fields != base

    fun adopt(d: Decision) {
        fields = DecisionFields.of(d)
        base = fields
    }

    suspend fun load() {
        try {
            store.loadDetail(decisionId)
            loadError = null
            val d = store.details[decisionId]?.decision
            if (d != null && (fields == null || fields == base)) adopt(d)
        } catch (e: ApiError) {
            if (store.details[decisionId] == null) loadError = e.message
        }
    }
    LaunchedEffect(decisionId) { load() }
    LaunchedEffect(detail?.decision) { detail?.decision?.let { if (!isDirty) adopt(it) } }

    fun save(d: Decision) {
        val f = fields ?: return
        val b = base ?: return
        val changed = f.type.textFields.filter { f.text(it) != b.text(it) }.associateWith { f.text(it) }
        val patch = UpdateDecisionRequest(
            type = if (f.type != b.type) f.type else null,
            title = if (f.title != b.title) f.title.trim() else null,
            status = if (f.status != b.status) f.status else null,
            assigneeId = if (f.assigneeId != b.assigneeId) Patchable.of(f.assigneeId) else Patchable.Unset,
            concludedOn = if (f.concludedOn != b.concludedOn) f.concludedOn?.iso else null,
            description = changed["description"],
            optionsConsidered = changed["optionsConsidered"],
            objective = changed["objective"],
            testDescription = changed["testDescription"],
            results = changed["results"],
            outcome = changed["outcome"],
            reasoning = changed["reasoning"],
        )
        saving = true
        scope.launch {
            try {
                val updated = store.update(d.id, patch)
                failure = null
                adopt(updated.decision)
                runner.success()
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar(fields?.type?.label ?: "Eintrag", onBack = { nav.popBackStack() }, actions = {
                if (isDirty) BarButton("Verwerfen", { fields = base; failure = null })
                if (detail != null) BarButton("Sichern", { save(detail.decision) }, enabled = !saving && isDirty && fields?.title?.isNotBlank() == true, bold = true)
            })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val f = fields
            when {
                detail != null && f != null -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
                    DecisionForm(
                        session, detail, f, base!!, failure, isDirty,
                        onChange = { fields = it },
                        open = { nav.navigate(DecisionRoute(it)) },
                        openIdea = { nav.navigate(IdeaRoute(it)) },
                        openTask = { navigator.linkedTask = it },
                        openLink = { openUrl(context, it) },
                        onSupersede = { superseding = true },
                        onAddLink = { addingLink = true },
                        onAddRelation = { addingRelation = true },
                        onDelete = { confirmDelete = true },
                        runner = runner,
                    )
                }
                loadError != null -> FailureView(loadError!!) { load() }
                else -> LoadingView()
            }
        }
    }
    if (confirmDelete) {
        ConfirmDialog("Eintrag löschen?", "Ersetzte Entscheidungen gelten danach wieder.", "Löschen", onConfirm = {
            runner.run("Löschen fehlgeschlagen") {
                store.delete(decisionId)
                nav.popBackStack()
            }
        }, onDismiss = { confirmDelete = false })
    }
    if (superseding) SupersedeView(session, decisionId, { superseding = false }) { nav.navigate(DecisionRoute(it)) }
    if (addingLink) DecisionLinkEditor(session, decisionId) { addingLink = false }
    if (addingRelation) RelationPicker(session, decisionId) { addingRelation = false }
    runner.Alerts()
}

@Composable
private fun DecisionForm(
    session: SessionModel,
    detail: DecisionDetail,
    values: DecisionFields,
    base: DecisionFields,
    failure: ApiError?,
    isDirty: Boolean,
    onChange: (DecisionFields) -> Unit,
    open: (String) -> Unit,
    openIdea: (String) -> Unit,
    openTask: (String) -> Unit,
    openLink: (String) -> Unit,
    onSupersede: () -> Unit,
    onAddLink: () -> Unit,
    onAddRelation: () -> Unit,
    onDelete: () -> Unit,
    runner: de.vistoo.work.ui.components.ActionRunner,
) {
    val d = detail.decision
    val store = session.decisions
    fun error(key: String) = failure?.fieldErrors?.get(key) ?: if (values.status != base.status) values.completionProblems[key] else null

    GroupedList {
        d.supersededBy?.let { successor ->
            section("successor") { row { NavRow("Ersetzt durch „${successor.title}“", { open(successor.id) }, icon = { Icon(Icons.AutoMirrored.Filled.Redo, null, tint = Tokens.Palette.accentBlue) }) } }
        }
        section(
            "main",
            footer = if (values.status.isConcluded && !base.status.isConcluded) {
                if (values.type == DecisionType.Decision) "Zum Abschließen braucht es Entscheidung und Begründung." else "Zum Abschließen braucht es ein Ergebnis."
            } else null,
        ) {
            row("title") { FormTextField(values.title, { onChange(values.copy(title = it)) }, "Titel", style = VType.headline) }
            failure?.fieldErrors?.get("title")?.let { row("te") { FieldError(it) } }
            if (!base.status.isConcluded) row("type") {
                PickerRow("Typ", values.type, DecisionType.knownCases.map { t -> PickerOption(t, t.label) { Icon(t.icon, null, tint = Tokens.Palette.mutedForeground) } }, { t ->
                    var next = values.copy(type = t)
                    // Matching stage of the other type (open ↔ planned, in discussion ↔ testing).
                    if (values.status !in t.statuses && t.statuses.isNotEmpty()) {
                        val stage = if (values.status == DecisionStatus.InDiscussion || values.status == DecisionStatus.Testing) 1 else 0
                        next = next.copy(status = t.statuses[minOf(stage, t.statuses.size - 1)])
                    }
                    onChange(next)
                })
            }
            row("status") {
                val options = values.type.statuses.filter { it != DecisionStatus.Superseded || values.status == DecisionStatus.Superseded }
                    .map { s -> PickerOption(s, s.label) { StatusDot(s.hex) } } +
                    listOfNotNull((values.status as? DecisionStatus.Unknown)?.let { PickerOption<DecisionStatus>(it, it.label) })
                PickerRow("Status", values.status, options, { s ->
                    // Concluding fills in today as the decision date (the server does the same when omitted).
                    onChange(values.copy(status = s, concludedOn = if (s.isConcluded) values.concludedOn ?: CalendarDate.today() else values.concludedOn))
                }, enabled = values.status != DecisionStatus.Superseded)
            }
            failure?.fieldErrors?.get("status")?.let { row("se") { FieldError(it) } }
            row("assignee") { PersonPicker("Verantwortlich", session.work, values.assigneeId, { onChange(values.copy(assigneeId = it)) }, session.userId) }
            val day = values.concludedOn
            if (values.status.isConcluded && day != null) row("concluded") {
                DateValueRow(DecisionFieldLabel.label("concludedOn", values.type), day, { onChange(values.copy(concludedOn = it)) })
            }
        }
        for (key in values.type.textFields) {
            section("text-$key", header = DecisionFieldLabel.label(key, values.type)) {
                row { FormTextField(values.text(key), { onChange(values.copy(texts = values.texts + (key to it))) }, DecisionFieldLabel.placeholder(key, values.type), minLines = 3) }
                error(key)?.let { row("e") { FieldError(it) } }
            }
        }
        failureSection(failure?.takeIf { it.fieldErrors.isEmpty() })

        if (d.type == DecisionType.Decision && d.status == DecisionStatus.Decided && !isDirty) {
            section("supersede", footer = "Die alte Entscheidung bleibt vollständig erhalten und verweist auf die neue.") {
                row { ActionRow("Durch neue Entscheidung ersetzen …", icon = { Icon(Icons.AutoMirrored.Filled.Redo, null) }, onClick = onSupersede) }
            }
        }
        if (d.supersedes.isNotEmpty()) {
            section("supersedes", header = "Ersetzt") { for (ref in d.supersedes) row(ref.id) { NavRow(ref.title, { open(ref.id) }) } }
        }
        section("links", header = "Links") {
            for (link in detail.links) row(link.id) {
                SwipeRow(start = null, end = SwipeAction("Entfernen", Icons.Filled.Delete, Tokens.Palette.destructive) {
                    runner.run("Entfernen fehlgeschlagen") { store.deleteLink(link) }
                }) {
                    MenuTarget({ listOf(MenuEntry.Item("Entfernen", Icons.Filled.Delete, destructive = true) { runner.run("Entfernen fehlgeschlagen") { store.deleteLink(link) } }) }, onClick = { openLink(link.url) }) {
                        ListRow(leading = { Icon(Icons.Filled.Link, null, tint = Tokens.Palette.accentBlue) }) {
                            Text(link.title ?: runCatching { java.net.URI(link.url).host }.getOrNull() ?: link.url, color = Tokens.Palette.accentBlue)
                        }
                    }
                }
            }
            row("add") { ActionRow("Link hinzufügen", icon = { Icon(Icons.Filled.Add, null) }, onClick = onAddLink) }
        }
        section("relations", header = "Verknüpfte Issues & Ideen") {
            for (r in detail.relations) row(r.id) {
                val remove = { runner.run("Entfernen fehlgeschlagen") { store.removeRelation(r, d.id) } }
                SwipeRow(start = null, end = SwipeAction("Lösen", Icons.Filled.LinkOff, Tokens.Palette.destructive, remove)) {
                    MenuTarget({ listOf(MenuEntry.Item("Lösen", Icons.Filled.LinkOff, destructive = true, onClick = remove)) }, onClick = {
                        if (r.kind == RelationKind.Idea) openIdea(r.targetId) else openTask(r.targetId)
                    }) { RelationLabel(r.kind, r.title, r.number, r.status) }
                }
            }
            row("add") { ActionRow("Issue oder Idee verknüpfen", icon = { Icon(Icons.Filled.Add, null) }, onClick = onAddRelation) }
        }
        if (detail.history.isNotEmpty()) {
            section("history", header = "Verlauf") {
                for (h in detail.history) row(h.id) { HistoryRow(session, h, d.type) }
            }
        }
        section("meta") {
            session.work.person(d.createdBy)?.let { c -> row("c") { LabeledRow("Erstellt", "${c.displayName}, ${Formatting.instant(d.createdAt)}") } }
            row("u") { LabeledRow("Zuletzt geändert", Formatting.instant(d.updatedAt)) }
        }
        section("delete") { row { ActionRow("Eintrag löschen …", destructive = true, onClick = onDelete) } }
    }
}

@Composable
private fun HistoryRow(session: SessionModel, h: DecisionHistory, type: DecisionType) {
    var expanded by remember { mutableStateOf(false) }
    val actor = session.work.person(h.actorId)?.displayName ?: "Ehemaliges Mitglied"
    val title = when (h.kind) {
        HistoryKind.Concluded -> "Abgeschlossen" + (h.details.toStatus?.let { ": ${it.label}" } ?: "")
        HistoryKind.Reopened -> if (h.details.reason == "successor_deleted") "Wieder gültig (Nachfolger gelöscht)" else "Wieder geöffnet"
        HistoryKind.Superseded -> "Ersetzt"
        HistoryKind.Edited -> {
            val names = h.details.fields.orEmpty().map { DecisionFieldLabel.label(it, type) }
            if (names.isEmpty()) "Bearbeitet" else "Bearbeitet: " + names.joinToString(", ")
        }
        is HistoryKind.Unknown -> h.kind.rawValue
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = VType.dense)
        Text("$actor · ${Formatting.instant(h.createdAt)}", style = VType.caption, color = Tokens.Palette.mutedForeground)
        val previous = h.details.previous
        if (!previous.isNullOrEmpty()) {
            Text(
                if (expanded) "Vorherige Fassung ausblenden" else "Vorherige Fassung",
                style = VType.caption,
                color = Tokens.Palette.accentBlue,
                modifier = Modifier.clickable { expanded = !expanded }.padding(vertical = 4.dp),
            )
            if (expanded) {
                for (key in previous.keys.sorted()) {
                    val value = previous[key]
                    Text(DecisionFieldLabel.label(key, type), style = VType.caption.copy(fontWeight = FontWeight.SemiBold))
                    Text(
                        when {
                            value.isNullOrEmpty() -> "–"
                            key == "status" -> DecisionStatus.from(value).label
                            else -> value
                        },
                        style = VType.caption,
                    )
                }
            }
        }
    }
}

@Composable
private fun RelationLabel(relation: RelationKind, title: String, number: Long?, status: String) {
    ListRow(
        leading = { Icon(if (relation == RelationKind.Idea) Icons.Outlined.Lightbulb else Icons.Outlined.Checklist, null, tint = Tokens.Palette.mutedForeground) },
        trailing = {
            Text(
                if (relation == RelationKind.Idea) IdeaStatus.from(status).label else TaskStatus.from(status).label,
                style = VType.caption,
                color = Tokens.Palette.mutedForeground,
            )
        },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            number?.let { Text("#$it", color = Tokens.Palette.mutedForeground) }
            Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

// MARK: - Supersede / links / relations

@Composable
private fun SupersedeView(session: SessionModel, decisionId: String, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    var useExisting by remember { mutableStateOf(false) }
    val newId = remember { newClientId() }
    var title by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf<List<DecisionRef>>(emptyList()) }
    var selected by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { candidates = runCatching { session.decisions.supersedeCandidates(decisionId) }.getOrDefault(emptyList()) }
    FormSheet(
        "Entscheidung ersetzen", onDismiss, dismissEnabled = !saving, confirmLabel = "Ersetzen",
        confirmEnabled = !saving && if (useExisting) selected != null else title.isNotBlank(),
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    val successor = if (useExisting) session.decisions.supersede(decisionId, successorId = selected)
                    else session.decisions.supersede(decisionId, newTitle = title.trim(), newId = newId)
                    onDismiss()
                    if (!useExisting) onDone(successor.id)
                } catch (e: ApiError) {
                    failure = e
                } finally {
                    saving = false
                }
            }
        },
    ) {
        GroupedList {
            section("mode") {
                row { Box(Modifier.padding(12.dp)) { Segmented(listOf(PickerOption(false, "Neue Entscheidung"), PickerOption(true, "Bestehende")), useExisting, { useExisting = it }) } }
            }
            if (useExisting) {
                section("candidates") {
                    if (candidates.isEmpty()) row("none") { ListRow { Text("Keine passenden Entscheidungen.", color = Tokens.Palette.mutedForeground) } }
                    for (c in candidates) row(c.id) { CheckRow(c.title, selected == c.id, { selected = c.id }) { StatusDot(c.status.hex) } }
                }
            } else {
                section("new") {
                    row { FormTextField(title, { title = it }, "Titel der neuen Entscheidung", autoFocus = true) }
                    failure?.fieldErrors?.get("newTitle")?.let { row("e") { FieldError(it) } }
                }
            }
            failureSection(failure)
        }
    }
}

@Composable
private fun DecisionLinkEditor(session: SessionModel, decisionId: String, onDismiss: () -> Unit) {
    val clientId = remember { newClientId() }
    var url by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()
    FormSheet("Link hinzufügen", onDismiss, confirmLabel = "Hinzufügen", confirmEnabled = !saving && url.isNotBlank(), onConfirm = {
        saving = true
        scope.launch {
            try {
                session.decisions.addLink(decisionId, clientId, url.trim(), title.trim().ifEmpty { null })
                onDismiss()
            } catch (e: ApiError) {
                failure = e
            } finally {
                saving = false
            }
        }
    }) {
        GroupedList {
            section("main") {
                row("u") { FormTextField(url, { url = it }, "https://…", singleLine = true, keyboardOptions = UrlKeyboard, autoFocus = true) }
                failure?.fieldErrors?.get("url")?.let { row("e") { FieldError(it) } }
                row("t") { FormTextField(title, { title = it }, "Name (optional)", singleLine = true) }
            }
            failureSection(failure?.takeIf { it.fieldErrors.isEmpty() })
        }
    }
}

@Composable
private fun RelationPicker(session: SessionModel, decisionId: String, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf<List<RelationCandidate>>(emptyList()) }
    val runner = rememberActionRunner()
    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(250)
        candidates = runCatching { session.decisions.relationCandidates(decisionId, query) }.getOrDefault(candidates)
    }
    FormSheet("Verknüpfen", onDismiss) {
        Column {
            SearchField(query, { query = it }, "Titel oder #Nummer")
            PlainList {
                if (candidates.isEmpty()) item("none") { EmptyState("Keine Treffer", Icons.Outlined.Search, "Suche nach Titel oder #Nummer.") }
                for (c in candidates) item("${c.kind.rawValue}-${c.targetId}") {
                    PlainRow {
                        Box(Modifier.clickable {
                            runner.run("Verknüpfen fehlgeschlagen") {
                                session.decisions.addRelation(decisionId, c)
                                onDismiss()
                            }
                        }) { RelationLabel(c.kind, c.title, c.number, c.status) }
                    }
                }
            }
        }
    }
    runner.Alerts()
}
