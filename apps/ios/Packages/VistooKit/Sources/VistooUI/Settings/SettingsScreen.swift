import SwiftUI
import UserNotifications
import VistooCore

/// Settings sheet (behind the avatar): own account, notifications, team management,
/// chat storage (admins), sign-out. Deliberately out of the tab bar: rarely needed.
struct SettingsScreen: View {
    let app: AppModel
    let session: SessionModel

    @State private var editingName = false
    @State private var nameText = ""
    @State private var confirmSignOut = false
    @State private var failure: ActionFailure?
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private var push: PushCenter { PushCenter.shared }
    private var notifications: NotificationSettingsModel { session.notifications }

    var body: some View {
        List {
            accountSection
            notificationSection
            Section("Team") {
                NavigationLink {
                    TeamScreen(session: session)
                } label: {
                    LabeledContent {
                        Text("\(session.work.members.count)")
                    } label: {
                        Label(session.isAdmin ? "Mitglieder & Einladungen" : "Mitglieder", systemImage: "person.2")
                    }
                }
            }
            if let usage = session.chat.storageUsage {
                Section("Chat") {
                    StorageUsageRow(usage: usage)
                }
            }
            Section {
                Button("Abmelden", role: .destructive) { confirmSignOut = true }
            } footer: {
                if let c = app.configuration {
                    Text("Vistoo Work · Version \(c.version) (\(c.build))").frame(maxWidth: .infinity).padding(.top, Tokens.Spacing.lg)
                }
            }
        }
        .groupedListStyle()
        .navigationTitle("Einstellungen")
        .inlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
        }
        .task {
            await push.refreshAuthorization()
            if notifications.settings == nil { await notifications.load() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Returning from the iOS settings app: permission may have changed.
            if phase == .active { Task { await push.refreshAuthorization() } }
        }
        .alert("Dein Name", isPresented: $editingName) {
            TextField("Vor- und Nachname", text: $nameText)
            Button("Sichern") {
                Task {
                    do { try await session.team.updateOwnName(nameText.trimmingCharacters(in: .whitespaces)) } catch {
                        failure = ActionFailure("Name nicht gespeichert", error)
                    }
                }
            }
            Button("Abbrechen", role: .cancel) {}
        }
        .confirmationDialog("Abmelden?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Abmelden", role: .destructive) { Task { await app.signOut() } }
        } message: {
            Text("Lokale Daten dieser Anmeldung werden von diesem iPhone entfernt. Mitteilungen für dieses Konto kommen hier nicht mehr an.")
        }
        .failureAlert($failure)
    }

    private var accountSection: some View {
        Section("Mein Konto") {
            HStack(spacing: Tokens.Spacing.md) {
                Avatar(fullName: session.viewer.fullName, email: session.viewer.email, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.viewer.displayName).font(.headline)
                    Text(session.viewer.email).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                    Text("\(session.viewer.role.label) · \(session.viewer.workspaceName)")
                        .font(.caption)
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                }
            }
            .accessibilityElement(children: .combine)
            Button("Namen ändern") {
                nameText = session.viewer.fullName ?? ""
                editingName = true
            }
        }
    }

    @ViewBuilder private var notificationSection: some View {
        Section {
            switch push.authorization {
            case .denied:
                Label("Mitteilungen sind in den iOS-Einstellungen ausgeschaltet.", systemImage: "bell.slash")
                    .foregroundStyle(Tokens.Palette.mutedForeground)
                Button("iOS-Einstellungen öffnen") { openSystemSettings() }
            case .notDetermined:
                Button {
                    Task { await push.requestAuthorization() }
                } label: {
                    Label("Mitteilungen erlauben", systemImage: "bell.badge")
                }
            default:
                EmptyView()
            }
            if let s = notifications.settings {
                toggle("Direktnachrichten", systemImage: "person.bubble", isOn: s.directMessages) {
                    UpdateNotificationSettingsRequest(directMessages: $0)
                }
                toggle("Nachrichten in Kanälen", systemImage: "number", isOn: s.channelMessages) {
                    UpdateNotificationSettingsRequest(channelMessages: $0)
                }
                toggle("Neue Aufgaben für mich", systemImage: "checklist", isOn: s.taskAssignments) {
                    UpdateNotificationSettingsRequest(taskAssignments: $0)
                }
            } else {
                ProgressView()
            }
        } header: {
            Text("Mitteilungen")
        } footer: {
            Text("Du bekommst eine Mitteilung, wenn dir jemand schreibt oder dir eine Aufgabe zuweist – auch wenn die App geschlossen ist. Eigene Aktionen lösen keine Mitteilung aus. Die Auswahl gilt für alle deine Geräte.")
        }
    }

    private func toggle(
        _ title: String,
        systemImage: String,
        isOn: Bool,
        patch: @escaping (Bool) -> UpdateNotificationSettingsRequest
    ) -> some View {
        Toggle(isOn: Binding(
            get: { isOn },
            set: { value in
                Task {
                    do { try await notifications.update(patch(value)) } catch {
                        failure = ActionFailure("Nicht gespeichert", error)
                    }
                }
            }
        )) {
            Label(title, systemImage: systemImage)
        }
        .disabled(push.authorization == .denied)
    }

    private func openSystemSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
        #endif
    }
}
