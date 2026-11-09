package de.vistoo.work.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.Bootstrap
import de.vistoo.work.core.generated.CreateProjectRequest
import de.vistoo.work.core.generated.CreateTaskRequest
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.Member
import de.vistoo.work.core.generated.MoveTaskRequest
import de.vistoo.work.core.generated.Project
import de.vistoo.work.core.generated.ProjectColorKey
import de.vistoo.work.core.generated.ProjectStat
import de.vistoo.work.core.generated.SetArchivedRequest
import de.vistoo.work.core.generated.SetTaskAssigneeRequest
import de.vistoo.work.core.generated.SetTaskStatusRequest
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.UpdateProjectRequest
import de.vistoo.work.core.generated.UpdateTaskRequest
import de.vistoo.work.core.support.CalendarDate
import de.vistoo.work.core.support.newClientId
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Which tasks a work view shows (same as the web: "Alle Aufgaben" or one project). */
sealed interface WorkScope {
    /** All non-archived projects. */
    data object All : WorkScope
    data class OfProject(val id: String) : WorkScope
}

/**
 * Projects, people and tasks of the workspace.
 *
 * Mutations go through the API (server rules are authoritative) with an
 * optimistic local update and rollback on failure. Realtime events and API
 * responses are merged by task `version`, so nothing is duplicated or
 * overwritten with older data.
 */
class WorkStore(private val backend: Backend, bootstrap: Bootstrap) {
    var projects by mutableStateOf<List<Project>>(emptyList())
        private set
    var projectStats by mutableStateOf<Map<String, ProjectStat>>(emptyMap())
        private set
    var members by mutableStateOf<List<Member>>(emptyList())
        private set
    var formerMembers by mutableStateOf<List<Member>>(emptyList())
        private set
    var tasksById by mutableStateOf<Map<String, TaskItem>>(emptyMap())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    /** Archived projects whose tasks were loaded on demand. */
    private val loadedArchivedProjects = mutableSetOf<String>()

    init {
        apply(bootstrap)
    }

    fun apply(bootstrap: Bootstrap) {
        projects = bootstrap.projects
        members = bootstrap.members
        formerMembers = bootstrap.formerMembers
    }

    // MARK: Lookup

    fun project(id: String?): Project? = id?.let { pid -> projects.firstOrNull { it.id == pid } }

    val activeProjects: List<Project> get() = projects.filter { !it.archived }
    val archivedProjects: List<Project> get() = projects.filter { it.archived }

    /** Active or former member (former only for historical names). */
    fun person(id: String?): Member? = id?.let { uid -> members.firstOrNull { it.userId == uid } ?: formerMembers.firstOrNull { it.userId == uid } }

    fun task(id: String): TaskItem? = tasksById[id]

    /** Archived projects are read-only (server enforces it, the UI hides edits). */
    fun isReadOnly(task: TaskItem): Boolean = project(task.projectId)?.archived ?: false

    fun tasks(scope: WorkScope): List<TaskItem> {
        val all = tasksById.values
        val scoped = when (scope) {
            WorkScope.All -> {
                val active = activeProjects.map { it.id }.toSet()
                all.filter { it.projectId in active }
            }
            is WorkScope.OfProject -> all.filter { it.projectId == scope.id }
        }
        return scoped.sortedWith(TaskBoardOrder)
    }

    // MARK: Loading

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        try {
            val (p, t) = coroutineScope {
                val projectList = async { backend.send(API.listProjects()) }
                val taskList = async { backend.send(API.listTasks()) }
                projectList.await() to taskList.await()
            }
            projects = p.projects
            projectStats = p.stats
            val next = t.tasks.associateBy { it.id }.toMutableMap()
            // Keep tasks of opened archived projects (not part of the "all" list).
            for ((id, task) in tasksById) if (task.projectId in loadedArchivedProjects) next.putIfAbsent(id, task)
            tasksById = next
            state = LoadState.Loaded
            for (id in loadedArchivedProjects.toList()) loadTasks(id)
        } catch (e: ApiError) {
            state = if (tasksById.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    /** Tasks of one project (needed for archived projects, which "all" excludes). */
    suspend fun loadTasks(projectId: String) {
        val list = runCatching { backend.send(API.listTasks(projectId = projectId)) }.getOrNull() ?: return
        if (project(projectId)?.archived == true) loadedArchivedProjects += projectId
        val ids = list.tasks.map { it.id }.toSet()
        tasksById = tasksById.filterValues { it.projectId != projectId || it.id in ids }
        for (task in list.tasks) merge(task)
    }

    suspend fun reloadProjects() {
        val list = runCatching { backend.send(API.listProjects()) }.getOrNull() ?: return
        projects = list.projects
        projectStats = list.stats
    }

    /** Fetches a single task (deep links into archived projects). */
    suspend fun fetchTask(id: String): TaskItem {
        val task = backend.send(API.getTask(id = id))
        merge(task)
        return task
    }

    // MARK: Realtime / merge

    /** Keeps the newer version; equal versions take the server copy. */
    fun merge(task: TaskItem) {
        val current = tasksById[task.id]
        if (current != null && current.version > task.version) return
        tasksById = tasksById + (task.id to task)
    }

    fun removeTask(id: String) {
        if (id in tasksById) tasksById = tasksById - id
    }

    private fun put(id: String, task: TaskItem?) {
        tasksById = if (task == null) tasksById - id else tasksById + (id to task)
    }

    // MARK: Task mutations

    data class TaskDraft(
        val projectId: String,
        val status: TaskStatus = TaskStatus.Open,
        val assigneeId: String? = null,
        val title: String = "",
        val description: String = "",
        val milestoneId: String? = null,
        val startDate: CalendarDate? = null,
        val endDate: CalendarDate? = null,
        /** Client id: retries after a network failure never create a second task. */
        val id: String = newClientId(),
    )

    suspend fun createTask(draft: TaskDraft): TaskItem {
        val body = CreateTaskRequest(
            id = draft.id,
            projectId = draft.projectId,
            title = draft.title.trim(),
            description = draft.description,
            status = draft.status,
            milestoneId = Patchable.of(draft.milestoneId),
            assigneeId = Patchable.of(draft.assigneeId),
            startDate = Patchable.of(draft.startDate),
            endDate = Patchable.of(draft.endDate),
        )
        val task = backend.send(API.createTask(body = body))
        merge(task)
        bumpStats(task.projectId)
        return task
    }

    /** Full edit with optimistic concurrency (CONFLICT carries the current task). */
    suspend fun updateTask(id: String, expectedVersion: Long, patch: UpdateTaskRequest.Patch): TaskItem {
        val task = backend.send(API.updateTask(id = id, body = UpdateTaskRequest(expectedVersion = expectedVersion, patch = patch)))
        merge(task)
        return task
    }

    /** Quick action (no version check, as on the web). Task goes to the end of the column. */
    suspend fun setStatus(task: TaskItem, status: TaskStatus) {
        if (task.status == status) return
        val previous = tasksById[task.id]
        val end = (tasks(WorkScope.All).filter { it.status == status }.maxOfOrNull { it.position } ?: 0.0) + 1024
        put(task.id, task.copy(status = status, position = end))
        try {
            merge(backend.send(API.setTaskStatus(id = task.id, body = SetTaskStatusRequest(status = status))))
            bumpStats(task.projectId)
        } catch (e: Exception) {
            put(task.id, previous)
            throw e
        }
    }

    suspend fun setAssignee(task: TaskItem, userId: String?) {
        val previous = tasksById[task.id]
        put(task.id, task.copy(assigneeId = userId))
        try {
            merge(backend.send(API.setTaskAssignee(id = task.id, body = SetTaskAssigneeRequest(assigneeId = userId))))
        } catch (e: Exception) {
            put(task.id, previous)
            throw e
        }
    }

    /** Board move between the *visible* neighbours (hidden tasks keep their positions, as on the web). */
    suspend fun move(task: TaskItem, status: TaskStatus, afterId: String?, beforeId: String?) {
        val previous = tasksById[task.id]
        val after = afterId?.let { tasksById[it]?.position }
        val before = beforeId?.let { tasksById[it]?.position }
        val position = when {
            after != null && before != null -> (after + before) / 2
            after != null -> after + 1024
            before != null -> before - 1024
            else -> task.position
        }
        put(task.id, task.copy(status = status, position = position))
        try {
            merge(backend.send(API.moveTask(id = task.id, body = MoveTaskRequest(status = status, afterId = afterId, beforeId = beforeId))))
            bumpStats(task.projectId)
        } catch (e: Exception) {
            put(task.id, previous)
            throw e
        }
    }

    suspend fun deleteTask(task: TaskItem) {
        val previous = tasksById[task.id]
        put(task.id, null)
        try {
            backend.send(API.deleteTask(id = task.id))
        } catch (e: ApiError) {
            // Already gone (e.g. a retried request): that is the goal.
            if (e.code != ErrorCode.NotFound) {
                put(task.id, previous)
                throw e
            }
        }
        bumpStats(task.projectId)
    }

    // MARK: Projects

    suspend fun createProject(id: String = newClientId(), name: String, description: String, color: String): Project {
        val project = backend.send(API.createProject(body = CreateProjectRequest(name = name, description = description, color = ProjectColorKey.from(color), id = id)))
        upsert(project)
        return project
    }

    suspend fun updateProject(id: String, name: String, description: String, color: String) {
        upsert(backend.send(API.updateProject(id = id, body = UpdateProjectRequest(name = name, description = description, color = ProjectColorKey.from(color)))))
    }

    suspend fun setArchived(id: String, archived: Boolean) {
        upsert(backend.send(API.setProjectArchived(id = id, body = SetArchivedRequest(archived = archived))))
        reload()
    }

    private fun upsert(project: Project) {
        val i = projects.indexOfFirst { it.id == project.id }
        projects = if (i >= 0) {
            projects.toMutableList().also { it[i] = project }
        } else {
            (projects + project).sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        }
    }

    /** Local recount of the project statistics (the server sends exact numbers on reload). */
    private fun bumpStats(projectId: String) {
        val tasks = tasksById.values.filter { it.projectId == projectId }
        projectStats = projectStats + (projectId to ProjectStat(total = tasks.size.toLong(), done = tasks.count { it.status == TaskStatus.Done }.toLong()))
    }
}

/** End date passed and not done (display only; the server knows no "overdue"). */
fun TaskItem.isOverdue(today: CalendarDate = CalendarDate.today()): Boolean =
    status != TaskStatus.Done && (endDate?.let { it < today } ?: false)

/** Own open tasks whose end date has passed (badge of the "Für mich" tab). */
fun WorkStore.overdueCount(userId: String, today: CalendarDate = CalendarDate.today()): Int =
    tasks(WorkScope.All).count { it.assigneeId == userId && it.isOverdue(today) }
