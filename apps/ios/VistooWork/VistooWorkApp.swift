import SwiftUI
import UIKit
import VistooCore
import VistooUI

/// Thin app target: configuration from Info.plist, everything else in VistooKit.
@main
struct VistooWorkApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel(configuration: AppConfiguration.fromBundle())

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
        }
    }
}

/// Only for what SwiftUI has no API for: the APNs device token.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MainActor.assumeIsolated { PushCenter.shared.activate() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { PushCenter.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // Simulator without push support or missing entitlement: the app works without pushes.
        print("[push] registration failed: \(error.localizedDescription)")
    }
}
