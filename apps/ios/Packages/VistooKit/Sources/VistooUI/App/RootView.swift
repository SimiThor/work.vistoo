import SwiftUI
import VistooCore

/// Entry view of the app target. Owns lifecycle wiring: scene phase, links, connectivity.
public struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        content
            .tint(Tokens.Palette.accentBlue)
            // Light appearance only, like the web (tokens define no dark palette yet).
            .preferredColorScheme(.light)
            .task { await model.start() }
            .onOpenURL { url in Task { await model.open(url) } }
            .onChange(of: scenePhase) { _, phase in
                Task { await model.scenePhaseChanged(isActive: phase == .active) }
            }
            .onChange(of: model.network.reconnects) { _, _ in
                Task { await model.networkChanged() }
            }
            .onChange(of: PushCenter.shared.deviceToken) { _, _ in
                Task { await model.pushTokenChanged() }
            }
            .onChange(of: PushCenter.shared.tappedLink) { _, _ in
                model.notificationTapped()
            }
            .animation(.default, value: model.phase)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .launching:
            LaunchView()
        case .misconfigured(let message):
            StatusScreen(
                systemImage: "exclamationmark.icloud",
                title: "Vistoo ist nicht erreichbar",
                message: message,
                actionTitle: "Erneut versuchen"
            ) { await model.retryStart() }
        case .outdated:
            StatusScreen(
                systemImage: "arrow.down.app",
                title: "Update erforderlich",
                message: "Diese Version der Vistoo-App wird nicht mehr unterstützt. Bitte aktualisiere die App.",
                actionTitle: nil
            ) {}
        case .signedOut:
            SignInView(model: model)
        case .onboarding(let me):
            OnboardingView(model: model, me: me)
        case .ready:
            if let session = model.session {
                MainTabView(app: model, session: session)
                    .id(session.userId) // a different account never reuses view state
            } else {
                LaunchView()
            }
        }
    }
}

struct LaunchView: View {
    var body: some View {
        VStack(spacing: Tokens.Spacing.xl) {
            BrandMark()
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tokens.Palette.surfaceSubtle)
    }
}

struct StatusScreen: View {
    let systemImage: String
    let title: String
    let message: String
    let actionTitle: String?
    let action: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        } actions: {
            if let actionTitle {
                Button(actionTitle) { Task { await action() } }
                    .buttonStyle(.borderedProminent)
            }
        }
        .background(Tokens.Palette.surfaceSubtle)
    }
}
