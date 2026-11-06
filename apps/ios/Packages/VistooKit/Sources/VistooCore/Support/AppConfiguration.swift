import Foundation

/// Build-time configuration of the app (from Info.plist, set per build
/// configuration via apps/ios/Config/*.xcconfig).
///
/// Only the server URL is configured. Supabase URL and publishable key come
/// from that server's `/api/v1/meta`, so the app always uses exactly the
/// Supabase project of the backend it talks to (no mixed environments).
public struct AppConfiguration: Sendable, Equatable {
    /// Web origin, e.g. https://workvistoo.vercel.app (also used for share links).
    public let serverURL: URL
    public let build: Int
    public let version: String

    public init(serverURL: URL, build: Int, version: String) {
        self.serverURL = serverURL
        self.build = build
        self.version = version
    }

    public var apiBaseURL: URL { serverURL.appendingPathComponent("api/v1") }

    /// Reads `VistooServerURL`, `CFBundleVersion`, `CFBundleShortVersionString`.
    public static func fromBundle(_ bundle: Bundle = .main) -> AppConfiguration? {
        guard let raw = bundle.object(forInfoDictionaryKey: "VistooServerURL") as? String,
              let url = URL(string: raw.trimmingCharacters(in: .whitespaces)),
              url.scheme == "https" || url.host == "localhost" || url.host == "127.0.0.1"
        else { return nil }
        let build = Int(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return AppConfiguration(serverURL: url, build: build, version: version)
    }

    /// Shareable web link of a task (same format the web app copies).
    public func taskLink(taskId: String, projectId: String? = nil) -> URL {
        var c = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        c.path = projectId.map { "/projects/\($0)" } ?? "/tasks"
        c.queryItems = [URLQueryItem(name: "task", value: taskId)]
        return c.url!
    }

    public func conversationLink(_ conversationId: String) -> URL {
        serverURL.appendingPathComponent("chat/\(conversationId)")
    }
}

/// Non-sensitive cache of the last `/meta` answer, so the app can start
/// offline. Keyed by server URL: switching environments never mixes data.
public enum MetaCache {
    private static func key(_ config: AppConfiguration) -> String { "vistoo.meta.\(config.serverURL.absoluteString)" }

    public static func load(_ config: AppConfiguration) -> Meta? {
        guard let data = UserDefaults.standard.data(forKey: key(config)) else { return nil }
        return try? ISO8601.decoder().decode(Meta.self, from: data)
    }

    public static func store(_ meta: Meta, _ config: AppConfiguration) {
        if let data = try? ISO8601.encoder().encode(meta) { UserDefaults.standard.set(data, forKey: key(config)) }
    }
}
