import XCTest

/// Smoke test: the app starts and shows either the sign-in or a clear status
/// screen (e.g. server not reachable). Full flows need a running backend and
/// are listed in docs/features/verification.md.
final class LaunchTests: XCTestCase {
    func testLaunchShowsSignInOrStatus() {
        let app = XCUIApplication()
        app.launch()
        let signIn = app.staticTexts["Anmelden"]
        let unreachable = app.staticTexts["Vistoo ist nicht erreichbar"]
        let signedIn = app.tabBars.buttons["Aufgaben"]
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline, !signIn.exists, !unreachable.exists, !signedIn.exists { _ = signIn.waitForExistence(timeout: 1) }
        XCTAssertTrue(signIn.exists || unreachable.exists || signedIn.exists)
    }

    func testSignInFormIsAccessible() throws {
        let app = XCUIApplication()
        app.launch()
        let field = app.textFields["E-Mail-Adresse"]
        guard field.waitForExistence(timeout: 20) else { throw XCTSkip("Server not reachable from the test environment.") }
        XCTAssertTrue(app.buttons["Code anfordern"].exists)
    }
}

/// Full sign-in against the local stack: e-mail → code from Mailpit → workspace tabs.
/// Skipped when the local stack (Mailpit) is not reachable.
final class LocalSignInTests: XCTestCase {
    private let email = ProcessInfo.processInfo.environment["VISTOO_TEST_EMAIL"] ?? "jonas@vistoo.test"

    private func newestCode(after start: Date) throws -> String? {
        let q = "to:\(email)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!
        guard let data = try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/search?query=\(q)")!),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let first = (json["messages"] as? [[String: Any]])?.first,
              let created = first["Created"] as? String,
              let date = ISO8601DateFormatter.withFractions.date(from: created), date >= start.addingTimeInterval(-1),
              let id = first["ID"] as? String,
              let msgData = try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/message/\(id)")!),
              let msg = try JSONSerialization.jsonObject(with: msgData) as? [String: Any],
              let text = msg["Text"] as? String,
              let range = text.range(of: #"\b\d{6}\b"#, options: .regularExpression)
        else { return nil }
        return String(text[range])
    }

    func testSignInWithCodeFromMailpit() throws {
        guard (try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/info")!)) != nil else {
            throw XCTSkip("Local Mailpit not reachable.")
        }
        let app = XCUIApplication()
        app.launch()
        if app.tabBars.buttons["Einstellungen"].waitForExistence(timeout: 5) {
            app.tabBars.buttons["Einstellungen"].tap()
            app.buttons["Abmelden"].firstMatch.tap()
            app.buttons["Abmelden"].firstMatch.tap()
        }
        let field = app.textFields["E-Mail-Adresse"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText(email)
        let start = Date()
        app.buttons["Code anfordern"].tap()
        var code: String?
        for _ in 0..<30 where code == nil {
            code = try newestCode(after: start)
            if code == nil { Thread.sleep(forTimeInterval: 0.5) }
        }
        let codeField = app.textFields["6-stelliger Code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 5))
        codeField.tap()
        codeField.typeText(try XCTUnwrap(code))
        // First sign-in asks for notification permission.
        addUIInterruptionMonitor(withDescription: "Mitteilungen") { alert in
            let allow = alert.buttons["Erlauben"].exists ? alert.buttons["Erlauben"] : alert.buttons["Allow"]
            if allow.exists { allow.tap(); return true }
            return false
        }
        XCTAssertTrue(app.tabBars.buttons["Aufgaben"].waitForExistence(timeout: 20), "Workspace did not open after sign-in")
        app.tabBars.buttons["Einstellungen"].tap()
        XCTAssertTrue(app.switches["Neue Aufgaben für mich"].waitForExistence(timeout: 10), "Notification settings missing")
        XCTAssertFalse(app.staticTexts["Der Code ist ungültig oder abgelaufen."].exists)
    }
}

private extension ISO8601DateFormatter {
    nonisolated(unsafe) static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
