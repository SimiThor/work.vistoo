import XCTest

/// Walks through the areas beyond tasks/chat against the local stack:
/// own to-do on the start tab, then ideas, decisions, CRM and milestones via "Mehr".
/// Skipped when the local stack (Mailpit) is not reachable.
final class WorkspaceAreasTests: XCTestCase {
    private let email = ProcessInfo.processInfo.environment["VISTOO_TEST_EMAIL"] ?? "jonas@vistoo.test"
    private let suffix = String(UUID().uuidString.prefix(4))

    func testAllAreasAreReachableAndUsable() throws {
        guard (try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/info")!)) != nil else {
            throw XCTSkip("Local Mailpit not reachable.")
        }
        let app = XCUIApplication()
        app.launch()
        try signInIfNeeded(app)

        // Own to-dos: right on the start tab, one field away.
        app.tabBars.buttons["Für mich"].tap()
        let todoField = app.textFields["Neues To-do"]
        XCTAssertTrue(todoField.waitForExistence(timeout: 10), "Quick add for to-dos missing on the start tab")
        todoField.tap()
        todoField.typeText("To-do \(suffix)\n")
        XCTAssertTrue(element(app, containing: "To-do \(suffix)").waitForExistence(timeout: 10), "To-do not shown after saving")
        snapshot(app, "1 Für mich mit To-dos")

        // Everything else: tab "Mehr".
        app.tabBars.buttons["Mehr"].tap()
        XCTAssertTrue(app.staticTexts["Ideen"].waitForExistence(timeout: 5))
        snapshot(app, "2 Mehr")

        create(app, area: "Ideen", addButton: "Neue Idee", text: "Idee \(suffix)", confirm: "Erstellen")
        XCTAssertTrue(app.staticTexts["Idee \(suffix)"].waitForExistence(timeout: 10), "Idea not listed")
        snapshot(app, "3 Ideen")
        back(app)

        create(app, area: "Entscheidungen", addButton: "Neu", text: "Entscheidung \(suffix)", confirm: "Erstellen")
        // After creating, the detail opens directly.
        XCTAssertTrue(app.navigationBars["Entscheidung"].waitForExistence(timeout: 10), "Decision detail did not open")
        snapshot(app, "4 Entscheidung Detail")
        back(app)
        back(app)

        create(app, area: "CRM", addButton: "Neue Attraktion", text: "Zoo \(suffix)", confirm: "Erstellen")
        XCTAssertTrue(app.staticTexts["Zoo \(suffix)"].waitForExistence(timeout: 10), "CRM entry not listed")
        snapshot(app, "5 CRM")
        app.staticTexts["Zoo \(suffix)"].tap()
        XCTAssertTrue(app.buttons["Aktivität hinzufügen"].waitForExistence(timeout: 10), "CRM detail missing timeline")
        snapshot(app, "6 CRM Detail")
        back(app)
        back(app)

        create(app, area: "Meilensteine", addButton: "Neuer Meilenstein", text: "Meilenstein \(suffix)", confirm: "Erstellen")
        XCTAssertTrue(app.staticTexts["Meilenstein \(suffix)"].waitForExistence(timeout: 10), "Milestone not listed")
        snapshot(app, "7 Meilensteine")
    }

    // MARK: Helpers

    private func create(_ app: XCUIApplication, area: String, addButton: String, text: String, confirm: String) {
        app.staticTexts[area].firstMatch.tap()
        let add = app.buttons[addButton].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "\(area): add button missing")
        add.tap()
        let field = firstInput(app)
        XCTAssertTrue(field.waitForExistence(timeout: 5), "\(area): no input field")
        field.tap()
        field.typeText(text)
        app.buttons[confirm].firstMatch.tap()
    }

    /// Rows combine their texts into one accessibility element.
    private func element(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func firstInput(_ app: XCUIApplication) -> XCUIElement {
        let textView = app.textViews.firstMatch
        return textView.waitForExistence(timeout: 2) ? textView : app.textFields.firstMatch
    }

    private func back(_ app: XCUIApplication) {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func signInIfNeeded(_ app: XCUIApplication) throws {
        if app.tabBars.buttons["Für mich"].waitForExistence(timeout: 8) { return }
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
        let codeField = app.textFields["Code aus der E-Mail"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 5))
        codeField.tap()
        codeField.typeText(try XCTUnwrap(code))
        app.buttons["Anmelden"].tap()
        // First sign-in asks for notification permission (a system alert owned by SpringBoard).
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline, !app.tabBars.buttons["Für mich"].exists {
            for title in ["Erlauben", "Allow"] where springboard.alerts.buttons[title].exists {
                springboard.alerts.buttons[title].tap()
            }
            _ = app.tabBars.buttons["Für mich"].waitForExistence(timeout: 1)
        }
        XCTAssertTrue(app.tabBars.buttons["Für mich"].waitForExistence(timeout: 5), "Workspace did not open after sign-in")
    }

    private func newestCode(after start: Date) throws -> String? {
        let q = "to:\(email)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!
        guard let data = try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/search?query=\(q)")!),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let first = (json["messages"] as? [[String: Any]])?.first,
              let created = first["Created"] as? String,
              let date = Self.iso.date(from: created), date >= start.addingTimeInterval(-1),
              let id = first["ID"] as? String,
              let msgData = try? Data(contentsOf: URL(string: "http://127.0.0.1:54324/api/v1/message/\(id)")!),
              let msg = try JSONSerialization.jsonObject(with: msgData) as? [String: Any],
              let text = msg["Text"] as? String,
              let range = text.range(of: #"\b\d{6,10}\b"#, options: .regularExpression)
        else { return nil }
        return String(text[range])
    }

    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
