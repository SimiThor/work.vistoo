import Foundation
import Network
import Observation

/// Connectivity state for the offline banner and "back online → resync".
@MainActor
@Observable
public final class NetworkMonitor {
    public private(set) var isOnline = true
    /// Incremented whenever the connection comes back (observe to resync).
    public private(set) var reconnects = 0

    private let monitor = NWPathMonitor()

    public init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                if online, !self.isOnline { self.reconnects += 1 }
                self.isOnline = online
            }
        }
        monitor.start(queue: DispatchQueue(label: "work.vistoo.network"))
    }

    deinit {
        monitor.cancel()
    }
}
