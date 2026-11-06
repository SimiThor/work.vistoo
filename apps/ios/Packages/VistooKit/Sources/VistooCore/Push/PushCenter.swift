import Foundation
import Observation
@preconcurrency import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

/// System side of push notifications: permission, APNs device token,
/// foreground presentation and taps. The server decides who gets what
/// (packages/backend/src/services/notifications.ts).
@MainActor
@Observable
public final class PushCenter: NSObject {
    public static let shared = PushCenter()

    /// Hex APNs token once iOS delivered it.
    public private(set) var deviceToken: String?
    public private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// Destination of a tapped notification, consumed by the app model.
    public var tappedLink: DeepLink?
    /// Conversation on screen: its messages do not show a banner.
    public var visibleConversationId: String?

    /// Xcode builds talk to the APNs sandbox, TestFlight/App Store builds to production.
    public static var environment: RegisterDeviceRequest.Environment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }

    /// Call once at launch (sets the notification delegate).
    public func activate() {
        UNUserNotificationCenter.current().delegate = self
        Task { await refreshAuthorization() }
    }

    public func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if authorization == .authorized || authorization == .provisional { registerWithAPNs() }
    }

    /// Asks once; afterwards the user changes it in the iOS settings.
    @discardableResult
    public func requestAuthorization() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        return granted
    }

    private func registerWithAPNs() {
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }

    /// From the app delegate.
    public func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
    }

    public func setBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(count) { _ in }
    }

    /// Removes delivered notifications of a conversation once it is read.
    public func clearDelivered(threadId: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { notes in
            let ids = notes.filter { $0.request.content.threadIdentifier == threadId }.map(\.request.identifier)
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    nonisolated static func link(from userInfo: [AnyHashable: Any]) -> DeepLink? {
        guard let info = userInfo["vistoo"] as? [String: Any] else { return nil }
        if let id = info["conversationId"] as? String { return .conversation(id: id.lowercased()) }
        if let id = info["taskId"] as? String { return .task(id: id.lowercased(), projectId: nil) }
        return nil
    }
}

// Completion-handler variants on purpose: UIKit requires the handlers to be
// called on the main thread. The `async` variants complete on a background
// executor and crash the app when a notification is tapped.
extension PushCenter: UNUserNotificationCenterDelegate {
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        let thread = notification.request.content.threadIdentifier
        DispatchQueue.main.async {
            let visible = MainActor.assumeIsolated { self.visibleConversationId }
            completionHandler(thread == visible ? [] : [.banner, .list, .sound])
        }
    }

    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let link = Self.link(from: response.notification.request.content.userInfo)
        DispatchQueue.main.async {
            if let link { MainActor.assumeIsolated { self.tappedLink = link } }
            completionHandler()
        }
    }
}
