import SwiftUI
import VistooCore

extension DecisionType {
    var icon: String {
        switch self {
        case .decision: "checkmark.seal"
        case .experiment: "flask"
        case .unknown: "questionmark.circle"
        }
    }
}

/// Field names as on the web (`fieldLabel` in packages/domain/decisions).
enum DecisionFieldLabel {
    static func label(_ field: String, type: DecisionType) -> String {
        switch field {
        case "title": "Titel"
        case "description": type == .decision ? "Kontext" : "Beschreibung"
        case "optionsConsidered": "Betrachtete Optionen"
        case "objective": "Ziel"
        case "testDescription": "Was wurde getestet"
        case "results": "Ergebnis"
        case "outcome": type == .decision ? "Entscheidung" : "Fazit"
        case "reasoning": "Begründung"
        case "status": "Status"
        case "concludedOn": type == .decision ? "Entscheidungsdatum" : "Abschlussdatum"
        default: field
        }
    }

    static func placeholder(_ field: String, type: DecisionType) -> String {
        switch field {
        case "description": type == .decision ? "Worum geht es, was ist die Ausgangslage?" : "Was wird ausprobiert und warum?"
        case "optionsConsidered": "Welche Möglichkeiten gab es?"
        case "results": "Was kam heraus?"
        case "outcome": "Was wurde entschieden?"
        case "reasoning": "Warum so?"
        default: ""
        }
    }
}

// MARK: - List

struct DecisionsScreen: View {
    let session: SessionModel
    @Environment(Navigator.self) private var navigator
    @State private var creating = false

    private var store: DecisionStore { session.decisions }

    var body: some View {
        @Bindable var store = store
        AreaContent(state: store.state, isEmpty: store.decisions.isEmpty && store.query == .init(), retry: store.reload) {
            List {
                if store.decisions.isEmpty {
                    if store.query == .init() {
                        ContentUnavailableView(
                            "Noch nichts festgehalten",
                            systemImage: "checkmark.seal",
                            description: Text("Halte Entscheidungen und Experimente fest, damit sie später auffindbar sind.")
                        )
                        .listRowBackground(Color.clear)
                    } else {
                        ContentUnavailableView("Keine Treffer", systemImage: "magnifyingglass", description: Text("Passe Suche oder Filter an."))
                            .listRowBackground(Color.clear)
                    }
                }
                ForEach(store.decisions) { d in
                    NavigationLink(value: AreaRoute.decision(d.id)) { DecisionRow(decision: d, work: session.work) }
                }
            }
            .plainListStyle()
        }
        .navigationTitle("Entscheidungen")
        .searchable(text: $store.query.text, prompt: "Titel, Kontext, Ergebnis …")
        .toolbar {
            ToolbarItem(placement: .trailing) { filterMenu }
            ToolbarItem(placement: .trailing) {
                Button { creating = true } label: { Label("Neu", systemImage: "plus") }
            }
        }
        .task(id: store.query) {
            // Server-side full-text search: wait until typing pauses.
            if store.state == .loaded { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await store.reload()
        }
        .refreshable { await store.reload() }
        .sheet(isPresented: $creating) {
            NavigationStack {
                DecisionCreateView(session: session) { id in navigator.morePath.append(.decision(id)) }
            }
        }
    }

    private var filterMenu: some View {
        @Bindable var store = store
        return Menu {
            Picker("Typ", selection: $store.query.type) {
                Text("Alle Typen").tag(DecisionType?.none)
                ForEach(DecisionType.knownCases, id: \.self) { t in Label(t.label, systemImage: t.icon).tag(DecisionType?.some(t)) }
            }
            Picker("Status", selection: $store.query.status) {
                Text("Alle Status").tag(DecisionStatus?.none)
                ForEach(statusOptions, id: \.self) { s in DotLabel(text: s.label, hex: s.hex).tag(DecisionStatus?.some(s)) }
            }
            Picker("Verantwortlich", selection: $store.query.assigneeId) {
                Text("Alle Personen").tag(String?.none)
                Text("Niemand").tag(String?.some(DomainDefaults.unassigned))
                ForEach(session.work.members) { m in Text(m.displayName).tag(String?.some(m.userId)) }
            }
            Picker("Sortierung", selection: $store.query.sort) {
                ForEach(DecisionSort.knownCases, id: \.self) { Text($0.label).tag($0) }
            }
            if store.query.filterCount > 0 {
                Button("Filter zurücksetzen", role: .destructive) {
                    store.query.type = nil
                    store.query.status = nil
                    store.query.assigneeId = nil
                }
            }
        } label: {
            Label("Filter", systemImage: store.query.filterCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    private var statusOptions: [DecisionStatus] {
        if let type = store.query.type { return type.statuses }
        return DecisionStatus.knownCases
    }
}

struct DecisionRow: View {
    let decision: DecisionSummary
    let work: WorkStore

    var body: some View {
        let d = decision
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            Image(systemName: d.type.icon)
                .foregroundStyle(Tokens.Palette.mutedForeground)
                .frame(width: 22)
                .padding(.top, 2)
                .accessibilityLabel(d.type.label)
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(d.title)
                    .foregroundStyle(d.status == .superseded ? Tokens.Palette.mutedForeground : Tokens.Palette.foreground)
                    .strikethrough(d.status == .superseded)
                    .lineLimit(2)
                if !d.outcomePreview.isEmpty {
                    Text(d.outcomePreview).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground).lineLimit(2)
                }
                HStack(spacing: Tokens.Spacing.sm) {
                    DotLabel(text: d.status.label, hex: d.status.hex)
                    if let day = d.concludedOn { Text(Formatting.short(day)) }
                }
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            if let person = work.person(d.assigneeId) {
                Avatar(fullName: person.fullName, email: person.email, size: 24)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Capture in seconds: type + title, the rest happens in the detail.
struct DecisionCreateView: View {
    let session: SessionModel
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var type: DecisionType = .decision
    @State private var title = ""
    @State private var saving = false
    @State private var failure: APIError?
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                Picker("Typ", selection: $type) {
                    ForEach(DecisionType.knownCases, id: \.self) { t in Text(t.label).tag(t) }
                }
                .pickerStyle(.segmented)
                TextField(type == .decision ? "Was wird entschieden?" : "Was wird ausprobiert?", text: $title, axis: .vertical)
                    .font(.headline)
                    .lineLimit(1...4)
                    .focused($focused)
                FieldError(message: failure?.fieldErrors["title"])
            } footer: {
                Text("Nur der Titel ist Pflicht. Kontext, Optionen und Ergebnis ergänzt du danach.")
            }
            FailureSection(error: failure)
        }
        .navigationTitle("Neu festhalten")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Erstellen") { Task { await save() } }.disabled(saving || title.trimmed.isEmpty)
            }
        }
        .interactiveDismissDisabled(saving)
        .task {
            try? await Task.sleep(for: .milliseconds(450))
            focused = true
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let created = try await session.decisions.create(id: clientId, type: type, title: title)
            dismiss()
            onCreated(created.id)
        } catch {
            failure = error
        }
    }
}

// MARK: - Detail

/// Editable values of the detail form.
private struct DecisionFields: Equatable {
    var type: DecisionType
    var title: String
    var status: DecisionStatus
    var assigneeId: String?
    var texts: [String: String]
    var concludedOn: CalendarDate?

    init(_ d: Decision) {
        type = d.type
        title = d.title
        status = d.status
        assigneeId = d.assigneeId
        texts = [
            "description": d.description,
            "optionsConsidered": d.optionsConsidered,
            "objective": d.objective,
            "testDescription": d.testDescription,
            "results": d.results,
            "outcome": d.outcome,
            "reasoning": d.reasoning,
        ]
        concludedOn = d.concludedOn
    }

    func text(_ key: String) -> String { texts[key] ?? "" }

    /// Quick local check; the server enforces the same rule (`completionErrors`).
    var completionProblems: [String: String] {
        guard status.isConcluded else { return [:] }
        var errors: [String: String] = [:]
        if type == .experiment {
            if text("results").trimmed.isEmpty { errors["results"] = "Bitte halte das Ergebnis fest." }
        } else {
            if text("outcome").trimmed.isEmpty { errors["outcome"] = "Bitte halte die finale Entscheidung fest." }
            if text("reasoning").trimmed.isEmpty { errors["reasoning"] = "Bitte begründe den Abschluss." }
        }
        return errors
    }
}

struct DecisionDetailScreen: View {
    let session: SessionModel
    let decisionId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(Navigator.self) private var navigator
    @State private var fields: DecisionFields?
    @State private var base: DecisionFields?
    @State private var loadError: String?
    @State private var saving = false
    @State private var failure: APIError?
    @State private var actionFailure: ActionFailure?
    @State private var confirmDelete = false
    @State private var superseding = false
    @State private var addingLink = false
    @State private var addingRelation = false
    @State private var saved = 0

    private var store: DecisionStore { session.decisions }
    private var detail: DecisionDetail? { store.details[decisionId] }
    private var isDirty: Bool { fields != nil && fields != base }

    var body: some View {
        Group {
            if let detail, let fields {
                form(detail, Binding(get: { fields }, set: { self.fields = $0 }))
            } else if let loadError {
                FailureView(message: loadError) { await load() }
            } else {
                LoadingView()
            }
        }
        .navigationTitle(fields?.type.label ?? "Eintrag")
        .inlineNavigationTitle()
        .task { await load() }
        .onChange(of: detail?.decision) { _, d in
            guard let d, !isDirty else { return }
            adopt(d)
        }
        .confirmationDialog("Eintrag löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                Task {
                    do {
                        try await store.delete(decisionId)
                        dismiss()
                    } catch { actionFailure = ActionFailure("Löschen fehlgeschlagen", error) }
                }
            }
        } message: {
            Text("Ersetzte Entscheidungen gelten danach wieder.")
        }
        .sheet(isPresented: $superseding) {
            NavigationStack {
                SupersedeView(session: session, decisionId: decisionId) { successorId in
                    navigator.morePath.append(.decision(successorId))
                }
            }
        }
        .sheet(isPresented: $addingLink) { NavigationStack { DecisionLinkEditor(session: session, decisionId: decisionId) } }
        .sheet(isPresented: $addingRelation) { NavigationStack { RelationPicker(session: session, decisionId: decisionId) } }
        .failureAlert($actionFailure)
        .sensoryFeedback(.success, trigger: saved)
    }

    private func load() async {
        do {
            try await store.loadDetail(decisionId)
            loadError = nil
            if let d = detail?.decision, !isDirty { adopt(d) }
        } catch {
            if detail == nil { loadError = error.message }
        }
    }

    private func adopt(_ d: Decision) {
        fields = DecisionFields(d)
        base = DecisionFields(d)
    }

    private func error(_ key: String, _ f: DecisionFields) -> String? {
        failure?.fieldErrors[key] ?? (f.status != base?.status ? f.completionProblems[key] : nil)
    }

    @ViewBuilder
    private func form(_ detail: DecisionDetail, _ f: Binding<DecisionFields>) -> some View {
        let d = detail.decision
        let values = f.wrappedValue
        Form {
            if let successor = d.supersededBy {
                Section {
                    NavigationLink(value: AreaRoute.decision(successor.id)) {
                        Label("Ersetzt durch „\(successor.title)“", systemImage: "arrow.uturn.right")
                    }
                }
            }
            Section {
                TextField("Titel", text: f.title, axis: .vertical).font(.headline).lineLimit(1...4)
                FieldError(message: failure?.fieldErrors["title"])
                if !base!.status.isConcluded {
                    Picker("Typ", selection: Binding(get: { values.type }, set: { t in
                        f.wrappedValue.type = t
                        // Matching stage of the other type (open ↔ planned, in discussion ↔ testing).
                        if !t.statuses.contains(values.status) {
                            let stage = [.inDiscussion, .testing].contains(values.status) ? 1 : 0
                            f.wrappedValue.status = t.statuses[min(stage, t.statuses.count - 1)]
                        }
                    })) {
                        ForEach(DecisionType.knownCases, id: \.self) { t in Label(t.label, systemImage: t.icon).tag(t) }
                    }
                }
                Picker("Status", selection: f.status) {
                    ForEach(values.type.statuses.filter { $0 != .superseded || values.status == .superseded }, id: \.self) { s in
                        DotLabel(text: s.label, hex: s.hex).tag(s)
                    }
                    if case .unknown = values.status { Text(values.status.label).tag(values.status) }
                }
                .disabled(values.status == .superseded)
                FieldError(message: failure?.fieldErrors["status"])
                PersonPicker(title: "Verantwortlich", work: session.work, selection: f.assigneeId, viewerId: session.userId)
                if values.status.isConcluded, let day = values.concludedOn {
                    DatePicker(
                        DecisionFieldLabel.label("concludedOn", type: values.type),
                        selection: Binding(get: { day.date() }, set: { f.wrappedValue.concludedOn = CalendarDate($0) }),
                        displayedComponents: .date
                    )
                    .environment(\.locale, Formatting.locale)
                }
            } footer: {
                if values.status.isConcluded && !base!.status.isConcluded {
                    Text(values.type == .decision ? "Zum Abschließen braucht es Entscheidung und Begründung." : "Zum Abschließen braucht es ein Ergebnis.")
                }
            }

            ForEach(values.type.textFields, id: \.self) { key in
                Section {
                    TextField(
                        DecisionFieldLabel.placeholder(key, type: values.type),
                        text: Binding(get: { values.text(key) }, set: { f.wrappedValue.texts[key] = $0 }),
                        axis: .vertical
                    )
                    .lineLimit(3...)
                    FieldError(message: error(key, values))
                } header: {
                    Text(DecisionFieldLabel.label(key, type: values.type))
                }
            }

            FailureSection(error: failure.flatMap { $0.fieldErrors.isEmpty ? $0 : nil })

            if d.type == .decision && d.status == .decided && !isDirty {
                Section {
                    Button { superseding = true } label: { Label("Durch neue Entscheidung ersetzen …", systemImage: "arrow.uturn.right") }
                } footer: {
                    Text("Die alte Entscheidung bleibt vollständig erhalten und verweist auf die neue.")
                }
            }
            if !d.supersedes.isEmpty {
                Section("Ersetzt") {
                    ForEach(d.supersedes, id: \.id) { ref in
                        NavigationLink(value: AreaRoute.decision(ref.id)) { Text(ref.title) }
                    }
                }
            }

            linksSection(detail)
            relationsSection(detail)
            if !detail.history.isEmpty { historySection(detail) }

            Section {
                if let creator = session.work.person(d.createdBy) {
                    LabeledContent("Erstellt", value: "\(creator.displayName), \(Formatting.instant(d.createdAt))")
                }
                LabeledContent("Zuletzt geändert", value: Formatting.instant(d.updatedAt))
            }
            Section {
                Button("Eintrag löschen …", role: .destructive) { confirmDelete = true }
            }
        }
        .toolbar {
            if isDirty {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Verwerfen") {
                        fields = base
                        failure = nil
                    }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Sichern") { Task { await save(d) } }
                    .disabled(saving || !isDirty || values.title.trimmed.isEmpty)
            }
        }
        .refreshable { await load() }
    }

    @ViewBuilder private func linksSection(_ detail: DecisionDetail) -> some View {
        Section("Links") {
            ForEach(detail.links, id: \.id) { link in
                Button {
                    if let url = URL(string: link.url) { openURL(url) }
                } label: {
                    Label(link.title ?? URL(string: link.url)?.host() ?? link.url, systemImage: "link")
                }
                .swipeActions {
                    Button(role: .destructive) {
                        Task { do { try await store.deleteLink(link) } catch { actionFailure = ActionFailure("Entfernen fehlgeschlagen", error) } }
                    } label: { Label("Entfernen", systemImage: "trash") }
                }
            }
            Button { addingLink = true } label: { Label("Link hinzufügen", systemImage: "plus") }
        }
    }

    @ViewBuilder private func relationsSection(_ detail: DecisionDetail) -> some View {
        Section("Verknüpfte Issues & Ideen") {
            ForEach(detail.relations, id: \.id) { r in
                Group {
                    if r.kind == .idea {
                        NavigationLink(value: AreaRoute.idea(r.targetId)) { RelationLabel(relation: r.kind, title: r.title, number: r.number, status: r.status) }
                    } else {
                        Button { navigator.linkedTask = .init(id: r.targetId) } label: {
                            RelationLabel(relation: r.kind, title: r.title, number: r.number, status: r.status)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .swipeActions {
                    Button(role: .destructive) {
                        Task { do { try await store.removeRelation(r, from: decisionId) } catch { actionFailure = ActionFailure("Entfernen fehlgeschlagen", error) } }
                    } label: { Label("Lösen", systemImage: "link.badge.plus") }
                }
            }
            Button { addingRelation = true } label: { Label("Issue oder Idee verknüpfen", systemImage: "plus") }
        }
    }

    @ViewBuilder private func historySection(_ detail: DecisionDetail) -> some View {
        let type = detail.decision.type
        Section("Verlauf") {
            ForEach(detail.history, id: \.id) { h in
                let actor = session.work.person(h.actorId)?.displayName ?? "Ehemaliges Mitglied"
                VStack(alignment: .leading, spacing: 4) {
                    Text(historyTitle(h, type: type)).font(.subheadline)
                    Text("\(actor) · \(Formatting.instant(h.createdAt))").font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                    if let previous = h.details.previous, !previous.isEmpty {
                        DisclosureGroup("Vorherige Fassung") {
                            ForEach(previous.keys.sorted(), id: \.self) { key in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(DecisionFieldLabel.label(key, type: type)).font(.caption.weight(.semibold))
                                    Text(previousValue(key, previous[key] ?? nil)).font(.caption)
                                }
                            }
                        }
                        .font(.caption)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func previousValue(_ key: String, _ value: String?) -> String {
        guard let value, !value.isEmpty else { return "–" }
        if key == "status" { return DecisionStatus(rawValue: value).label }
        return value
    }

    private func historyTitle(_ h: DecisionHistory, type: DecisionType) -> String {
        switch h.kind {
        case .concluded: return "Abgeschlossen" + (h.details.toStatus.map { ": \($0.label)" } ?? "")
        case .reopened: return h.details.reason == "successor_deleted" ? "Wieder gültig (Nachfolger gelöscht)" : "Wieder geöffnet"
        case .superseded: return "Ersetzt"
        case .edited:
            let names = (h.details.fields ?? []).map { DecisionFieldLabel.label($0, type: type) }
            return names.isEmpty ? "Bearbeitet" : "Bearbeitet: " + names.joined(separator: ", ")
        case .unknown(let raw): return raw
        }
    }

    /// Sends only the changed fields.
    private func save(_ d: Decision) async {
        guard let fields, let base else { return }
        var patch = UpdateDecisionRequest()
        if fields.type != base.type { patch.type = fields.type }
        if fields.title != base.title { patch.title = fields.title.trimmed }
        if fields.status != base.status { patch.status = fields.status }
        if fields.assigneeId != base.assigneeId { patch.assigneeId = Patchable(fields.assigneeId) }
        if fields.concludedOn != base.concludedOn, let day = fields.concludedOn { patch.concludedOn = day.iso }
        for key in fields.type.textFields where fields.text(key) != base.text(key) {
            let v = fields.text(key)
            switch key {
            case "description": patch.description = v
            case "optionsConsidered": patch.optionsConsidered = v
            case "objective": patch.objective = v
            case "testDescription": patch.testDescription = v
            case "results": patch.results = v
            case "outcome": patch.outcome = v
            case "reasoning": patch.reasoning = v
            default: break
            }
        }
        saving = true
        defer { saving = false }
        do {
            let updated = try await store.update(d.id, patch)
            failure = nil
            adopt(updated.decision)
            saved += 1
        } catch {
            failure = error
        }
    }
}

private struct RelationLabel: View {
    let relation: RelationKind
    let title: String
    let number: Int?
    let status: String

    var body: some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: relation == .idea ? "lightbulb" : "checklist")
                .foregroundStyle(Tokens.Palette.mutedForeground)
                .frame(width: 22)
            if let number { Text(verbatim: "#\(number)").monospacedDigit().foregroundStyle(Tokens.Palette.mutedForeground) }
            Text(title).lineLimit(2)
            Spacer()
            Text(relation == .idea ? IdeaStatus(rawValue: status).label : TaskStatus(rawValue: status).label)
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Supersede / links / relations

private struct SupersedeView: View {
    let session: SessionModel
    let decisionId: String
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var useExisting = false
    @State private var newId = newClientId()
    @State private var title = ""
    @State private var candidates: [DecisionRef] = []
    @State private var selected: String?
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        Form {
            Section {
                Picker("Nachfolger", selection: $useExisting) {
                    Text("Neue Entscheidung").tag(false)
                    Text("Bestehende").tag(true)
                }
                .pickerStyle(.segmented)
            }
            if useExisting {
                Section {
                    if candidates.isEmpty {
                        Text("Keine passenden Entscheidungen.").foregroundStyle(Tokens.Palette.mutedForeground)
                    }
                    ForEach(candidates, id: \.id) { c in
                        Button {
                            selected = c.id
                        } label: {
                            HStack {
                                DotLabel(text: c.title, hex: c.status.hex).foregroundStyle(Tokens.Palette.foreground)
                                Spacer()
                                if selected == c.id { Image(systemName: "checkmark").foregroundStyle(Tokens.Palette.accentBlue) }
                            }
                        }
                    }
                }
            } else {
                Section {
                    TextField("Titel der neuen Entscheidung", text: $title, axis: .vertical).lineLimit(1...3)
                    FieldError(message: failure?.fieldErrors["newTitle"])
                }
            }
            FailureSection(error: failure)
        }
        .navigationTitle("Entscheidung ersetzen")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Ersetzen") { Task { await save() } }
                    .disabled(saving || (useExisting ? selected == nil : title.trimmed.isEmpty))
            }
        }
        .task {
            candidates = (try? await session.decisions.supersedeCandidates(decisionId)) ?? []
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let successor = useExisting
                ? try await session.decisions.supersede(decisionId, successorId: selected)
                : try await session.decisions.supersede(decisionId, newTitle: title.trimmed, newId: newId)
            dismiss()
            if !useExisting { onDone(successor.id) }
        } catch {
            failure = error
        }
    }
}

private struct DecisionLinkEditor: View {
    let session: SessionModel
    let decisionId: String
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = newClientId()
    @State private var url = ""
    @State private var title = ""
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        Form {
            Section {
                TextField("https://…", text: $url).urlInput()
                FieldError(message: failure?.fieldErrors["url"])
                TextField("Name (optional)", text: $title)
            }
            FailureSection(error: failure.flatMap { $0.fieldErrors.isEmpty ? $0 : nil })
        }
        .navigationTitle("Link hinzufügen")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Hinzufügen") {
                    Task {
                        saving = true
                        defer { saving = false }
                        do {
                            try await session.decisions.addLink(to: decisionId, id: clientId, url: url.trimmed, title: title.nilIfBlank)
                            dismiss()
                        } catch { failure = error as? APIError }
                    }
                }
                .disabled(saving || url.trimmed.isEmpty)
            }
        }
    }
}

private struct RelationPicker: View {
    let session: SessionModel
    let decisionId: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var candidates: [RelationCandidate] = []
    @State private var failure: ActionFailure?

    var body: some View {
        List {
            if candidates.isEmpty {
                ContentUnavailableView("Keine Treffer", systemImage: "magnifyingglass", description: Text("Suche nach Titel oder #Nummer."))
                    .listRowBackground(Color.clear)
            }
            ForEach(candidates, id: \.targetId) { c in
                Button {
                    Task {
                        do {
                            try await session.decisions.addRelation(to: decisionId, c)
                            dismiss()
                        } catch { failure = ActionFailure("Verknüpfen fehlgeschlagen", error) }
                    }
                } label: {
                    RelationLabel(relation: c.kind, title: c.title, number: c.number, status: c.status)
                }
                .buttonStyle(.plain)
            }
        }
        .plainListStyle()
        .searchable(text: $query, prompt: "Titel oder #Nummer")
        .navigationTitle("Verknüpfen")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
        }
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled else { return }
            candidates = (try? await session.decisions.relationCandidates(decisionId, query: query)) ?? candidates
        }
        .failureAlert($failure)
    }
}
