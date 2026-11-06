import XCTest

/// Tapping a delivered push opens the right place. Needs pushes injected from
/// outside (`xcrun simctl push … msg.apns / task.apns`) while the test waits;
/// skipped unless VISTOO_PUSH_TEST=1 is set for the test run.
@MainActor
final class NotificationTapTests: XCTestCase {
    private var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    private func tapBanner(containing text: String) -> Bool {
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        guard banner.waitForExistence(timeout: 60) else { return false }
        banner.tap()
        return true
    }

    func testTapOpensConversationAndTask() throws {
        guard ProcessInfo.processInfo.environment["VISTOO_PUSH_TEST"] == "1" ||
              FileManager.default.fileExists(atPath: "/tmp/vistoo-push-test") else {
            throw XCTSkip("Push injection not active.")
        }
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Aufgaben"].waitForExistence(timeout: 20))
        XCUIDevice.shared.press(.home)

        XCTAssertTrue(tapBanner(containing: "Lena Hoffmann"), "message banner not shown")
        XCTAssertTrue(app.staticTexts["Hi Jonas, hast du kurz Zeit für das Release?"].waitForExistence(timeout: 15),
                      "tap did not open the conversation")

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(tapBanner(containing: "Neue Aufgabe für dich"), "task banner not shown")
        XCTAssertTrue(app.navigationBars["Aufgabe"].waitForExistence(timeout: 15), "tap did not open the task")
        let title = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ OR value == %@", "Release-Notes schreiben", "Release-Notes schreiben"))
            .firstMatch
        XCTAssertTrue(title.exists, "wrong task opened")
    }
}
