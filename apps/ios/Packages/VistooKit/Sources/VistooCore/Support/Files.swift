import Foundation

/// Direct upload to the signed Supabase Storage URL (bytes never pass through the API server).
enum Uploader {
    static func put(_ data: Data, to signedUrl: String, contentType: String) async throws {
        guard let url = URL(string: signedUrl) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        do {
            let (_, response) = try await APIClient.makeSession().upload(for: request, from: data)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw APIError(kind: .interrupted, message: "Der Upload ist fehlgeschlagen. Bitte versuche es erneut.")
            }
        } catch let error as URLError {
            throw APIError.from(urlError: error)
        }
    }
}

/// Downloaded attachments live in the temporary directory only:
/// opened on explicit request, removed on sign-out and after 24 hours.
public enum TemporaryFiles {
    static var root: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("VistooAttachments", isDirectory: true)
    }

    private static func folder(_ attachmentId: String) -> URL {
        root.appendingPathComponent(attachmentId, isDirectory: true)
    }

    /// File names come from users: keep them, but never let them escape the folder.
    private static func safeName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? "Datei" : cleaned
    }

    static func cachedFile(attachmentId: String, fileName: String) -> URL? {
        let url = folder(attachmentId).appendingPathComponent(safeName(fileName))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func download(_ signedUrl: String, attachmentId: String, fileName: String) async throws(APIError) -> URL {
        guard let url = URL(string: signedUrl) else { throw APIError.invalidResponse }
        do {
            let (tmp, response) = try await APIClient.makeSession().download(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw APIError(kind: .server(.notFound), message: "Die Datei konnte nicht geladen werden.")
            }
            let dir = folder(attachmentId)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let target = dir.appendingPathComponent(safeName(fileName))
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: tmp, to: target)
            return target
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.from(urlError: error)
        } catch {
            throw APIError(kind: .interrupted, message: "Die Datei konnte nicht gespeichert werden.")
        }
    }

    /// Removes all downloaded files (sign-out / account switch).
    public static func purgeAll() {
        try? FileManager.default.removeItem(at: root)
    }

    /// Removes downloads older than `age` (app launch).
    public static func purge(olderThan age: TimeInterval = 24 * 3600) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-age)
        for item in items {
            let modified = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if modified < limit { try? fm.removeItem(at: item) }
        }
    }
}
