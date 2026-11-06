import SwiftUI
import VistooCore

/// Signed in without membership: accept the invitation addressed to this e-mail,
/// or explain why there is no access (same states as the web /invite page).
struct OnboardingView: View {
    let model: AppModel
    let me: Me

    @State private var fullName = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                switch me.access {
                case .invited:
                    if let invitation = me.invitation {
                        Section {
                            Text("Du wurdest als \(invitation.role.label) eingeladen (\(me.email)).")
                        } header: {
                            Text("Willkommen bei \(invitation.workspaceName)")
                                .font(Tokens.Typography.sectionTitle)
                                .textCase(nil)
                        }
                        Section("Dein Name") {
                            TextField("Vor- und Nachname", text: $fullName)
                                .nameInput()
                        }
                        Section {
                            Button {
                                Task { await accept(invitation.id) }
                            } label: {
                                if busy { ProgressView() } else { Text("Einladung annehmen") }
                            }
                            .disabled(busy || fullName.trimmingCharacters(in: .whitespaces).isEmpty)
                        } footer: {
                            if let error { Text(error).foregroundStyle(Tokens.Palette.destructive) }
                        }
                    }
                case .expired:
                    Section("Einladung abgelaufen") {
                        Text("Deine Einladung ist abgelaufen. Bitte einen Admin, sie erneut zu senden.")
                    }
                default:
                    Section("Kein Zugang") {
                        Text("Für \(me.email) gibt es keinen Zugang zu Vistoo. Bitte einen Admin um eine Einladung.")
                    }
                }
                Section {
                    Button("Erneut prüfen") { Task { await model.refreshAccess() } }
                    Button("Abmelden", role: .destructive) { Task { await model.signOut() } }
                }
            }
            .navigationTitle("Einladung")
            .inlineNavigationTitle()
            .onAppear { fullName = me.fullName ?? "" }
        }
    }

    private func accept(_ id: String) async {
        busy = true
        defer { busy = false }
        if let failure = await model.acceptInvitation(id, fullName: fullName.trimmingCharacters(in: .whitespaces)) {
            error = failure.fieldErrors["fullName"] ?? failure.message
        }
    }
}
