package de.vistoo.work.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.Activity
import de.vistoo.work.core.generated.ActivityType
import de.vistoo.work.core.generated.AddDecisionRelationRequest
import de.vistoo.work.core.generated.Attraction
import de.vistoo.work.core.generated.CreateActivityRequest
import de.vistoo.work.core.generated.CreateAttractionRequest
import de.vistoo.work.core.generated.CreateDecisionLinkRequest
import de.vistoo.work.core.generated.CreateDecisionRequest
import de.vistoo.work.core.generated.CreateIdeaRequest
import de.vistoo.work.core.generated.CreateIssueFromIdeaRequest
import de.vistoo.work.core.generated.CreateMilestoneRequest
import de.vistoo.work.core.generated.CreateTodoRequest
import de.vistoo.work.core.generated.DecisionDetail
import de.vistoo.work.core.generated.DecisionLink
import de.vistoo.work.core.generated.DecisionRef
import de.vistoo.work.core.generated.DecisionRelation
import de.vistoo.work.core.generated.DecisionSort
import de.vistoo.work.core.generated.DecisionStatus
import de.vistoo.work.core.generated.DecisionSummary
import de.vistoo.work.core.generated.DecisionType
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.Idea
import de.vistoo.work.core.generated.IdeaStatus
import de.vistoo.work.core.generated.Milestone
import de.vistoo.work.core.generated.RelationCandidate
import de.vistoo.work.core.generated.ReorderTodosRequest
import de.vistoo.work.core.generated.SetCompletedRequest
import de.vistoo.work.core.generated.SupersedeDecisionRequest
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.Todo
import de.vistoo.work.core.generated.UpdateActivityRequest
import de.vistoo.work.core.generated.UpdateAttractionRequest
import de.vistoo.work.core.generated.UpdateDecisionRequest
import de.vistoo.work.core.generated.UpdateIdeaRequest
import de.vistoo.work.core.generated.UpdateMilestoneRequest
import de.vistoo.work.core.generated.UpdateTodoRequest
import de.vistoo.work.core.support.CalendarDate
import java.time.Instant

/** Deletes: NOT_FOUND means "already gone", which is the goal. */
private inline fun ignoringNotFound(block: () -> Unit) {
    try {
        block()
    } catch (e: ApiError) {
        if (e.code != ErrorCode.NotFound) throw e
    }
}

/**
 * "Meine To-dos": the signed-in member's private checklist. The server scopes every
 * request to the caller; nobody else (also no admin) can see these.
 *
 * Creating waits for the server (nothing is shown as saved before it is); ticking,
 * deleting and reordering update the list immediately and roll back if the server refuses.
 */
class TodoStore(private val backend: Backend) {
    var todos by mutableStateOf<List<Todo>>(emptyList())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    /** Open to-dos in their manual order (new ones on top). */
    val open: List<Todo>
        get() = todos.filter { !it.completed }.sortedWith(compareBy<Todo>({ it.position }, { it.createdAt }))

    /** Completed to-dos, most recently completed first. */
    val completed: List<Todo>
        get() = todos.filter { it.completed }.sortedByDescending { it.completedAt ?: Instant.EPOCH }

    fun overdueCount(today: CalendarDate = CalendarDate.today()): Int = open.count { it.dueDate?.let { d -> d < today } ?: false }

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        state = try {
            todos = backend.send(API.listTodos()).todos
            LoadState.Loaded
        } catch (e: ApiError) {
            if (todos.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    /** `id` is the client id: retrying after a network failure never creates a second to-do. */
    suspend fun create(id: String, title: String, description: String = "", dueDate: CalendarDate? = null): Todo {
        val body = CreateTodoRequest(id = id, title = title.trim(), description = description, dueDate = Patchable.of(dueDate))
        val todo = backend.send(API.createTodo(body = body))
        upsert(todo)
        return todo
    }

    suspend fun update(id: String, patch: UpdateTodoRequest): Todo {
        val todo = backend.send(API.updateTodo(id = id, body = patch))
        upsert(todo)
        return todo
    }

    suspend fun setCompleted(todo: Todo, completed: Boolean) {
        if (todo.completed == completed) return
        upsert(todo.copy(completed = completed, completedAt = if (completed) Instant.now() else null))
        try {
            upsert(backend.send(API.updateTodo(id = todo.id, body = UpdateTodoRequest(completed = completed))))
        } catch (e: Exception) {
            upsert(todo)
            throw e
        }
    }

    suspend fun delete(todo: Todo) {
        val previous = todos
        todos = todos.filter { it.id != todo.id }
        try {
            ignoringNotFound { backend.send(API.deleteTodo(id = todo.id)) }
        } catch (e: Exception) {
            todos = previous
            throw e
        }
    }

    /** Moves an open to-do to `toIndex` within the open list. */
    suspend fun move(todoId: String, toIndex: Int) {
        val ordered = open.toMutableList()
        val from = ordered.indexOfFirst { it.id == todoId }
        if (from < 0) return
        val target = toIndex.coerceIn(0, ordered.size - 1)
        if (target == from) return
        val item = ordered.removeAt(from)
        ordered.add(target, item)

        val previous = todos
        ordered.forEachIndexed { i, t -> upsert(t.copy(position = (i + 1) * 1024.0)) }
        try {
            val result = backend.send(API.reorderTodos(body = ReorderTodosRequest(ids = ordered.map { it.id })))
            for (t in result.todos) upsert(t)
        } catch (e: Exception) {
            todos = previous
            throw e
        }
    }

    private fun upsert(todo: Todo) {
        val i = todos.indexOfFirst { it.id == todo.id }
        todos = if (i >= 0) todos.toMutableList().also { it[i] = todo } else todos + todo
    }

    fun reset() {
        todos = emptyList()
        state = LoadState.Idle
    }
}

/** Shared idea backlog ("Ideen"). Every active member reads and edits; the server validates assignees and creates linked issues. */
class IdeaStore(private val backend: Backend) {
    var ideas by mutableStateOf<List<Idea>>(emptyList())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    fun idea(id: String): Idea? = ideas.firstOrNull { it.id == id }

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        state = try {
            ideas = backend.send(API.listIdeas()).ideas
            LoadState.Loaded
        } catch (e: ApiError) {
            if (ideas.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    suspend fun create(id: String, title: String, description: String, assigneeId: String?): Idea {
        val body = CreateIdeaRequest(id = id, title = title.trim(), description = description, assigneeId = Patchable.of(assigneeId))
        val idea = backend.send(API.createIdea(body = body))
        ideas = (listOf(idea) + ideas).distinctBy { it.id }
        return idea
    }

    suspend fun update(id: String, patch: UpdateIdeaRequest): Idea {
        val idea = backend.send(API.updateIdea(id = id, body = patch))
        upsert(idea)
        return idea
    }

    suspend fun setStatus(idea: Idea, status: IdeaStatus) {
        if (idea.status == status) return
        upsert(idea.copy(status = status))
        try {
            upsert(backend.send(API.updateIdea(id = idea.id, body = UpdateIdeaRequest(status = status))))
        } catch (e: Exception) {
            upsert(idea)
            throw e
        }
    }

    suspend fun delete(idea: Idea) {
        val previous = ideas
        ideas = ideas.filter { it.id != idea.id }
        try {
            ignoringNotFound { backend.send(API.deleteIdea(id = idea.id)) }
        } catch (e: Exception) {
            ideas = previous
            throw e
        }
    }

    /** Creates (or returns the already created) issue in `projectId`. */
    suspend fun createIssue(idea: Idea, projectId: String): TaskItem {
        val result = backend.send(API.createIssueFromIdea(id = idea.id, body = CreateIssueFromIdeaRequest(projectId = projectId)))
        upsert(result.idea)
        return result.task
    }

    private fun upsert(idea: Idea) {
        val i = ideas.indexOfFirst { it.id == idea.id }
        ideas = if (i >= 0) ideas.toMutableList().also { it[i] = idea } else listOf(idea) + ideas
    }

    fun reset() {
        ideas = emptyList()
        state = LoadState.Idle
    }
}

/** CRM: potential partner attractions and their timelines. Status, owner and follow-up changes are logged by the server in the same transaction. */
class CRMStore(private val backend: Backend) {
    var attractions by mutableStateOf<List<Attraction>>(emptyList())
        private set
    var activities by mutableStateOf<Map<String, List<Activity>>>(emptyMap())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    fun attraction(id: String): Attraction? = attractions.firstOrNull { it.id == id }

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        state = try {
            attractions = backend.send(API.listAttractions()).attractions
            LoadState.Loaded
        } catch (e: ApiError) {
            if (attractions.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    suspend fun create(body: CreateAttractionRequest): Attraction {
        val attraction = backend.send(API.createAttraction(body = body))
        upsert(attraction)
        return attraction
    }

    suspend fun update(id: String, patch: UpdateAttractionRequest): Attraction {
        val attraction = backend.send(API.updateAttraction(id = id, body = patch))
        upsert(attraction)
        // The server may have added a timeline entry.
        if (activities.containsKey(id)) loadActivities(id)
        return attraction
    }

    suspend fun delete(attraction: Attraction) {
        val previous = attractions
        attractions = attractions.filter { it.id != attraction.id }
        try {
            ignoringNotFound { backend.send(API.deleteAttraction(id = attraction.id)) }
        } catch (e: Exception) {
            attractions = previous
            throw e
        }
        activities = activities - attraction.id
    }

    suspend fun loadActivities(attractionId: String) {
        val list = runCatching { backend.send(API.listActivities(id = attractionId)) }.getOrNull() ?: return
        activities = activities + (attractionId to list.activities)
    }

    suspend fun addActivity(
        attractionId: String,
        id: String,
        type: ActivityType,
        description: String,
        occurredAt: Instant,
        nextFollowUp: Patchable<CalendarDate>,
    ) {
        val body = CreateActivityRequest(
            id = id,
            type = CreateActivityRequest.TypeInfo.from(type.rawValue),
            description = description,
            occurredAt = occurredAt,
            nextFollowUp = nextFollowUp,
        )
        val change = backend.send(API.addActivity(id = attractionId, body = body))
        upsert(change.attraction)
        loadActivities(attractionId)
    }

    suspend fun updateActivity(activity: Activity, type: ActivityType, description: String, occurredAt: Instant) {
        val body = UpdateActivityRequest(type = UpdateActivityRequest.TypeInfo.from(type.rawValue), description = description, occurredAt = occurredAt)
        val change = backend.send(API.updateActivity(id = activity.id, body = body))
        upsert(change.attraction)
        loadActivities(activity.attractionId)
    }

    suspend fun deleteActivity(activity: Activity) {
        try {
            val result = backend.send(API.deleteActivity(id = activity.id))
            upsert(result.attraction)
        } catch (e: ApiError) {
            if (e.code != ErrorCode.NotFound) throw e
        }
        loadActivities(activity.attractionId)
    }

    private fun upsert(attraction: Attraction) {
        val i = attractions.indexOfFirst { it.id == attraction.id }
        attractions = if (i >= 0) {
            attractions.toMutableList().also { it[i] = attraction }
        } else {
            (attractions + attraction).sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        }
    }

    fun reset() {
        attractions = emptyList()
        activities = emptyMap()
        state = LoadState.Idle
    }
}

/**
 * Decisions and experiments. Search and filters run on the server (full text);
 * status/type/completion rules are enforced there as well — the app only shows
 * the server's field errors.
 */
class DecisionStore(private val backend: Backend) {
    data class Query(
        val text: String = "",
        val type: DecisionType? = null,
        val status: DecisionStatus? = null,
        /** Member id or `DomainDefaults.unassigned`. */
        val assigneeId: String? = null,
        val sort: DecisionSort = DecisionSort.Updated,
    ) {
        val filterCount: Int get() = listOf(type != null, status != null, assigneeId != null).count { it }
    }

    var decisions by mutableStateOf<List<DecisionSummary>>(emptyList())
        private set
    var details by mutableStateOf<Map<String, DecisionDetail>>(emptyMap())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set
    var query by mutableStateOf(Query())

    private var generation = 0

    suspend fun reload() {
        generation += 1
        val current = generation
        if (state != LoadState.Loaded) state = LoadState.Loading
        try {
            val q = query
            val trimmed = q.text.trim()
            val list = backend.send(
                API.listDecisions(
                    query = trimmed.ifEmpty { null },
                    type = q.type,
                    status = q.status,
                    assigneeId = q.assigneeId,
                    sort = q.sort,
                ),
            )
            // A newer search started meanwhile: its result wins.
            if (current != generation) return
            decisions = list.decisions
            state = LoadState.Loaded
        } catch (e: ApiError) {
            if (current != generation) return
            state = if (decisions.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    suspend fun create(id: String, type: DecisionType, title: String): DecisionSummary {
        val body = CreateDecisionRequest(id = id, type = type, title = title.trim())
        val summary = backend.send(API.createDecision(body = body))
        decisions = listOf(summary) + decisions.filter { it.id != summary.id }
        return summary
    }

    suspend fun loadDetail(id: String) {
        apply(backend.send(API.getDecision(id = id)))
    }

    suspend fun update(id: String, patch: UpdateDecisionRequest): DecisionDetail {
        val detail = backend.send(API.updateDecision(id = id, body = patch))
        apply(detail)
        return detail
    }

    suspend fun delete(id: String) {
        try {
            val result = backend.send(API.deleteDecision(id = id))
            details = details - result.restored.toSet()
        } catch (e: ApiError) {
            if (e.code != ErrorCode.NotFound) throw e
        }
        decisions = decisions.filter { it.id != id }
        details = details - id
        reload()
    }

    suspend fun supersedeCandidates(id: String): List<DecisionRef> = backend.send(API.listSupersedeCandidates(id = id)).decisions

    /** Either an existing successor or a new decision (`newId` keeps retries idempotent). */
    suspend fun supersede(id: String, successorId: String? = null, newTitle: String? = null, newId: String? = null): DecisionSummary {
        val result = backend.send(API.supersedeDecision(id = id, body = SupersedeDecisionRequest(successorId = successorId, newTitle = newTitle, newId = newId)))
        apply(result.decision)
        details = details - result.successor.id
        reload()
        return result.successor
    }

    suspend fun addLink(decisionId: String, id: String, url: String, title: String?) {
        backend.send(API.createDecisionLink(id = decisionId, body = CreateDecisionLinkRequest(id = id, url = url, title = Patchable.of(title))))
        loadDetail(decisionId)
    }

    suspend fun deleteLink(link: DecisionLink) {
        ignoringNotFound { backend.send(API.deleteDecisionLink(id = link.id)) }
        loadDetail(link.decisionId)
    }

    suspend fun relationCandidates(decisionId: String, query: String): List<RelationCandidate> {
        val q = query.trim()
        return backend.send(API.listRelationCandidates(id = decisionId, query = q.ifEmpty { null })).candidates
    }

    suspend fun addRelation(decisionId: String, candidate: RelationCandidate) {
        val result = backend.send(API.addDecisionRelation(id = decisionId, body = AddDecisionRelationRequest(kind = candidate.kind, targetId = candidate.targetId)))
        details[decisionId]?.let { details = details + (decisionId to it.copy(relations = result.relations)) }
    }

    suspend fun removeRelation(relation: DecisionRelation, decisionId: String) {
        ignoringNotFound { backend.send(API.removeDecisionRelation(id = relation.id)) }
        details[decisionId]?.let { d -> details = details + (decisionId to d.copy(relations = d.relations.filter { it.id != relation.id })) }
    }

    private fun apply(detail: DecisionDetail) {
        details = details + (detail.decision.id to detail)
        val d = detail.decision
        val i = decisions.indexOfFirst { it.id == d.id }
        if (i >= 0) {
            val preview = if (d.type == DecisionType.Experiment) d.results else d.outcome
            decisions = decisions.toMutableList().also {
                it[i] = DecisionSummary(
                    id = d.id, type = d.type, title = d.title, status = d.status, assigneeId = d.assigneeId,
                    createdBy = d.createdBy, concludedOn = d.concludedOn, createdAt = d.createdAt, updatedAt = d.updatedAt,
                    outcomePreview = preview(preview),
                )
            }
        }
    }

    fun reset() {
        decisions = emptyList()
        details = emptyMap()
        state = LoadState.Idle
        query = Query()
    }

    companion object {
        /** Display only (the server sends the authoritative preview on reload). */
        fun preview(text: String): String {
            val line = text.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
            return if (line.length > 180) line.take(179) + "…" else line
        }
    }
}

/** Workspace-wide milestones. Tasks of any project can be attached (`TaskItem.milestoneId`); the counts come from the server. */
class MilestoneStore(private val backend: Backend) {
    var milestones by mutableStateOf<List<Milestone>>(emptyList())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    fun milestone(id: String?): Milestone? = id?.let { mid -> milestones.firstOrNull { it.id == mid } }

    val open: List<Milestone> get() = milestones.filter { !it.completed }
    val completed: List<Milestone> get() = milestones.filter { it.completed }

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        state = try {
            milestones = backend.send(API.listMilestones()).milestones
            LoadState.Loaded
        } catch (e: ApiError) {
            if (milestones.isEmpty()) LoadState.Failed(e.message) else LoadState.Loaded
        }
    }

    suspend fun refresh(id: String) {
        runCatching { backend.send(API.getMilestone(id = id)) }.getOrNull()?.let { upsert(it) }
    }

    suspend fun create(id: String, name: String, description: String, dueDate: CalendarDate?): Milestone {
        val body = CreateMilestoneRequest(name = name.trim(), description = description, dueDate = Patchable.of(dueDate), id = id)
        val m = backend.send(API.createMilestone(body = body))
        upsert(m)
        reload()
        return m
    }

    suspend fun update(id: String, name: String, description: String, dueDate: CalendarDate?) {
        val body = UpdateMilestoneRequest(name = name.trim(), description = description, dueDate = Patchable.of(dueDate))
        upsert(backend.send(API.updateMilestone(id = id, body = body)))
    }

    suspend fun setCompleted(milestone: Milestone, completed: Boolean) {
        upsert(backend.send(API.setMilestoneCompleted(id = milestone.id, body = SetCompletedRequest(completed = completed))))
    }

    suspend fun delete(milestone: Milestone) {
        ignoringNotFound { backend.send(API.deleteMilestone(id = milestone.id)) }
        milestones = milestones.filter { it.id != milestone.id }
    }

    private fun upsert(m: Milestone) {
        val i = milestones.indexOfFirst { it.id == m.id }
        milestones = if (i >= 0) milestones.toMutableList().also { it[i] = m } else milestones + m
    }

    fun reset() {
        milestones = emptyList()
        state = LoadState.Idle
    }
}
