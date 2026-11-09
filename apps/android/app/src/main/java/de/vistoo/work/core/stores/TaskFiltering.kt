package de.vistoo.work.core.stores

import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import java.util.Locale

/**
 * Task filter semantics shared with the web (packages/domain/src/filters.ts) and iOS.
 * Values within one filter are OR-ed, different filters AND-ed; the search matches
 * the title case-insensitively; `24` or `#24` also matches issue #24. Verified against
 * packages/contracts/fixtures/task-filters.json in the unit tests.
 */
data class TaskFilters(
    val query: String = "",
    val projects: Set<String> = emptySet(),
    /** User ids or `DomainDefaults.unassigned`. */
    val assignees: Set<String> = emptySet(),
    val statuses: Set<TaskStatus> = emptySet(),
) {
    val isActive: Boolean
        get() = query.isNotBlank() || projects.isNotEmpty() || assignees.isNotEmpty() || statuses.isNotEmpty()

    /** Number of active attribute filters (search excluded), for the toolbar badge. */
    val count: Int get() = projects.size + assignees.size + statuses.size

    fun matches(title: String, number: Long?, projectId: String, assigneeId: String?, status: TaskStatus): Boolean {
        val q = query.trim().lowercase(Locale.GERMANY)
        if (q.isNotEmpty() && !title.lowercase(Locale.GERMANY).contains(q) && !matchesIssueNumber(number, q)) return false
        if (projects.isNotEmpty() && projectId !in projects) return false
        if (assignees.isNotEmpty() && (assigneeId ?: DomainDefaults.unassigned) !in assignees) return false
        if (statuses.isNotEmpty() && status !in statuses) return false
        return true
    }

    fun matches(task: TaskItem): Boolean = matches(task.title, task.number, task.projectId, task.assigneeId, task.status)

    companion object {
        /** `24` or `#24` names issue #24 (exact match, ASCII digits only). */
        fun matchesIssueNumber(number: Long?, q: String): Boolean {
            if (number == null) return false
            val digits = q.removePrefix("#")
            if (digits.length !in 1..9 || !digits.all { it in '0'..'9' }) return false
            return digits.toLong() == number
        }
    }
}

/** Board order within a column (same as the server: position, created, id). */
val TaskBoardOrder: Comparator<TaskItem> = compareBy<TaskItem>({ it.position }, { it.createdAt }, { it.id })

val TaskItem.hasCompleteRange: Boolean get() = startDate != null && endDate != null
