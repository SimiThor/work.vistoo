import SwiftUI
import VistooCore

/// Channel details and management. Who may do what is decided by the server
/// (`canManage`); the UI only hides what would be refused.
struct ConversationDetailsView: View {
    let session: SessionModel
    let model: ConversationModel
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var description = ""
    @State private var showAddMembers = false
    @State private var newMembers: Set<String> = []
    @State private var removing: ChatPerson?
    @State private var leaving = false
    @State private var handoverTo: String?
    @State private var confirmArchive = false
    @State private var failure: ActionFailure?

    private var detail: ConversationDetail? { model.detail }
    private var isOwner: Bool { detail?.ownerId == session.userId }

    var body: some View {
        NavigationStack {
            if let detail {
                Form {
                    if detail.kind == .dm {
                        if let partner = detail.dmPartner {
                            Section {
                                PersonRow(fullName: partner.fullName, email: partner.email, detail: partner.active ? partner.email : "Kein aktives Mitglied mehr")
                            }
                        }
                    } else {
                        channelSection(detail)
                        if detail.kind == .privateChannel { membersSection(detail) }
                        actionsSection(detail)
                    }
                }
                .navigationTitle(detail.kind == .dm ? "Direktnachricht" : "Kanal")
                .inlineNavigationTitle()
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
                .onAppear {
                    name = detail.title
                    description = detail.description
                }
                .sheet(isPresented: $showAddMembers) { addMembersSheet(detail) }
                .confirmationDialog(
                    "Aus dem Kanal entfernen?",
                    isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                    titleVisibility: .visible,
                    presenting: removing
                ) { person in
                    Button("Entfernen", role: .destructive) { run { try await model.removeMember(person.userId) } }
                } message: { person in
                    Text("\(person.displayName) verliert den Zugriff auf diesen Kanal.")
                }
                .sheet(isPresented: $leaving) { leaveSheet(detail) }
                .confirmationDialog(detail.archived ? "Kanal wiederherstellen?" : "Kanal archivieren?", isPresented: $confirmArchive, titleVisibility: .visible) {
                    Button(detail.archived ? "Wiederherstellen" : "Archivieren", role: detail.archived ? nil : .destructive) {
                        run { try await model.setArchived(!detail.archived) }
                    }
                } message: {
                    Text(detail.archived ? "Neue Nachrichten sind danach wieder möglich." : "Der Verlauf bleibt lesbar, neue Nachrichten sind nicht mehr möglich.")
                }
                .failureAlert($failure)
            } else {
                LoadingView()
            }
        }
    }

    @ViewBuilder private func channelSection(_ detail: ConversationDetail) -> some View {
        Section {
            if detail.canManage && !detail.archived {
                TextField("Name", text: $name)
                TextField("Beschreibung", text: $description, axis: .vertical).lineLimit(1...4)
                Button("Änderungen sichern") {
                    run { try await model.updateChannel(name: name.trimmingCharacters(in: .whitespaces), description: description.trimmingCharacters(in: .whitespaces)) }
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || (name == detail.title && description == detail.description))
            } else {
                LabeledContent("Name", value: detail.title)
                if !detail.description.isEmpty { Text(detail.description).foregroundStyle(Tokens.Palette.mutedForeground) }
            }
        } footer: {
            Text(detail.kind == .privateChannel
                 ? "Geschlossener Kanal: nur für hinzugefügte Mitglieder sichtbar."
                 : "Offener Kanal: für alle Mitglieder des Workspaces.")
        }
    }

    @ViewBuilder private func membersSection(_ detail: ConversationDetail) -> some View {
        Section("Mitglieder (\(detail.members.count))") {
            ForEach(detail.members) { person in
                HStack {
                    PersonRow(
                        fullName: person.fullName,
                        email: person.email,
                        detail: person.userId == detail.ownerId ? "Verantwortlich" : (person.active ? nil : "Kein aktives Mitglied mehr")
                    )
                }
                .swipeActions {
                    if detail.canManage, person.userId != session.userId, !detail.archived {
                        Button(role: .destructive) { removing = person } label: { Label("Entfernen", systemImage: "person.badge.minus") }
                    }
                }
            }
            if detail.canManage, !detail.archived {
                Button { newMembers = []; showAddMembers = true } label: { Label("Mitglieder hinzufügen", systemImage: "person.badge.plus") }
            }
        }
    }

    @ViewBuilder private func actionsSection(_ detail: ConversationDetail) -> some View {
        Section {
            if detail.kind == .privateChannel, detail.members.contains(where: { $0.userId == session.userId }) {
                Button("Kanal verlassen …", role: .destructive) {
                    handoverTo = nil
                    leaving = true
                }
            }
            if detail.canManage, !detail.isDefault {
                Button(detail.archived ? "Wiederherstellen" : "Archivieren …", role: detail.archived ? nil : .destructive) { confirmArchive = true }
            }
        } footer: {
            if detail.isDefault { Text("„Allgemein“ kann nicht archiviert werden.") }
        }
    }

    private func addMembersSheet(_ detail: ConversationDetail) -> some View {
        let existing = Set(detail.members.map(\.userId))
        return NavigationStack {
            List {
                Section {
                    MemberMultiPicker(people: session.work.members.filter { !existing.contains($0.userId) }, selection: $newMembers)
                } footer: {
                    Text("Neue Mitglieder sehen den bisherigen Verlauf.")
                }
            }
            .navigationTitle("Hinzufügen")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { showAddMembers = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Hinzufügen") {
                        let ids = Array(newMembers)
                        showAddMembers = false
                        run { try await model.addMembers(ids) }
                    }
                    .disabled(newMembers.isEmpty)
                }
            }
        }
    }

    /// The responsible person hands over or archives (server rule: no orphaned private channels).
    private func leaveSheet(_ detail: ConversationDetail) -> some View {
        let others = detail.members.filter { $0.userId != session.userId && $0.active }
        return NavigationStack {
            Form {
                if isOwner && !others.isEmpty {
                    Section {
                        Picker("Neue verantwortliche Person", selection: $handoverTo) {
                            Text("Bitte wählen").tag(String?.none)
                            ForEach(others) { Text($0.displayName).tag(String?.some($0.userId)) }
                        }
                    } footer: {
                        Text("Du bist verantwortlich. Übergib die Verantwortung oder archiviere den Kanal.")
                    }
                    Section {
                        Button("Verlassen und übergeben", role: .destructive) {
                            leaving = false
                            run { try await model.removeMember(session.userId, newOwnerId: handoverTo); dismiss() }
                        }
                        .disabled(handoverTo == nil)
                        Button("Verlassen und archivieren", role: .destructive) {
                            leaving = false
                            run { try await model.removeMember(session.userId, archive: true); dismiss() }
                        }
                    }
                } else {
                    Section {
                        Button("Kanal verlassen", role: .destructive) {
                            leaving = false
                            run { try await model.removeMember(session.userId, archive: others.isEmpty); dismiss() }
                        }
                    } footer: {
                        Text(others.isEmpty ? "Du bist das letzte Mitglied: Der Kanal wird archiviert." : "Du verlierst den Zugriff auf diesen Kanal.")
                    }
                }
            }
            .navigationTitle("Kanal verlassen")
            .inlineNavigationTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { leaving = false } } }
        }
        .presentationDetents([.medium])
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() } catch let error as APIError { failure = ActionFailure("Aktion fehlgeschlagen", error) } catch {}
        }
    }
}
