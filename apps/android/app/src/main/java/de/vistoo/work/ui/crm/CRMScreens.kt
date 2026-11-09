package de.vistoo.work.ui.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Note
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DonutLarge
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.Activity
import de.vistoo.work.core.generated.ActivityType
import de.vistoo.work.core.generated.Attraction
import de.vistoo.work.core.generated.AttractionStatus
import de.vistoo.work.core.generated.CRMDefaults
import de.vistoo.work.core.generated.CreateAttractionRequest
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.ManualActivity
import de.vistoo.work.core.generated.UpdateAttractionRequest
import de.vistoo.work.core.generated.hex
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.core.support.newClientId
import de.vistoo.work.ui.app.AttractionRoute
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.Alerts
import de.vistoo.work.ui.components.AreaContent
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.DotLabel
import de.vistoo.work.ui.components.DueDateLabel
import de.vistoo.work.ui.components.EmailKeyboard
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.FieldError
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.InstantRow
import de.vistoo.work.ui.components.LabeledRow
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuButton
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.NameKeyboard
import de.vistoo.work.ui.components.OptionalDateRow
import de.vistoo.work.ui.components.PersonPicker
import de.vistoo.work.ui.components.PickerOption
import de.vistoo.work.ui.components.PickerRow
import de.vistoo.work.ui.components.SearchField
import de.vistoo.work.ui.components.Segmented
import de.vistoo.work.ui.components.StatusDot
import de.vistoo.work.ui.components.SwipeAction
import de.vistoo.work.ui.components.SwipeRow
import de.vistoo.work.ui.components.ToggleRow
import de.vistoo.work.ui.components.UrlKeyboard
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.nilIfBlank
import de.vistoo.work.ui.components.openUrl
import de.vistoo.work.ui.components.rememberActionRunner
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.tasks.failureSection
import de.vistoo.work.ui.theme.VType
import java.time.Instant
import kotlinx.coroutines.launch

private enum class CRMSort(val label: String) { Name("Name"), Created("Zuletzt angelegt"), LastContact("Letzter Kontakt"), FollowUp("Nächstes Follow-up") }

val Attraction.place: String get() = listOfNotNull(city?.nilIfBlank, country?.nilIfBlank).joinToString(", ")

fun Attraction.followUpOverdue(today: CalendarDate = CalendarDate.today()): Boolean = nextFollowUp?.let { it < today } ?: false

/** CRM list ("Attraktionen"): key figures, search, filters, sorting. */
@Composable
fun CRMScreen(session: SessionModel, nav: NavHostController) {
    val store = session.crm
    var query by rememberSaveable { mutableStateOf("") }
    var statusRaw by rememberSaveable { mutableStateOf<String?>(null) }
    /** Member id or `DomainDefaults.unassigned`. */
    var owner by rememberSaveable { mutableStateOf<String?>(null) }
    var overdueOnly by rememberSaveable { mutableStateOf(false) }
    var sort by rememberSaveable { mutableStateOf(CRMSort.Name) }
    var creating by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val status = statusRaw?.let { AttractionStatus.from(it) }
    LaunchedEffect(Unit) { if (store.state == LoadState.Idle) store.reload() }

    val q = query.trim().lowercase()
    val byName = compareBy<Attraction, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
    val visible = store.attractions.filter { a ->
        (q.isEmpty() || a.name.lowercase().contains(q) || a.place.lowercase().contains(q)) &&
            (status == null || a.status == status) &&
            (owner == null || (if (owner == DomainDefaults.unassigned) a.ownerId == null else a.ownerId == owner)) &&
            (!overdueOnly || a.followUpOverdue())
    }.sortedWith(
        when (sort) {
            CRMSort.Name -> byName
            CRMSort.Created -> compareByDescending { it.createdAt }
            CRMSort.LastContact -> compareByDescending<Attraction> { it.lastContactAt ?: Instant.EPOCH }.then(byName)
            CRMSort.FollowUp -> compareBy<Attraction> { it.nextFollowUp?.dayNumber ?: Long.MAX_VALUE }.then(byName)
        },
    )
    val filterCount = listOf(status != null, owner != null, overdueOnly).count { it }

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = {
            VistooTopBar("CRM", onBack = { nav.popBackStack() }, actions = {
                MenuButton(if (filterCount > 0) Icons.Outlined.FilterAlt else Icons.Filled.FilterList, "Filter", {
                    buildList {
                        add(MenuEntry.Submenu("Status", Icons.Outlined.DonutLarge, listOf(MenuEntry.Item("Alle Status", checked = status == null) { statusRaw = null }) +
                            AttractionStatus.knownCases.map { s -> MenuEntry.Item(s.label, checked = s == status) { statusRaw = s.rawValue } }))
                        add(MenuEntry.Submenu("Verantwortlich", Icons.Outlined.AccountCircle, listOf(
                            MenuEntry.Item("Alle Personen", checked = owner == null) { owner = null },
                            MenuEntry.Item("Niemand", checked = owner == DomainDefaults.unassigned) { owner = DomainDefaults.unassigned },
                        ) + session.work.members.map { m -> MenuEntry.Item(m.displayName, checked = owner == m.userId) { owner = m.userId } }))
                        add(MenuEntry.Item("Nur überfällige Follow-ups", Icons.Outlined.Alarm, checked = overdueOnly) { overdueOnly = !overdueOnly })
                        add(MenuEntry.Submenu("Sortierung", null, CRMSort.entries.map { s -> MenuEntry.Item(s.label, checked = s == sort) { sort = s } }))
                        if (filterCount > 0) {
                            add(MenuEntry.Divider)
                            add(MenuEntry.Item("Filter zurücksetzen", destructive = true) { statusRaw = null; owner = null; overdueOnly = false })
                        }
                    }
                }, badge = filterCount > 0)
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, "Neue Attraktion") }
            })
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SearchField(query, { query = it }, "Name oder Ort")
            Box(Modifier.weight(1f)) {
                AreaContent(store.state, store.attractions.isEmpty(), { store.reload() }) {
                    PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; store.reload(); refreshing = false } }) {
                        GroupedList {
                            if (store.attractions.isEmpty()) {
                                item("empty") { EmptyState("Noch keine Einträge", Icons.Outlined.Apartment, "Lege die erste Attraktion an.") }
                            } else {
                                section("figures") { row { Figures(store.attractions, overdueOnly) { overdueOnly = !overdueOnly } } }
                                if (visible.isEmpty()) item("none") { EmptyState("Keine Treffer", Icons.Outlined.Search, "Passe Suche oder Filter an.") }
                                section("list") {
                                    for (a in visible) row(a.id) { ListRow(onClick = { nav.navigate(AttractionRoute(a.id)) }) { AttractionRow(a, session.work) } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) AttractionEditor(session, null) { creating = false }
}

@Composable
private fun Figures(all: List<Attraction>, overdueOnly: Boolean, toggleOverdue: () -> Unit) {
    val contacted = all.count { it.status != AttractionStatus.New }
    val interested = all.count { it.status in listOf(AttractionStatus.Interested, AttractionStatus.InDiscussion, AttractionStatus.Partner) }
    val partners = all.count { it.status == AttractionStatus.Partner }
    val overdue = all.count { it.followUpOverdue() }
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row {
            for ((title, value) in listOf("Gesamt" to all.size, "Kontaktiert" to contacted, "Interessiert" to interested, "Partner" to partners)) {
                Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                    Text("$value", style = VType.title3)
                    Text(title, style = VType.caption, color = Tokens.Palette.mutedForeground)
                }
            }
        }
        if (overdue > 0) {
            androidx.compose.material3.TextButton(onClick = toggleOverdue, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Icon(Icons.Outlined.Alarm, null, tint = Tokens.Palette.destructive)
                Text(
                    if (overdueOnly) "Alle anzeigen" else "$overdue Follow-up${if (overdue == 1) "" else "s"} überfällig",
                    style = VType.footnote.copy(fontWeight = FontWeight.Medium),
                    color = Tokens.Palette.destructive,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
    }
}

@Composable
fun AttractionRow(a: Attraction, work: WorkStore) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(a.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
            androidx.compose.material3.ProvideTextStyle(VType.caption.copy(color = Tokens.Palette.mutedForeground)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    DotLabel(a.status.label, a.status.hex)
                    if (a.place.isNotEmpty()) Text(a.place, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                a.nextFollowUp?.let { f ->
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Follow-up")
                        DueDateLabel(f)
                    }
                }
            }
        }
        work.person(a.ownerId)?.let { Avatar(it.fullName, it.email, size = 24.dp) }
    }
}

// MARK: - Detail

@Composable
fun AttractionDetailScreen(session: SessionModel, attractionId: String, nav: NavHostController) {
    val store = session.crm
    val context = LocalContext.current
    val runner = rememberActionRunner()
    val a = store.attraction(attractionId)
    var editing by remember { mutableStateOf(false) }
    var activityTarget by remember { mutableStateOf<Pair<Activity?, Int>?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmDeleteActivity by remember { mutableStateOf<Activity?>(null) }
    var notes by remember { mutableStateOf("") }
    var notesBase by remember { mutableStateOf("") }
    var savingNotes by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun adoptNotes() {
        val x = store.attraction(attractionId) ?: return
        notes = x.notes
        notesBase = x.notes
    }
    LaunchedEffect(attractionId) {
        if (store.state == LoadState.Idle) store.reload()
        adoptNotes()
        store.loadActivities(attractionId)
    }
    LaunchedEffect(a?.notes) { if (notes == notesBase) adoptNotes() }
    fun update(patch: UpdateAttractionRequest) = runner.run("Ändern fehlgeschlagen") { store.update(attractionId, patch) }
    /** Display only: the server checks author/admin again. */
    fun canEdit(activity: Activity) = !activity.system && (activity.actorId == session.userId || session.isAdmin)

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = { VistooTopBar(a?.name ?: "Attraktion", onBack = { nav.popBackStack() }) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                a != null -> PullToRefreshBox(refreshing, onRefresh = {
                    scope.launch { refreshing = true; store.reload(); store.loadActivities(a.id); refreshing = false }
                }) {
                    GroupedList {
                        section("status") {
                            row("s") {
                                val options = AttractionStatus.knownCases.map { s -> PickerOption(s, s.label) { StatusDot(s.hex) } } +
                                    listOfNotNull((a.status as? AttractionStatus.Unknown)?.let { PickerOption<AttractionStatus>(it, it.label) })
                                PickerRow("Status", a.status, options, { update(UpdateAttractionRequest(status = it)) })
                            }
                            row("o") { PersonPicker("Verantwortlich", session.work, a.ownerId, { update(UpdateAttractionRequest(ownerId = Patchable.of(it))) }, session.userId) }
                            row("f") { OptionalDateRow("Nächstes Follow-up", a.nextFollowUp, { update(UpdateAttractionRequest(nextFollowUp = Patchable.of(it))) }) }
                            a.lastContactAt?.let { row("l") { LabeledRow("Letzter Kontakt", Formatting.instant(it)) } }
                        }
                        section("contact", header = "Kontakt") {
                            a.contactName?.let { row("c") { LabeledRow("Ansprechperson", it) } }
                            if (a.place.isNotEmpty()) row("p") { LabeledRow("Ort", a.place) }
                            a.email?.let { email -> row("e") { ActionRow(email, icon = { Icon(Icons.Outlined.Email, null) }, onClick = { openUrl(context, "mailto:$email") }) } }
                            a.website?.let { site ->
                                row("w") {
                                    ActionRow(runCatching { java.net.URI(site).host }.getOrNull() ?: site, icon = { Icon(Icons.Outlined.Language, null) }, onClick = { openUrl(context, site) })
                                }
                            }
                            row("edit") { ActionRow("Angaben bearbeiten", icon = { Icon(Icons.Filled.Edit, null) }, onClick = { editing = true }) }
                        }
                        section("notes", header = "Notizen") {
                            row("n") { FormTextField(notes, { notes = it }, "Notizen", minLines = 3) }
                            if (notes != notesBase) row("save") {
                                ActionRow("Notizen sichern", busy = savingNotes, onClick = {
                                    savingNotes = true
                                    scope.launch {
                                        try {
                                            store.update(a.id, UpdateAttractionRequest(notes = notes))
                                            notesBase = notes
                                        } catch (e: ApiError) {
                                            runner.failure = de.vistoo.work.ui.components.ActionFailure.of("Notizen nicht gespeichert", e)
                                        } finally {
                                            savingNotes = false
                                        }
                                    }
                                })
                            }
                        }
                        section("timeline", header = "Verlauf") {
                            row("add") { ActionRow("Aktivität hinzufügen", icon = { Icon(Icons.Outlined.AddComment, null) }, onClick = { activityTarget = null to 0 }) }
                            for (activity in store.activities[a.id].orEmpty()) row(activity.id) {
                                if (canEdit(activity)) {
                                    SwipeRow(
                                        start = SwipeAction("Bearbeiten", Icons.Filled.Edit, Tokens.Palette.accentBlue) { activityTarget = activity to 1 },
                                        end = SwipeAction("Löschen", Icons.Filled.Delete, Tokens.Palette.destructive) { confirmDeleteActivity = activity },
                                    ) {
                                        MenuTarget({
                                            listOf(
                                                MenuEntry.Item("Bearbeiten", Icons.Filled.Edit) { activityTarget = activity to 1 },
                                                MenuEntry.Item("Löschen", Icons.Filled.Delete, destructive = true) { confirmDeleteActivity = activity },
                                            )
                                        }, onClick = null) { ActivityRow(activity, session.work) }
                                    }
                                } else {
                                    ActivityRow(activity, session.work)
                                }
                            }
                        }
                        section("delete") { row { ActionRow("Eintrag löschen …", destructive = true, onClick = { confirmDelete = true }) } }
                    }
                }
                store.state == LoadState.Loaded -> EmptyState("Eintrag gelöscht", Icons.Outlined.DeleteOutline, "Diesen Eintrag gibt es nicht mehr.")
                else -> LoadingView()
            }
        }
    }
    if (editing && a != null) AttractionEditor(session, a) { editing = false }
    activityTarget?.let { (activity, _) -> ActivityEditor(session, attractionId, activity) { activityTarget = null } }
    if (confirmDelete && a != null) {
        ConfirmDialog("Eintrag löschen?", "Der Eintrag und sein Verlauf werden endgültig gelöscht.", "Löschen", onConfirm = {
            runner.run("Löschen fehlgeschlagen") {
                store.delete(a)
                nav.popBackStack()
            }
        }, onDismiss = { confirmDelete = false })
    }
    confirmDeleteActivity?.let { activity ->
        ConfirmDialog("Aktivität löschen?", null, "Löschen", onConfirm = { runner.run("Löschen fehlgeschlagen") { store.deleteActivity(activity) } }, onDismiss = { confirmDeleteActivity = null })
    }
    runner.Alerts()
}

@Composable
fun ActivityRow(activity: Activity, work: WorkStore) {
    val actor = work.person(activity.actorId)?.displayName ?: "Ehemaliges Mitglied"
    val icon: ImageVector = when (activity.type) {
        ActivityType.Call -> Icons.Outlined.Phone
        ActivityType.Email -> Icons.Outlined.Email
        ActivityType.Meeting -> Icons.Outlined.Groups
        ActivityType.Note -> Icons.AutoMirrored.Outlined.Note
        ActivityType.Created -> Icons.Outlined.AddCircleOutline
        ActivityType.StatusChanged -> Icons.Outlined.DonutLarge
        ActivityType.OwnerChanged -> Icons.Outlined.AccountCircle
        ActivityType.FollowUpChanged -> Icons.Outlined.Alarm
        else -> Icons.Outlined.Circle
    }
    val from = activity.metadata.from
    val to = activity.metadata.to
    val summary = when (activity.type) {
        ActivityType.Created -> "Eintrag angelegt"
        ActivityType.StatusChanged -> "Status: ${from?.let { AttractionStatus.from(it).label } ?: "–"} → ${to?.let { AttractionStatus.from(it).label } ?: "–"}"
        ActivityType.OwnerChanged -> "Verantwortlich: ${to?.let { work.person(it)?.displayName } ?: "niemand"}"
        ActivityType.FollowUpChanged -> "Follow-up: ${to?.let(CalendarDate::parse)?.let { Formatting.short(it) } ?: "keins"}"
        else -> "${ManualActivity.label(activity.type) ?: activity.type.rawValue} · $actor"
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, tint = if (activity.system) Tokens.Palette.mutedForeground else Tokens.Palette.accentBlue, modifier = Modifier.width(22.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(summary, style = if (activity.system) VType.footnote else VType.body)
            if (activity.description.isNotEmpty()) Text(activity.description, style = VType.callout)
            Text(Formatting.instant(activity.occurredAt) + if (activity.system) " · $actor" else "", style = VType.caption, color = Tokens.Palette.mutedForeground)
        }
    }
}

/** Create or edit a CRM entry's contact data. */
@Composable
fun AttractionEditor(session: SessionModel, attraction: Attraction?, onDismiss: () -> Unit) {
    val clientId = remember { newClientId() }
    var name by remember { mutableStateOf(attraction?.name ?: "") }
    var city by remember { mutableStateOf(attraction?.city ?: "") }
    var country by remember { mutableStateOf(attraction?.country ?: "") }
    var website by remember { mutableStateOf(attraction?.website ?: "") }
    var email by remember { mutableStateOf(attraction?.email ?: "") }
    var contactName by remember { mutableStateOf(attraction?.contactName ?: "") }
    var status by remember { mutableStateOf<AttractionStatus>(AttractionStatus.New) }
    var ownerId by remember { mutableStateOf<String?>(null) }
    var nextFollowUp by remember { mutableStateOf<CalendarDate?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()

    fun <T> changed(new: T?, old: T?): Patchable<T> = if (new != old) Patchable.of(new) else Patchable.Unset

    FormSheet(
        if (attraction == null) "Neue Attraktion" else "Angaben bearbeiten", onDismiss, dismissEnabled = !saving,
        confirmLabel = if (attraction == null) "Erstellen" else "Sichern", confirmEnabled = !saving && name.isNotBlank(),
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    if (attraction != null) {
                        session.crm.update(attraction.id, UpdateAttractionRequest(
                            name = name.trim().takeIf { it != attraction.name },
                            city = changed(city.nilIfBlank, attraction.city),
                            country = changed(country.nilIfBlank, attraction.country),
                            website = changed(website.nilIfBlank, attraction.website),
                            email = if (email.nilIfBlank?.lowercase() != attraction.email) Patchable.of(email.nilIfBlank) else Patchable.Unset,
                            contactName = changed(contactName.nilIfBlank, attraction.contactName),
                        ))
                    } else {
                        session.crm.create(CreateAttractionRequest(
                            id = clientId, name = name.trim(),
                            city = Patchable.of(city.nilIfBlank), country = Patchable.of(country.nilIfBlank),
                            website = Patchable.of(website.nilIfBlank), email = Patchable.of(email.nilIfBlank),
                            contactName = Patchable.of(contactName.nilIfBlank), status = status,
                            ownerId = Patchable.of(ownerId), nextFollowUp = Patchable.of(nextFollowUp),
                        ))
                    }
                    onDismiss()
                } catch (e: ApiError) {
                    failure = e
                } finally {
                    saving = false
                }
            }
        },
    ) {
        val errors = failure?.fieldErrors.orEmpty()
        GroupedList {
            section("main") {
                row("n") { FormTextField(name, { name = it }, "Name", singleLine = true, style = VType.headline, autoFocus = attraction == null) }
                errors["name"]?.let { row("ne") { FieldError(it) } }
                if (attraction == null) {
                    row("s") { PickerRow("Status", status, AttractionStatus.knownCases.map { s -> PickerOption(s, s.label) { StatusDot(s.hex) } }, { status = it }) }
                    row("o") { PersonPicker("Verantwortlich", session.work, ownerId, { ownerId = it }, session.userId) }
                    row("f") { OptionalDateRow("Nächstes Follow-up", nextFollowUp, { nextFollowUp = it }) }
                }
            }
            section("place", header = "Ort") {
                row("c") { FormTextField(city, { city = it }, "Stadt", singleLine = true) }
                errors["city"]?.let { row("ce") { FieldError(it) } }
                row("l") { FormTextField(country, { country = it }, "Land", singleLine = true) }
                errors["country"]?.let { row("le") { FieldError(it) } }
            }
            section("contact", header = "Kontakt") {
                row("p") { FormTextField(contactName, { contactName = it }, "Ansprechperson", singleLine = true, keyboardOptions = NameKeyboard) }
                errors["contactName"]?.let { row("pe") { FieldError(it) } }
                row("e") { FormTextField(email, { email = it }, "E-Mail", singleLine = true, keyboardOptions = EmailKeyboard) }
                errors["email"]?.let { row("ee") { FieldError(it) } }
                row("w") { FormTextField(website, { website = it }, "Website", singleLine = true, keyboardOptions = UrlKeyboard) }
                errors["website"]?.let { row("we") { FieldError(it) } }
            }
            failureSection(failure)
        }
    }
}

/** Log a call / e-mail / meeting / note, or edit one. */
@Composable
fun ActivityEditor(session: SessionModel, attractionId: String, activity: Activity?, onDismiss: () -> Unit) {
    val clientId = remember { newClientId() }
    var type by remember { mutableStateOf(activity?.type ?: ActivityType.Call) }
    var description by remember { mutableStateOf(activity?.description ?: "") }
    var occurredAt by remember { mutableStateOf(activity?.occurredAt ?: Instant.now()) }
    var setFollowUp by remember { mutableStateOf(false) }
    var nextFollowUp by remember { mutableStateOf(if (activity == null) session.crm.attraction(attractionId)?.nextFollowUp else null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<ApiError?>(null) }
    val scope = rememberCoroutineScope()

    FormSheet(
        if (activity == null) "Aktivität" else "Aktivität bearbeiten", onDismiss, dismissEnabled = !saving,
        confirmLabel = "Sichern", confirmEnabled = !saving && description.length <= CRMDefaults.activityMaxLength,
        onConfirm = {
            saving = true
            scope.launch {
                try {
                    if (activity != null) {
                        session.crm.updateActivity(activity, type, description.trim(), occurredAt)
                    } else {
                        session.crm.addActivity(attractionId, clientId, type, description.trim(), occurredAt, if (setFollowUp) Patchable.of(nextFollowUp) else Patchable.Unset)
                    }
                    onDismiss()
                } catch (e: ApiError) {
                    failure = e
                } finally {
                    saving = false
                }
            }
        },
    ) {
        GroupedList {
            section("main") {
                row("t") { Box(Modifier.padding(12.dp)) { Segmented(ManualActivity.types.map { PickerOption(it, ManualActivity.label(it) ?: it.rawValue) }, type, { type = it }) } }
                row("at") { InstantRow("Zeitpunkt", occurredAt) { occurredAt = it } }
            }
            section("desc", header = "Beschreibung") {
                row { FormTextField(description, { description = it }, "Was wurde besprochen?", minLines = 3) }
                failure?.fieldErrors?.get("description")?.let { row("e") { FieldError(it) } }
            }
            if (activity == null) {
                section("follow", footer = "Setzt das nächste Follow-up der Attraktion gleich mit.") {
                    row("t") { ToggleRow("Follow-up ändern", setFollowUp, { setFollowUp = it }) }
                    if (setFollowUp) row("d") { OptionalDateRow("Nächstes Follow-up", nextFollowUp, { nextFollowUp = it }) }
                }
            }
            failureSection(failure)
        }
    }
}
