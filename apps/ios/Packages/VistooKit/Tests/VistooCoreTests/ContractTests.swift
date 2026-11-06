import Foundation
import Supabase
import Testing
@testable import VistooCore

/// Repository root, located from this file (tests read shared fixtures in place).
private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // VistooCoreTests
    .deletingLastPathComponent() // Tests
    .deletingLastPathComponent() // VistooKit
    .deletingLastPathComponent() // Packages
    .deletingLastPathComponent() // ios
    .deletingLastPathComponent() // apps
    .deletingLastPathComponent()

private func json(_ object: some Encodable) throws -> [String: Any] {
    let data = try ISO8601.encoder().encode(object)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

@Suite("Shared task filter semantics (packages/contracts/fixtures/task-filters.json)")
struct TaskFilterConformanceTests {
    struct Fixture: Decodable {
        struct FixtureTask: Decodable {
            let id: String, title: String, projectId: String, groupId: String?, assigneeId: String?, status: String
        }
        struct Case: Decodable {
            struct Filters: Decodable {
                var q: String?, projects: [String]?, groups: [String]?, assignees: [String]?, statuses: [String]?
            }
            let name: String, filters: Filters, expected: [String]
        }
        let tasks: [FixtureTask]
        let cases: [Case]
    }

    static let fixture: Fixture = {
        let url = repoRoot.appendingPathComponent("packages/contracts/fixtures/task-filters.json")
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test(arguments: fixture.cases.map(\.name))
    func matchesTypeScript(_ name: String) {
        let c = Self.fixture.cases.first { $0.name == name }!
        let filters = TaskFilters(
            query: c.filters.q ?? "",
            projects: Set(c.filters.projects ?? []),
            groups: Set(c.filters.groups ?? []),
            assignees: Set(c.filters.assignees ?? []),
            statuses: Set((c.filters.statuses ?? []).map(TaskStatus.init(rawValue:)))
        )
        let result = Self.fixture.tasks.filter {
            filters.matches(
                title: $0.title, projectId: $0.projectId, groupId: $0.groupId,
                assigneeId: $0.assigneeId, status: TaskStatus(rawValue: $0.status)
            )
        }.map(\.id)
        #expect(result == c.expected, "\(name)")
    }
}

@Suite("Generated models")
struct GeneratedModelTests {
    @Test func unknownEnumValuesDecode() throws {
        let data = Data(#"["open","blocked","in_review"]"#.utf8)
        let statuses = try JSONDecoder().decode([TaskStatus].self, from: data)
        #expect(statuses == [.open, .unknown("blocked"), .inReview])
        #expect(TaskStatus.unknown("blocked").label == "blocked")
        #expect(TaskStatus.inProgress.label == "In Arbeit")
    }

    @Test func taskDecodesFromAPIJSON() throws {
        let raw = """
        {"id":"0b3b5f0e-6f2c-4f7a-9d55-1f7d8c1b2a10","projectId":"9f1c6a2e-3d4b-4c5d-8e6f-7a8b9c0d1e2f","groupId":null,
         "title":"Angebot","description":"","status":"in_progress","assigneeId":null,"startDate":"2026-11-09","endDate":null,
         "position":1024,"createdBy":"1f1c6a2e-3d4b-4c5d-8e6f-7a8b9c0d1e2f","createdAt":"2026-11-06T07:43:29.456Z",
         "updatedAt":"2026-11-06T07:43:29.456Z","version":3,"someFutureField":true}
        """
        let task = try ISO8601.decoder().decode(TaskItem.self, from: Data(raw.utf8))
        #expect(task.status == .inProgress)
        #expect(task.startDate?.iso == "2026-11-09")
        #expect(task.endDate == nil)
        #expect(task.version == 3)
    }

    @Test func partialUpdateDistinguishesUnsetNullAndValue() throws {
        let patch = UpdateTaskRequest.Patch(title: "Neu", groupId: .null, assigneeId: .value("u1"))
        let body = try json(UpdateTaskRequest(expectedVersion: 2, patch: patch))
        let p = body["patch"] as! [String: Any]
        #expect(p["title"] as? String == "Neu")
        #expect(p["groupId"] is NSNull)            // explicit null clears
        #expect(p["assigneeId"] as? String == "u1")
        #expect(p["startDate"] == nil)              // unset → omitted → unchanged
        #expect(p["status"] == nil)
    }

    @Test func requiredNullableFieldsAreSentAsNull() throws {
        let body = try json(SetTaskAssigneeRequest(assigneeId: nil))
        #expect(body.keys.contains("assigneeId"))
        #expect(body["assigneeId"] is NSNull)
        let move = try json(MoveTaskRequest(status: .done, afterId: nil, beforeId: "b"))
        #expect(move["afterId"] is NSNull)
        #expect(move["status"] as? String == "done")
    }

    @Test func fieldLimitsComeFromTheContract() {
        #expect(CreateTaskRequest.titleMaxLength == 300)
        #expect(SendMessageRequest.bodyMaxLength == 10_000)
    }

    @Test func errorEnvelopeDecodes() throws {
        let raw = #"{"error":{"code":"SOMETHING_NEW","message":"Hallo"}}"#
        let e = try ISO8601.decoder().decode(ErrorResponse.self, from: Data(raw.utf8))
        #expect(e.error.code == .unknown("SOMETHING_NEW"))
        #expect(e.error.message == "Hallo")
    }
}

@Suite("Dates")
struct DateTests {
    @Test func calendarDatesAreStrict() {
        #expect(CalendarDate("2026-02-29") == nil)
        #expect(CalendarDate("2028-02-29") != nil)
        #expect(CalendarDate("2026-1-01") == nil)
        #expect(CalendarDate("2026-11-06")?.iso == "2026-11-06")
    }

    @Test func calendarDateArithmetic() {
        let d = CalendarDate("2026-11-06")! // Friday
        #expect(d.weekdayIndex == 4)
        #expect(d.startOfWeek.iso == "2026-11-02")
        #expect(d.adding(days: 1).isWeekend)
        #expect(CalendarDate.durationDays(from: d, to: d) == 1)
        #expect(CalendarDate("2026-01-01")!.isoWeek == 1)
        #expect(CalendarDate("2026-12-31")!.isoWeek == 53)
    }

    @Test func calendarDayIgnoresTimeZones() {
        var auckland = Calendar(identifier: .gregorian)
        auckland.timeZone = TimeZone(identifier: "Pacific/Auckland")!
        let d = CalendarDate("2026-11-06")!
        #expect(CalendarDate(d.date(in: auckland), calendar: auckland) == d)
    }

    @Test func instantsFromAPIAndRealtimeAgree() {
        let api = ISO8601.parse("2026-11-06T07:43:29.456Z")!
        let realtime = ISO8601.parse("2026-11-06T08:43:29.456000+01:00")!
        let spaced = ISO8601.parse("2026-11-06 07:43:29.456+00")!
        #expect(abs(api.timeIntervalSince(realtime)) < 0.001)
        #expect(abs(api.timeIntervalSince(spaced)) < 0.001)
        #expect(ISO8601.parse("gestern") == nil)
    }
}

@Suite("Links and realtime payloads")
struct LinkTests {
    let server = URL(string: "https://workvistoo.vercel.app")!
    let id = "0b3b5f0e-6f2c-4f7a-9d55-1f7d8c1b2a10"

    @Test func parsesSharedWebLinks() {
        #expect(DeepLink(url: URL(string: "https://workvistoo.vercel.app/tasks?task=\(id.uppercased())")!, server: server)
            == .task(id: id, projectId: nil))
        #expect(DeepLink(url: URL(string: "https://workvistoo.vercel.app/chat/\(id)")!, server: server) == .conversation(id: id))
        #expect(DeepLink(url: URL(string: "https://workvistoo.vercel.app/projects/\(id)")!, server: server) == .project(id: id))
        #expect(DeepLink(url: URL(string: "https://evil.example/chat/\(id)")!, server: server) == nil)
        #expect(DeepLink(url: URL(string: "https://workvistoo.vercel.app/tasks?task=nope")!, server: server) == nil)
    }

    @Test func shareLinksMatchTheWebFormat() {
        let config = AppConfiguration(serverURL: server, build: 1, version: "1.0")
        #expect(config.taskLink(taskId: id).absoluteString == "https://workvistoo.vercel.app/tasks?task=\(id)")
        #expect(config.apiBaseURL.absoluteString == "https://workvistoo.vercel.app/api/v1")
    }

    @Test func realtimeTaskRowDecodes() {
        let row: [String: AnyJSON] = [
            "id": .string(id.uppercased()), "project_id": .string(id), "group_id": .null, "title": .string("A"),
            "description": .string(""), "status": .string("done"), "assignee_id": .null, "start_date": .string("2026-11-09"),
            "end_date": .string("2026-11-10"), "position": .integer(2048), "created_by": .string(id),
            "created_at": .string("2026-11-06T07:43:29.456789+00:00"), "updated_at": .string("2026-11-06T07:43:29+00:00"),
            "version": .integer(4),
        ]
        let task = TaskRow.decode(row)
        #expect(task?.id == id)
        #expect(task?.status == .done)
        #expect(task?.position == 2048)
        #expect(task?.endDate?.iso == "2026-11-10")
    }
}

@Suite("Upload pre-checks (server re-checks everything)")
struct UploadPrecheckTests {
    let limits = Limits(
        maxMessageLength: 10_000, messagePageSize: 50, maxFileBytes: 10 * 1024 * 1024, maxFilesPerMessage: 3,
        allowedFileTypes: DomainDefaults.allowedFileTypes, invitationTtlDays: 7
    )

    @Test func allowlistByExtension() {
        #expect(FileTypes.type(for: "Foto.JPG", in: limits)?.mimeType == "image/jpeg")
        #expect(FileTypes.type(for: "angebot.pdf", in: limits) != nil)
        #expect(FileTypes.type(for: "script.exe", in: limits) == nil)
        #expect(FileTypes.type(for: ".pdf", in: limits) == nil)
        #expect(FileTypes.type(for: "ohne-endung", in: limits) == nil)
    }

    @Test func germanByteFormatting() {
        #expect(ByteFormatting.string(512) == "512 B")
        #expect(ByteFormatting.string(2_516_582) == "2,4 MB")
    }
}
