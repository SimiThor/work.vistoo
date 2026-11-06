import SwiftUI
import VistooCore

/// Conversation list (channels by name with "Allgemein" first, DMs by recent activity, archived collapsed).
struct ChatListScreen: View {
    let session: SessionModel
    @Binding var path: [ConversationRoute]
    @State private var showNewChannel = false
    @State private var showNewDM = false
    @State private var showArchived = false

    private var chat: ChatStore { session.chat }

    private var channels: [ConversationSummary] {
        chat.conversations.filter { $0.kind != .dm && !$0.archived }.sorted {
            if $0.isDefault != $1.isDefault { return $0.isDefault }
            return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
    }

    private var directMessages: [ConversationSummary] {
        chat.conversations.filter { $0.kind == .dm && !$0.archived }.sorted {
            ($0.lastMessageAt ?? .distantPast, $1.title) > ($1.lastMessageAt ?? .distantPast, $0.title)
        }
    }

    private var archived: [ConversationSummary] {
        chat.conversations.filter(\.archived).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var body: some View {
        Group {
            if chat.state == .loading, chat.conversations.isEmpty {
                LoadingView()
            } else if case .failed(let message) = chat.state, chat.conversations.isEmpty {
                FailureView(message: message) { await chat.reload() }
            } else {
                list
            }
        }
        .navigationTitle("Chat")
        .toolbar {
            ToolbarItem(placement: .trailing) {
                Menu {
                    Button { showNewChannel = true } label: { Label("Neuer Kanal", systemImage: "number") }
                    Button { showNewDM = true } label: { Label("Neue Direktnachricht", systemImage: "person.bubble") }
                } label: {
                    Label("Neue Unterhaltung", systemImage: "square.and.pencil")
                }
            }
        }
        .refreshable { await chat.reload() }
        .sheet(isPresented: $showNewChannel) {
            NewChannelSheet(session: session) { id in path.append(ConversationRoute(id: id)) }
        }
        .sheet(isPresented: $showNewDM) {
            NewDirectMessageSheet(session: session) { id in path.append(ConversationRoute(id: id)) }
        }
    }

    private var list: some View {
        List {
            Section("Kanäle") {
                ForEach(channels) { row($0) }
            }
            Section("Direktnachrichten") {
                if directMessages.isEmpty {
                    Text("Noch keine Direktnachrichten.").foregroundStyle(Tokens.Palette.mutedForeground)
                }
                ForEach(directMessages) { row($0) }
            }
            if !archived.isEmpty {
                Section(isExpanded: $showArchived) {
                    ForEach(archived) { row($0) }
                } header: {
                    Text("Archiviert (\(archived.count))")
                }
            }
            if let usage = chat.storageUsage {
                Section {
                    StorageUsageRow(usage: usage)
                }
            }
        }
        .groupedListStyle()
    }

    private func row(_ c: ConversationSummary) -> some View {
        NavigationLink(value: ConversationRoute(id: c.id)) {
            HStack(spacing: Tokens.Spacing.md) {
                Group {
                    if let partner = c.dmPartner {
                        Avatar(fullName: partner.fullName, email: partner.email, size: 28)
                    } else {
                        Image(systemName: c.kind == .privateChannel ? "lock" : "number")
                            .frame(width: 28)
                            .foregroundStyle(Tokens.Palette.mutedForeground)
                    }
                }
                Text(c.title)
                    .fontWeight(c.unread ? .semibold : .regular)
                    .lineLimit(1)
                Spacer()
                if c.unread {
                    Circle().fill(Tokens.Palette.accentBlue).frame(width: 9, height: 9)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                "\(c.kind == .dm ? "Direktnachricht" : c.kind == .privateChannel ? "Geschlossener Kanal" : "Kanal") \(c.title)"
                    + (c.unread ? ", ungelesene Nachrichten" : "")
            )
        }
    }
}

struct StorageUsageRow: View {
    let usage: ChatStorageUsage
    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text("Speicher für Chat-Dateien").font(.subheadline)
                Spacer()
                Text("\(ByteFormatting.string(usage.usedBytes)) von \(ByteFormatting.string(usage.budgetBytes))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Palette.mutedForeground)
            }
            ProgressView(value: min(usage.ratio, 1))
                .tint(usage.ratio >= DomainDefaults.storageWarnRatio ? Tokens.Palette.statusReview : Tokens.Palette.accentBlue)
            if usage.ratio >= 1 {
                Text("Speicher voll: Uploads sind gesperrt, Nachrichten ohne Anhang gehen weiter.")
                    .font(.caption).foregroundStyle(Tokens.Palette.warningFg)
            } else if usage.ratio >= DomainDefaults.storageWarnRatio {
                Text("Der Speicher ist fast voll.").font(.caption).foregroundStyle(Tokens.Palette.warningFg)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - New conversations

struct NewChannelSheet: View {
    let session: SessionModel
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var isPrivate = false
    @State private var members: Set<String> = []
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("Beschreibung (optional)", text: $description, axis: .vertical).lineLimit(1...4)
                }
                Section {
                    Picker("Sichtbarkeit", selection: $isPrivate) {
                        Text("Offen").tag(false)
                        Text("Geschlossen").tag(true)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(isPrivate
                         ? "Nur ausdrücklich hinzugefügte Mitglieder sehen den Kanal. Die Sichtbarkeit lässt sich später nicht ändern."
                         : "Alle Mitglieder des Workspaces können lesen und schreiben.")
                }
                if isPrivate {
                    Section("Mitglieder") {
                        MemberMultiPicker(people: session.work.members.filter { $0.userId != session.userId }, selection: $members)
                    }
                }
                if let failure {
                    Section { Text(failure.fieldErrors["name"] ?? failure.message).foregroundStyle(Tokens.Palette.destructive) }
                }
            }
            .navigationTitle("Neuer Kanal")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Erstellen") { Task { await create() } }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func create() async {
        saving = true
        defer { saving = false }
        do {
            let id = try await session.chat.createChannel(
                name: name.trimmingCharacters(in: .whitespaces),
                description: description.trimmingCharacters(in: .whitespaces),
                isPrivate: isPrivate,
                memberIds: Array(members)
            )
            dismiss()
            onCreated(id)
        } catch {
            failure = error
        }
    }
}

struct NewDirectMessageSheet: View {
    let session: SessionModel
    let onOpened: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var failure: ActionFailure?

    private var people: [Member] {
        session.work.members.filter {
            $0.userId != session.userId && (query.isEmpty || $0.displayName.localizedCaseInsensitiveContains(query) || $0.email.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        NavigationStack {
            List(people) { person in
                Button {
                    Task {
                        do {
                            let id = try await session.chat.openDirectMessage(with: person.userId)
                            dismiss()
                            onOpened(id)
                        } catch {
                            failure = ActionFailure("Unterhaltung nicht geöffnet", error)
                        }
                    }
                } label: {
                    PersonRow(fullName: person.fullName, email: person.email, detail: person.email)
                }
                .buttonStyle(.plain)
            }
            .searchable(text: $query, prompt: "Person suchen")
            .navigationTitle("Direktnachricht")
            .inlineNavigationTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
            .failureAlert($failure)
        }
    }
}

struct PersonRow: View {
    let fullName: String?
    let email: String
    var detail: String?
    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            Avatar(fullName: fullName, email: email, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(PersonName.display(fullName: fullName, email: email))
                if let detail { Text(detail).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground) }
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct MemberMultiPicker: View {
    let people: [Member]
    @Binding var selection: Set<String>
    var body: some View {
        ForEach(people) { m in
            Button {
                if selection.contains(m.userId) { selection.remove(m.userId) } else { selection.insert(m.userId) }
            } label: {
                HStack {
                    PersonRow(fullName: m.fullName, email: m.email)
                    if selection.contains(m.userId) {
                        Image(systemName: "checkmark").foregroundStyle(Tokens.Palette.accentBlue)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selection.contains(m.userId) ? .isSelected : [])
        }
    }
}
