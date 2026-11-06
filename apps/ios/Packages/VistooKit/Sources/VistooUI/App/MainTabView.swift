import SwiftUI
import VistooCore

/// Navigation state of the signed-in app (tabs + one stack per tab).
@MainActor
@Observable
final class Navigator {
    enum TabID: Hashable { case tasks, projects, chat, settings }

    var tab: TabID = .tasks
    var projectsPath: [ProjectRoute] = []
    var chatPath: [ConversationRoute] = []
    /// Task opened by link, shown as sheet above any tab.
    var linkedTask: LinkedTask?

    struct LinkedTask: Identifiable, Equatable { let id: String }

    func open(_ link: DeepLink) {
        switch link {
        case .task(let id, _):
            linkedTask = LinkedTask(id: id)
        case .project(let id):
            tab = .projects
            projectsPath = [ProjectRoute(id: id)]
        case .conversation(let id):
            tab = .chat
            chatPath = [ConversationRoute(id: id)]
        }
    }
}

struct ProjectRoute: Hashable { let id: String }
struct ConversationRoute: Hashable { let id: String }

/// Main areas: Aufgaben, Projekte, Chat — plus Einstellungen (account,
/// notifications, team management), the rarely used functions of the web.
struct MainTabView: View {
    let app: AppModel
    let session: SessionModel
    @State private var navigator = Navigator()

    var body: some View {
        VStack(spacing: 0) {
            if !app.network.isOnline { OfflineBanner() }
            TabView(selection: $navigator.tab) {
                Tab("Aufgaben", systemImage: "checklist", value: Navigator.TabID.tasks) {
                    NavigationStack {
                        WorkScreen(session: session, scope: .all, title: "Alle Aufgaben")
                    }
                }
                Tab("Projekte", systemImage: "folder", value: Navigator.TabID.projects) {
                    NavigationStack(path: $navigator.projectsPath) {
                        ProjectsScreen(session: session)
                            .navigationDestination(for: ProjectRoute.self) { route in
                                ProjectDetailScreen(session: session, projectId: route.id)
                            }
                    }
                }
                Tab("Chat", systemImage: "bubble.left.and.bubble.right", value: Navigator.TabID.chat) {
                    NavigationStack(path: $navigator.chatPath) {
                        ChatListScreen(session: session, path: $navigator.chatPath)
                            .navigationDestination(for: ConversationRoute.self) { route in
                                ConversationScreen(session: session, conversationId: route.id)
                            }
                    }
                }
                .badge(session.chat.unreadCount)
                Tab("Einstellungen", systemImage: "gearshape", value: Navigator.TabID.settings) {
                    NavigationStack {
                        SettingsScreen(app: app, session: session)
                    }
                }
            }
        }
        .environment(navigator)
        .sheet(item: $navigator.linkedTask) { linked in
            LinkedTaskSheet(session: session, taskId: linked.id)
        }
        .onChange(of: session.chat.unreadCount, initial: true) { _, count in
            PushCenter.shared.setBadge(count)
        }
        .onChange(of: app.pendingLink, initial: true) { _, link in
            guard let link else { return }
            navigator.open(link)
            app.pendingLink = nil
        }
    }
}

/// Resolves a task by id (also tasks of archived projects) and shows its details.
struct LinkedTaskSheet: View {
    let session: SessionModel
    let taskId: String
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Group {
                if let task = session.work.task(taskId) {
                    TaskDetailView(session: session, taskId: task.id)
                } else if let failure {
                    ContentUnavailableView("Aufgabe nicht gefunden", systemImage: "questionmark.circle", description: Text(failure))
                } else {
                    LoadingView()
                }
            }
        }
        .task {
            if session.work.task(taskId) == nil {
                do { _ = try await session.work.fetchTask(taskId) } catch { failure = (error as? APIError)?.message ?? "Die Aufgabe konnte nicht geladen werden." }
            }
        }
    }
}
