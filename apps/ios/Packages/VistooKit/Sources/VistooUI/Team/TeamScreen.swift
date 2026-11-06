import SwiftUI
import VistooCore

/// Team management (members, invitations, roles), reached from Settings.
struct TeamScreen: View {
    let session: SessionModel

    @State private var showInvite = false
    @State private var removing: Member?
    @State private var failure: ActionFailure?
    @State private var notice: String?

    private var team: TeamStore { session.team }

    var body: some View {
        List {
            membersSection
            invitationsSection
        }
        .groupedListStyle()
        .navigationTitle("Team")
        .inlineNavigationTitle()
        .task { if team.state == .idle { await team.reload() } }
        .refreshable { await team.reload() }
        .toolbar {
            if team.isAdmin {
                ToolbarItem(placement: .trailing) {
                    Button { showInvite = true } label: { Label("Einladen", systemImage: "person.badge.plus") }
                }
            }
        }
        .sheet(isPresented: $showInvite) { InviteSheet(team: team) }
        .confirmationDialog(
            "Mitglied entfernen?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { member in
            Button("Entfernen", role: .destructive) {
                run("Entfernen fehlgeschlagen") {
                    let n = try await team.remove(member)
                    notice = n == 0 ? "\(member.displayName) wurde entfernt." : "\(member.displayName) wurde entfernt. \(n) Aufgaben sind jetzt nicht zugewiesen."
                }
            }
        } message: { member in
            Text("\(member.displayName) verliert sofort den Zugriff. Aufgaben bleiben erhalten, Zuweisungen werden gelöst.")
        }
        .alert("Erledigt", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(notice ?? "") }
        .failureAlert($failure)
    }

    @ViewBuilder private var membersSection: some View {
        Section("Mitglieder (\(team.members.count))") {
            if team.state == .loading, team.members.isEmpty { ProgressView() }
            if case .failed(let message) = team.state, team.members.isEmpty {
                Text(message).foregroundStyle(Tokens.Palette.destructive)
            }
            ForEach(team.members) { member in
                memberRow(member)
            }
        }
    }

    private func memberRow(_ member: Member) -> some View {
        let isMe = member.userId == session.userId
        return HStack {
            PersonRow(fullName: member.fullName, email: member.email, detail: member.email)
            Text(isMe ? "\(member.role.label) · Du" : member.role.label)
                .font(.caption)
                .foregroundStyle(Tokens.Palette.mutedForeground)
        }
        .contextMenu {
            if team.isAdmin {
                Menu("Rolle") {
                    ForEach(MemberRole.knownCases, id: \.self) { role in
                        Button {
                            run("Rolle nicht geändert") { try await team.changeRole(member, to: role) }
                        } label: {
                            if role == member.role { Label(role.label, systemImage: "checkmark") } else { Text(role.label) }
                        }
                    }
                }
                if !isMe {
                    Button(role: .destructive) { removing = member } label: { Label("Entfernen …", systemImage: "person.badge.minus") }
                }
            }
        }
        .swipeActions {
            if team.isAdmin, !isMe {
                Button(role: .destructive) { removing = member } label: { Label("Entfernen", systemImage: "person.badge.minus") }
            }
        }
    }

    @ViewBuilder private var invitationsSection: some View {
        if !team.invitations.isEmpty || team.isAdmin {
            Section {
                if team.invitations.isEmpty {
                    Text("Keine offenen Einladungen.").foregroundStyle(Tokens.Palette.mutedForeground)
                }
                ForEach(team.invitations) { inv in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(inv.email)
                        Text(inv.expired ? "Abgelaufen" : "\(inv.role.label) · gültig bis \(Formatting.instant(inv.expiresAt))")
                            .font(.caption)
                            .foregroundStyle(inv.expired ? Tokens.Palette.warningFg : Tokens.Palette.mutedForeground)
                    }
                    .swipeActions {
                        if team.isAdmin {
                            Button(role: .destructive) { run("Widerruf fehlgeschlagen") { try await team.revoke(inv) } } label: { Label("Widerrufen", systemImage: "xmark") }
                            Button { run("Nicht gesendet") { try await team.resend(inv); notice = "Einladung an \(inv.email) erneut gesendet." } } label: {
                                Label("Erneut senden", systemImage: "paperplane")
                            }
                            .tint(Tokens.Palette.accentBlue)
                        }
                    }
                    .contextMenu {
                        if team.isAdmin {
                            Button { run("Nicht gesendet") { try await team.resend(inv); notice = "Einladung an \(inv.email) erneut gesendet." } } label: {
                                Label("Erneut senden", systemImage: "paperplane")
                            }
                            Button(role: .destructive) { run("Widerruf fehlgeschlagen") { try await team.revoke(inv) } } label: { Label("Widerrufen", systemImage: "xmark") }
                        }
                    }
                }
            } header: {
                Text("Offene Einladungen · \(team.invitations.count)")
            }
        }
    }

    private func run(_ title: String, _ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() } catch let error as APIError { failure = ActionFailure(title, error) } catch {}
        }
    }
}

struct InviteSheet: View {
    let team: TeamStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var role: MemberRole = .member
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("E-Mail-Adresse", text: $email).emailInput()
                    Picker("Rolle", selection: $role) {
                        ForEach(MemberRole.knownCases, id: \.self) { Text($0.label).tag($0) }
                    }
                } footer: {
                    Text("Die Einladung ist \(DomainDefaults.invitationTtlDays) Tage gültig und nur für diese Adresse nutzbar.")
                }
                if let failure {
                    Section { Text(failure.fieldErrors["email"] ?? failure.message).foregroundStyle(Tokens.Palette.destructive) }
                }
            }
            .navigationTitle("Einladen")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Senden") {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                try await team.invite(email: email.trimmingCharacters(in: .whitespaces).lowercased(), role: role)
                                dismiss()
                            } catch { failure = error as? APIError }
                        }
                    }
                    .disabled(saving || !email.contains("@"))
                }
            }
        }
    }
}
