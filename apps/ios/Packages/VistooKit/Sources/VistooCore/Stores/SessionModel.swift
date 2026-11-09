import Foundation
import Observation

/// Everything that belongs to ONE signed-in member. Created after sign-in,
/// discarded completely on sign-out or account switch — no data of a previous
/// user can survive in memory, subscriptions or downloaded files.
@MainActor
@Observable
public final class SessionModel {
    public let userId: String
    public let backend: Backend
    public private(set) var viewer: Viewer
    public private(set) var limits: Limits
    public let work: WorkStore
    public let chat: ChatStore
    public let team: TeamStore
    public let notifications: NotificationSettingsModel
    public let todos: TodoStore
    public let ideas: IdeaStore
    public let crm: CRMStore
    public let decisions: DecisionStore
    public let milestones: MilestoneStore

    @ObservationIgnored private var realtime: RealtimeHub?
    @ObservationIgnored private var lastResync = Date.distantPast

    init(bootstrap: Bootstrap, backend: Backend, auth: AuthService) {
        userId = bootstrap.viewer.userId
        viewer = bootstrap.viewer
        limits = bootstrap.limits
        self.backend = backend
        work = WorkStore(backend: backend, bootstrap: bootstrap)
        chat = ChatStore(backend: backend, viewer: bootstrap.viewer)
        team = TeamStore(backend: backend, viewer: bootstrap.viewer)
        notifications = NotificationSettingsModel(backend: backend)
        todos = TodoStore(backend: backend)
        ideas = IdeaStore(backend: backend)
        crm = CRMStore(backend: backend)
        decisions = DecisionStore(backend: backend)
        milestones = MilestoneStore(backend: backend)
        realtime = RealtimeHub(auth: auth) { [weak self] event in
            self?.handle(event)
        }
    }

    public var isAdmin: Bool { viewer.role == .admin }

    /// Initial load + realtime.
    func start() async {
        await connectRealtime()
        async let a: Void = work.reload()
        async let b: Void = chat.reload()
        async let c: Void = notifications.load()
        async let d: Void = todos.reload()
        _ = await (a, b, c, d)
        lastResync = .now
    }

    /// Registers this device for pushes to this member (idempotent).
    func registerDevice(_ token: String) async {
        _ = try? await backend.send(API.registerDevice(token: token, body: RegisterDeviceRequest(environment: PushCenter.environment)))
    }

    func connectRealtime() async {
        await realtime?.start(workspaceId: viewer.workspaceId, userId: userId)
    }

    /// App went to the background: no permanent connection is assumed.
    func suspend() async {
        await realtime?.stop()
    }

    /// Back in the foreground or online again: reconnect and reload what may have been missed.
    func resume() async {
        await connectRealtime()
        await resync()
    }

    func resync() async {
        lastResync = .now
        async let a: Void = work.reload()
        async let b: Void = chat.resync()
        async let c: Void = refreshViewer()
        async let d: Void = todos.reload()
        async let e: Void = reloadOpenedAreas()
        _ = await (a, b, c, d, e)
    }

    /// Areas without realtime: reload the ones already opened in this session.
    private func reloadOpenedAreas() async {
        if ideas.state != .idle { await ideas.reload() }
        if crm.state != .idle { await crm.reload() }
        if decisions.state != .idle { await decisions.reload() }
        if milestones.state != .idle { await milestones.reload() }
    }

    private func refreshViewer() async {
        guard let bootstrap = try? await backend.send(API.getBootstrap()) else { return }
        viewer = bootstrap.viewer
        limits = bootstrap.limits
        work.apply(bootstrap)
    }

    /// The conversation on screen gets its own message subscription.
    public func watchConversation(_ id: String?) {
        PushCenter.shared.visibleConversationId = id
        if let id { PushCenter.shared.clearDelivered(threadId: id) }
        Task { await realtime?.watchConversation(id) }
    }

    func stop() async {
        await realtime?.stop()
        realtime = nil
        chat.reset()
        todos.reset()
        ideas.reset()
        crm.reset()
        decisions.reset()
        milestones.reset()
    }

    private func handle(_ event: RealtimeHub.Event) {
        switch event {
        case .taskUpserted(let task): work.merge(task)
        case .taskDeleted(let id): work.removeTask(id)
        case .projectsChanged: Task { await work.reloadProjects() }
        case .membersChanged: Task { await refreshViewer(); await team.reload() }
        case .conversationsChanged: chat.reloadSoon()
        case .messageChanged(let conversationId, let messageId):
            Task { await chat.messageChanged(conversationId: conversationId, messageId: messageId) }
            chat.reloadSoon()
        case .resyncNeeded:
            // Avoid storms when the socket flaps.
            guard Date.now.timeIntervalSince(lastResync) > 2 else { return }
            Task { await resync() }
        }
    }
}
