import SwiftUI
import VistooCore

private enum CRMSort: String, CaseIterable, Hashable {
    case name, created, lastContact, followUp
    var label: String {
        switch self {
        case .name: "Name"
        case .created: "Zuletzt angelegt"
        case .lastContact: "Letzter Kontakt"
        case .followUp: "Nächstes Follow-up"
        }
    }
}

extension Attraction {
    var place: String { [city, country].compactMap { $0?.nilIfBlank }.joined(separator: ", ") }
    func followUpOverdue(today: CalendarDate = .today()) -> Bool { nextFollowUp.map { $0 < today } ?? false }
}

/// CRM list ("Attraktionen"): key figures, search, filters, sorting.
struct CRMScreen: View {
    let session: SessionModel
    @State private var query = ""
    @State private var status: AttractionStatus?
    /// Member id or `DomainDefaults.unassigned`.
    @State private var owner: String?
    @State private var overdueOnly = false
    @State private var sort: CRMSort = .name
    @State private var creating = false

    private var store: CRMStore { session.crm }

    private var visible: [Attraction] {
        let q = query.trimmed.lowercased()
        let list = store.attractions.filter { a in
            (q.isEmpty || a.name.lowercased().contains(q) || a.place.lowercased().contains(q))
                && (status == nil || a.status == status)
                && (owner == nil || (owner == DomainDefaults.unassigned ? a.ownerId == nil : a.ownerId == owner))
                && (!overdueOnly || a.followUpOverdue())
        }
        let byName: (Attraction, Attraction) -> Bool = { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return list.sorted { a, b in
            switch sort {
            case .name: return byName(a, b)
            case .created: return a.createdAt > b.createdAt
            case .lastContact:
                if a.lastContactAt != b.lastContactAt { return (a.lastContactAt ?? .distantPast) > (b.lastContactAt ?? .distantPast) }
                return byName(a, b)
            case .followUp:
                if a.nextFollowUp != b.nextFollowUp {
                    guard let x = a.nextFollowUp else { return false }
                    guard let y = b.nextFollowUp else { return true }
                    return x < y
                }
                return byName(a, b)
            }
        }
    }

    private var filterCount: Int { [status != nil, owner != nil, overdueOnly].filter { $0 }.count }

    var body: some View {
        AreaContent(state: store.state, isEmpty: store.attractions.isEmpty, retry: store.reload) {
            List {
                if store.attractions.isEmpty {
                    ContentUnavailableView("Noch keine Einträge", systemImage: "building.2", description: Text("Lege die erste Attraktion an."))
                        .listRowBackground(Color.clear)
                } else {
                    Section { figures }
                    if visible.isEmpty {
                        ContentUnavailableView("Keine Treffer", systemImage: "magnifyingglass", description: Text("Passe Suche oder Filter an."))
                            .listRowBackground(Color.clear)
                    }
                    Section {
                        ForEach(visible) { a in
                            NavigationLink(value: AreaRoute.attraction(a.id)) { AttractionRow(attraction: a, work: session.work) }
                        }
                    }
                }
            }
            .groupedListStyle()
        }
        .navigationTitle("CRM")
        .searchable(text: $query, prompt: "Name oder Ort")
        .toolbar {
            ToolbarItem(placement: .trailing) { filterMenu }
            ToolbarItem(placement: .trailing) {
                Button { creating = true } label: { Label("Neue Attraktion", systemImage: "plus") }
            }
        }
        .refreshable { await store.reload() }
        .task { if store.state == .idle { await store.reload() } }
        .sheet(isPresented: $creating) { NavigationStack { AttractionEditor(session: session, attraction: nil) } }
    }

    private var figures: some View {
        let all = store.attractions
        let contacted = all.filter { $0.status != .new }.count
        let interested = all.filter { [.interested, .inDiscussion, .partner].contains($0.status) }.count
        let partners = all.filter { $0.status == .partner }.count
        let overdue = all.filter { $0.followUpOverdue() }.count
        return VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack {
                figure("Gesamt", all.count)
                figure("Kontaktiert", contacted)
                figure("Interessiert", interested)
                figure("Partner", partners)
            }
            if overdue > 0 {
                Button {
                    overdueOnly.toggle()
                } label: {
                    Label(overdueOnly ? "Alle anzeigen" : "\(overdue) Follow-up\(overdue == 1 ? "" : "s") überfällig", systemImage: "alarm")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Tokens.Palette.destructive)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func figure(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)").font(.title3.weight(.semibold)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var filterMenu: some View {
        Menu {
            Picker("Status", selection: $status) {
                Text("Alle Status").tag(AttractionStatus?.none)
                ForEach(AttractionStatus.knownCases, id: \.self) { s in DotLabel(text: s.label, hex: s.hex).tag(AttractionStatus?.some(s)) }
            }
            Picker("Verantwortlich", selection: $owner) {
                Text("Alle Personen").tag(String?.none)
                Text("Niemand").tag(String?.some(DomainDefaults.unassigned))
                ForEach(session.work.members) { m in Text(m.displayName).tag(String?.some(m.userId)) }
            }
            Toggle("Nur überfällige Follow-ups", isOn: $overdueOnly)
            Picker("Sortierung", selection: $sort) {
                ForEach(CRMSort.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            if filterCount > 0 {
                Button("Filter zurücksetzen", role: .destructive) {
                    status = nil
                    owner = nil
                    overdueOnly = false
                }
            }
        } label: {
            Label("Filter", systemImage: filterCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}

struct AttractionRow: View {
    let attraction: Attraction
    let work: WorkStore

    var body: some View {
        let a = attraction
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(a.name).lineLimit(2)
                HStack(spacing: Tokens.Spacing.sm) {
                    DotLabel(text: a.status.label, hex: a.status.hex)
                    if !a.place.isEmpty { Text(a.place).lineLimit(1) }
                }
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
                if let follow = a.nextFollowUp {
                    HStack(spacing: 4) {
                        Text("Follow-up")
                        DueDateLabel(date: follow)
                    }
                    .font(.caption)
                    .foregroundStyle(Tokens.Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            if let person = work.person(a.ownerId) {
                Avatar(fullName: person.fullName, email: person.email, size: 24)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Detail

struct AttractionDetailScreen: View {
    let session: SessionModel
    let attractionId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var activityTarget: ActivityTarget?
    @State private var confirmDelete = false
    @State private var confirmDeleteActivity: Activity?
    @State private var failure: ActionFailure?
    @State private var notes = ""
    @State private var notesBase = ""
    @State private var savingNotes = false

    private var store: CRMStore { session.crm }
    private var attraction: Attraction? { store.attraction(attractionId) }

    var body: some View {
        Group {
            if let a = attraction {
                content(a)
            } else if store.state == .loaded {
                ContentUnavailableView("Eintrag gelöscht", systemImage: "trash", description: Text("Diesen Eintrag gibt es nicht mehr."))
            } else {
                LoadingView()
            }
        }
        .navigationTitle(attraction?.name ?? "Attraktion")
        .inlineNavigationTitle()
        .task {
            if store.state == .idle { await store.reload() }
            adoptNotes()
            await store.loadActivities(attractionId)
        }
        .onChange(of: attraction?.notes) { _, _ in if notes == notesBase { adoptNotes() } }
        .sheet(isPresented: $editing) {
            if let a = attraction { NavigationStack { AttractionEditor(session: session, attraction: a) } }
        }
        .sheet(item: $activityTarget) { target in
            NavigationStack { ActivityEditor(session: session, attractionId: attractionId, activity: target.activity) }
        }
        .confirmationDialog("Eintrag löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                Task {
                    guard let a = attraction else { return }
                    do {
                        try await store.delete(a)
                        dismiss()
                    } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) }
                }
            }
        } message: {
            Text("Der Eintrag und sein Verlauf werden endgültig gelöscht.")
        }
        .confirmationDialog("Aktivität löschen?", isPresented: Binding(get: { confirmDeleteActivity != nil }, set: { if !$0 { confirmDeleteActivity = nil } }), titleVisibility: .visible, presenting: confirmDeleteActivity) { activity in
            Button("Löschen", role: .destructive) {
                Task { do { try await store.deleteActivity(activity) } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) } }
            }
        }
        .failureAlert($failure)
    }

    private func adoptNotes() {
        guard let a = attraction else { return }
        notes = a.notes
        notesBase = a.notes
    }

    @ViewBuilder private func content(_ a: Attraction) -> some View {
        List {
            Section {
                Picker("Status", selection: Binding(get: { a.status }, set: { s in update(a, UpdateAttractionRequest(status: s)) })) {
                    ForEach(AttractionStatus.knownCases, id: \.self) { s in DotLabel(text: s.label, hex: s.hex).tag(s) }
                    if case .unknown = a.status { Text(a.status.label).tag(a.status) }
                }
                PersonPicker(
                    title: "Verantwortlich",
                    work: session.work,
                    selection: Binding(get: { a.ownerId }, set: { id in update(a, UpdateAttractionRequest(ownerId: Patchable(id))) }),
                    viewerId: session.userId
                )
                OptionalDateRow(
                    title: "Nächstes Follow-up",
                    date: Binding(get: { a.nextFollowUp }, set: { d in update(a, UpdateAttractionRequest(nextFollowUp: Patchable(d))) })
                )
                if let last = a.lastContactAt {
                    LabeledContent("Letzter Kontakt", value: Formatting.instant(last))
                }
            }
            Section("Kontakt") {
                if let contact = a.contactName { LabeledContent("Ansprechperson", value: contact) }
                if !a.place.isEmpty { LabeledContent("Ort", value: a.place) }
                if let email = a.email, let url = URL(string: "mailto:\(email)") {
                    Button { openURL(url) } label: { Label(email, systemImage: "envelope") }
                }
                if let site = a.website, let url = URL(string: site) {
                    Button { openURL(url) } label: { Label(url.host() ?? site, systemImage: "safari") }
                }
                Button { editing = true } label: { Label("Angaben bearbeiten", systemImage: "pencil") }
            }
            Section {
                TextField("Notizen", text: $notes, axis: .vertical).lineLimit(3...)
                if notes != notesBase {
                    Button {
                        Task { await saveNotes(a) }
                    } label: {
                        HStack {
                            Text("Notizen sichern")
                            if savingNotes { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(savingNotes)
                }
            } header: {
                Text("Notizen")
            }
            Section {
                Button { activityTarget = ActivityTarget(activity: nil) } label: {
                    Label("Aktivität hinzufügen", systemImage: "plus.bubble")
                }
                ForEach(store.activities[a.id] ?? []) { activity in
                    ActivityRow(activity: activity, work: session.work)
                        .swipeActions {
                            if canEdit(activity) {
                                Button(role: .destructive) { confirmDeleteActivity = activity } label: { Label("Löschen", systemImage: "trash") }
                                Button { activityTarget = ActivityTarget(activity: activity) } label: { Label("Bearbeiten", systemImage: "pencil") }
                                    .tint(Tokens.Palette.accentBlue)
                            }
                        }
                        .contextMenu {
                            if canEdit(activity) {
                                Button { activityTarget = ActivityTarget(activity: activity) } label: { Label("Bearbeiten", systemImage: "pencil") }
                                Button(role: .destructive) { confirmDeleteActivity = activity } label: { Label("Löschen", systemImage: "trash") }
                            }
                        }
                }
            } header: {
                Text("Verlauf")
            }
            Section {
                Button("Eintrag löschen …", role: .destructive) { confirmDelete = true }
            }
        }
        .groupedListStyle()
        .refreshable {
            await store.reload()
            await store.loadActivities(a.id)
        }
    }

    /// Display only: the server checks author/admin again.
    private func canEdit(_ activity: Activity) -> Bool {
        !activity.system && (activity.actorId == session.userId || session.isAdmin)
    }

    private func update(_ a: Attraction, _ patch: UpdateAttractionRequest) {
        Task {
            do { try await store.update(a.id, patch) } catch { failure = ActionFailure("Ändern fehlgeschlagen", error) }
        }
    }

    private func saveNotes(_ a: Attraction) async {
        savingNotes = true
        defer { savingNotes = false }
        do {
            try await store.update(a.id, UpdateAttractionRequest(notes: notes))
            notesBase = notes
        } catch {
            failure = ActionFailure("Notizen nicht gespeichert", error)
        }
    }
}

private struct ActivityTarget: Identifiable {
    let id = UUID()
    let activity: Activity?
}

struct ActivityRow: View {
    let activity: Activity
    let work: WorkStore

    private var actor: String { work.person(activity.actorId)?.displayName ?? "Ehemaliges Mitglied" }

    private var icon: String {
        switch activity.type {
        case .call: "phone"
        case .email: "envelope"
        case .meeting: "person.2"
        case .note: "note.text"
        case .created: "plus.circle"
        case .statusChanged: "circle.dotted"
        case .ownerChanged: "person.crop.circle"
        case .followUpChanged: "alarm"
        case .unknown: "circle"
        }
    }

    private var summary: String {
        let from = activity.metadata.from
        let to = activity.metadata.to
        switch activity.type {
        case .created: return "Eintrag angelegt"
        case .statusChanged:
            let a = from.map { AttractionStatus(rawValue: $0).label } ?? "–"
            let b = to.map { AttractionStatus(rawValue: $0).label } ?? "–"
            return "Status: \(a) → \(b)"
        case .ownerChanged:
            let b = to.flatMap { work.person($0)?.displayName } ?? "niemand"
            return "Verantwortlich: \(b)"
        case .followUpChanged:
            let b = to.flatMap(CalendarDate.init).map { Formatting.short($0) } ?? "keins"
            return "Follow-up: \(b)"
        default:
            return "\(ManualActivity.label(activity.type) ?? activity.type.rawValue) · \(actor)"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            Image(systemName: icon)
                .foregroundStyle(activity.system ? Tokens.Palette.mutedForeground : Tokens.Palette.accentBlue)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(summary).font(activity.system ? .footnote : .body)
                if !activity.description.isEmpty {
                    Text(activity.description).font(.callout)
                }
                Text(Formatting.instant(activity.occurredAt) + (activity.system ? " · \(actor)" : ""))
                    .font(.caption)
                    .foregroundStyle(Tokens.Palette.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Create or edit a CRM entry's contact data.
struct AttractionEditor: View {
    let session: SessionModel
    let attraction: Attraction?
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var name = ""
    @State private var city = ""
    @State private var country = ""
    @State private var website = ""
    @State private var email = ""
    @State private var contactName = ""
    @State private var status: AttractionStatus = .new
    @State private var ownerId: String?
    @State private var nextFollowUp: CalendarDate?
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name).font(.headline)
                FieldError(message: failure?.fieldErrors["name"])
                if attraction == nil {
                    Picker("Status", selection: $status) {
                        ForEach(AttractionStatus.knownCases, id: \.self) { s in DotLabel(text: s.label, hex: s.hex).tag(s) }
                    }
                    PersonPicker(title: "Verantwortlich", work: session.work, selection: $ownerId, viewerId: session.userId)
                    OptionalDateRow(title: "Nächstes Follow-up", date: $nextFollowUp)
                }
            }
            Section("Ort") {
                TextField("Stadt", text: $city)
                FieldError(message: failure?.fieldErrors["city"])
                TextField("Land", text: $country)
                FieldError(message: failure?.fieldErrors["country"])
            }
            Section("Kontakt") {
                TextField("Ansprechperson", text: $contactName).nameInput()
                FieldError(message: failure?.fieldErrors["contactName"])
                TextField("E-Mail", text: $email).emailInput()
                FieldError(message: failure?.fieldErrors["email"])
                TextField("Website", text: $website).urlInput()
                FieldError(message: failure?.fieldErrors["website"])
            }
            FailureSection(error: failure)
        }
        .navigationTitle(attraction == nil ? "Neue Attraktion" : "Angaben bearbeiten")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(attraction == nil ? "Erstellen" : "Sichern") { Task { await save() } }
                    .disabled(saving || name.trimmed.isEmpty)
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear {
            guard let a = attraction else { return }
            name = a.name
            city = a.city ?? ""
            country = a.country ?? ""
            website = a.website ?? ""
            email = a.email ?? ""
            contactName = a.contactName ?? ""
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let a = attraction {
                var patch = UpdateAttractionRequest()
                if name.trimmed != a.name { patch.name = name.trimmed }
                if city.nilIfBlank != a.city { patch.city = Patchable(city.nilIfBlank) }
                if country.nilIfBlank != a.country { patch.country = Patchable(country.nilIfBlank) }
                if website.nilIfBlank != a.website { patch.website = Patchable(website.nilIfBlank) }
                if email.nilIfBlank?.lowercased() != a.email { patch.email = Patchable(email.nilIfBlank) }
                if contactName.nilIfBlank != a.contactName { patch.contactName = Patchable(contactName.nilIfBlank) }
                try await session.crm.update(a.id, patch)
            } else {
                try await session.crm.create(CreateAttractionRequest(
                    id: clientId,
                    name: name.trimmed,
                    city: Patchable(city.nilIfBlank),
                    country: Patchable(country.nilIfBlank),
                    website: Patchable(website.nilIfBlank),
                    email: Patchable(email.nilIfBlank),
                    contactName: Patchable(contactName.nilIfBlank),
                    status: status,
                    ownerId: Patchable(ownerId),
                    nextFollowUp: Patchable(nextFollowUp)
                ))
            }
            dismiss()
        } catch {
            failure = error
        }
    }
}

/// Log a call / e-mail / meeting / note, or edit one.
struct ActivityEditor: View {
    let session: SessionModel
    let attractionId: String
    let activity: Activity?
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var type: ActivityType = .call
    @State private var description = ""
    @State private var occurredAt = Date.now
    @State private var setFollowUp = false
    @State private var nextFollowUp: CalendarDate?
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        Form {
            Section {
                Picker("Art", selection: $type) {
                    ForEach(ManualActivity.types, id: \.self) { t in Text(ManualActivity.label(t) ?? t.rawValue).tag(t) }
                }
                .pickerStyle(.segmented)
                DatePicker("Zeitpunkt", selection: $occurredAt, in: ...Date.now.addingTimeInterval(365 * 86_400))
                    .environment(\.locale, Formatting.locale)
            }
            Section("Beschreibung") {
                TextField("Was wurde besprochen?", text: $description, axis: .vertical).lineLimit(3...)
                FieldError(message: failure?.fieldErrors["description"])
            }
            if activity == nil {
                Section {
                    Toggle("Follow-up ändern", isOn: $setFollowUp)
                    if setFollowUp { OptionalDateRow(title: "Nächstes Follow-up", date: $nextFollowUp) }
                } footer: {
                    Text("Setzt das nächste Follow-up der Attraktion gleich mit.")
                }
            }
            FailureSection(error: failure)
        }
        .navigationTitle(activity == nil ? "Aktivität" : "Aktivität bearbeiten")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Sichern") { Task { await save() } }
                    .disabled(saving || description.count > CRMDefaults.activityMaxLength)
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear {
            if let activity {
                type = activity.type
                description = activity.description
                occurredAt = activity.occurredAt
            } else {
                nextFollowUp = session.crm.attraction(attractionId)?.nextFollowUp
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let activity {
                try await session.crm.updateActivity(activity, type: type, description: description.trimmed, occurredAt: occurredAt)
            } else {
                try await session.crm.addActivity(
                    to: attractionId,
                    id: clientId,
                    type: type,
                    description: description.trimmed,
                    occurredAt: occurredAt,
                    nextFollowUp: setFollowUp ? Patchable(nextFollowUp) : .unset
                )
            }
            dismiss()
        } catch {
            failure = error
        }
    }
}
