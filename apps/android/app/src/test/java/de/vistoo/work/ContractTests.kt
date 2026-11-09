package de.vistoo.work

import de.vistoo.work.core.api.ApiJson
import de.vistoo.work.core.api.Iso8601
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.CreateTaskRequest
import de.vistoo.work.core.generated.Message
import de.vistoo.work.core.generated.Meta
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.UpdateTaskRequest
import de.vistoo.work.core.realtime.TaskRow
import de.vistoo.work.core.stores.DecisionStore
import de.vistoo.work.core.stores.TaskFilters
import de.vistoo.work.core.support.CalendarDate
import java.io.File
import java.time.Instant
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Shared task filter semantics (packages/contracts/fixtures/task-filters.json), same cases as TS and Swift. */
class TaskFilterConformanceTest {
    private val fixture: JsonObject by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "packages/contracts/fixtures/task-filters.json").exists()) dir = dir.parentFile
        ApiJson.parseToJsonElement(File(dir!!, "packages/contracts/fixtures/task-filters.json").readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    private fun JsonObject.list(key: String): List<String> = (this[key] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()

    @Test
    fun matchesTypeScriptAndSwift() {
        val tasks = fixture["tasks"]!!.jsonArray.map { it.jsonObject }
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val f = c["filters"]!!.jsonObject
            val filters = TaskFilters(
                query = f.str("q") ?: "",
                projects = f.list("projects").toSet(),
                assignees = f.list("assignees").toSet(),
                statuses = f.list("statuses").map { TaskStatus.from(it) }.toSet(),
            )
            val result = tasks.filter {
                filters.matches(it.str("title")!!, it.str("number")?.toLong(), it.str("projectId")!!, it.str("assigneeId"), TaskStatus.from(it.str("status")!!))
            }.map { it.str("id") }
            assertEquals(c.str("name"), c.list("expected"), result)
        }
    }
}

class CalendarDateTest {
    @Test
    fun parsesStrictly() {
        assertEquals("2026-11-09", CalendarDate.parse("2026-11-09")!!.iso)
        assertNull(CalendarDate.parse("2026-02-30"))
        assertNull(CalendarDate.parse("2026-2-3"))
    }

    @Test
    fun arithmeticOnDayNumbers() {
        val d = CalendarDate.parse("2026-11-09")!! // Monday
        assertEquals(0, d.weekdayIndex)
        assertEquals("2026-11-15", d.adding(6).iso)
        assertTrue(d.adding(5).isWeekend)
        assertEquals(46, d.isoWeek)
        assertEquals(1L, CalendarDate.durationDays(d, d))
        assertEquals(d, CalendarDate.fromUtcMillis(d.utcMillis))
        assertEquals("2026-01-01", CalendarDate.parse("2026-01-01")!!.iso)
        assertEquals(1, CalendarDate.parse("2027-01-04")!!.isoWeek)
    }
}

class Iso8601Test {
    @Test
    fun apiAndRealtimeFormatsAreTheSameInstant() {
        val api = Iso8601.parse("2026-11-06T07:43:29.456Z")!!
        assertEquals(api, Iso8601.parse("2026-11-06T07:43:29.456000+00:00"))
        assertEquals(api, Iso8601.parse("2026-11-06 08:43:29.456+01:00"))
        assertEquals("2026-11-06T07:43:29.456Z", Iso8601.format(api))
        assertNull(Iso8601.parse("gestern"))
    }
}

class ModelCodingTest {
    private val taskJson = """
        {"id":"a","projectId":"p","groupId":null,"milestoneId":null,"number":24,"title":"T","description":"",
         "status":"blocked","assigneeId":null,"startDate":"2026-11-01","endDate":null,"position":1024,
         "createdBy":"u","createdAt":"2026-11-06T07:43:29.456Z","updatedAt":"2026-11-06T07:43:29.456Z","version":3,
         "fieldFromTheFuture":true}
    """.trimIndent()

    @Test
    fun openEnumsKeepUnknownValuesAndUnknownKeysAreIgnored() {
        val task = ApiJson.decodeFromString(TaskItem.serializer(), taskJson)
        assertEquals(TaskStatus.Unknown("blocked"), task.status)
        assertEquals("blocked", task.status.rawValue)
        assertEquals(CalendarDate.parse("2026-11-01"), task.startDate)
        assertEquals(3L, task.version)
        assertEquals(TaskStatus.InProgress, TaskStatus.from("in_progress"))
    }

    @Test
    fun patchableEncodesUnsetNullAndValue() {
        val patch = UpdateTaskRequest.Patch(title = "Neu", assigneeId = Patchable.Null, startDate = Patchable.of(CalendarDate.parse("2026-11-09")))
        val json = patch.toJson().jsonObject
        assertEquals("Neu", json["title"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, json["assigneeId"])
        assertEquals("2026-11-09", json["startDate"]!!.jsonPrimitive.content)
        assertFalse(json.containsKey("endDate"))
        assertFalse(json.containsKey("status"))
    }

    @Test
    fun createRequestCarriesClientIdAndEnumRawValue() {
        val body = CreateTaskRequest(id = "c1", projectId = "p", title = "T", status = TaskStatus.InReview, milestoneId = Patchable.Null).toJson().jsonObject
        assertEquals("c1", body["id"]!!.jsonPrimitive.content)
        assertEquals("in_review", body["status"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, body["milestoneId"])
        assertFalse(body.containsKey("description"))
    }

    @Test
    fun metaDecodes() {
        val meta = ApiJson.decodeFromString(Meta.serializer(), """{"apiVersion":"1","environment":"development","supabaseUrl":"http://127.0.0.1:54321","supabasePublishableKey":"k","minimumIosBuild":0}""")
        assertEquals("http://127.0.0.1:54321", meta.supabaseUrl)
    }

    @Test
    fun realtimeTaskRowDecodes() {
        val record = ApiJson.parseToJsonElement(
            """{"id":"A","project_id":"P","title":"T","status":"done","position":"2048.5","created_by":"U","created_at":"2026-11-06T07:43:29.456789+00:00",
               "updated_at":"2026-11-06 07:43:29+00","version":4,"number":7,"assignee_id":null,"start_date":"2026-11-02"}""",
        ).jsonObject
        val task = TaskRow.decode(record)!!
        assertEquals("a", task.id)
        assertEquals(TaskStatus.Done, task.status)
        assertEquals(2048.5, task.position, 0.0)
        assertEquals(7L, task.number)
        assertNull(task.assigneeId)
        assertTrue(task.createdAt.isBefore(Instant.parse("2026-11-07T00:00:00Z")))
    }

    @Test
    fun decisionPreviewCollapsesWhitespace() {
        assertEquals("a b c", DecisionStore.preview("a\n  b\tc"))
        assertEquals(180, DecisionStore.preview("x".repeat(400)).length)
    }

    @Suppress("unused")
    private val keep = Message::class
}

class FilterNumberTest {
    @Test
    fun issueNumberMatches() {
        assertTrue(TaskFilters.matchesIssueNumber(24, "#24"))
        assertTrue(TaskFilters.matchesIssueNumber(24, "24"))
        assertFalse(TaskFilters.matchesIssueNumber(24, "2"))
        assertFalse(TaskFilters.matchesIssueNumber(null, "24"))
    }
}
