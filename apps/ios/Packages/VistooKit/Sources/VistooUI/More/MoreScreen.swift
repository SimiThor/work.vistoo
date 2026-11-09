import SwiftUI
import VistooCore

/// "Mehr": everything that is not needed every few minutes, one tap away.
/// Own to-dos live on the start tab; here they are listed again for completeness.
struct MoreScreen: View {
    let session: SessionModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            Section {
                row(.todos, "Meine To-dos", "checklist.checked", detail: openTodos)
            } footer: {
                Text("Private Checkliste – nur du siehst sie.")
            }
            Section("Team") {
                row(.milestones, "Meilensteine", "flag", detail: count(session.milestones.open.count, loaded: session.milestones.state == .loaded))
                row(.ideas, "Ideen", "lightbulb", detail: count(session.ideas.ideas.filter { $0.status == .new }.count, loaded: session.ideas.state == .loaded, suffix: "neu"))
                row(.decisions, "Entscheidungen", "checkmark.seal", detail: nil)
                row(.crm, "CRM", "building.2", detail: overdueFollowUps)
            }
            if let link = session.viewer.meetingUrl, let url = URL(string: link) {
                Section {
                    Button { openURL(url) } label: {
                        Label("Besprechung beitreten", systemImage: "headphones")
                    }
                } footer: {
                    Text("Öffnet den Sprachkanal des Teams.")
                }
            }
        }
        .groupedListStyle()
        .navigationTitle("Mehr")
        .toolbar {
            ToolbarItem(placement: .leading) { AccountButton(session: session) }
        }
    }

    private var openTodos: String? {
        let n = session.todos.open.count
        return n > 0 ? "\(n)" : nil
    }

    private var overdueFollowUps: String? {
        guard session.crm.state == .loaded else { return nil }
        let n = session.crm.attractions.filter { $0.followUpOverdue() }.count
        return n > 0 ? "\(n) überfällig" : nil
    }

    private func count(_ n: Int, loaded: Bool, suffix: String? = nil) -> String? {
        guard loaded, n > 0 else { return nil }
        return suffix.map { "\(n) \($0)" } ?? "\(n)"
    }

    private func row(_ route: AreaRoute, _ title: String, _ icon: String, detail: String?) -> some View {
        NavigationLink(value: route) {
            LabeledContent {
                if let detail { Text(detail).monospacedDigit() }
            } label: {
                Label(title, systemImage: icon)
            }
        }
    }
}
