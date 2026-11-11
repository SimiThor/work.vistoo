package de.vistoo.work.ui.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import de.vistoo.work.core.stores.DeepLink
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.ui.crm.AttractionDetailScreen
import de.vistoo.work.ui.crm.CRMScreen
import de.vistoo.work.ui.decisions.DecisionDetailScreen
import de.vistoo.work.ui.decisions.DecisionsScreen
import de.vistoo.work.ui.ideas.IdeaDetailScreen
import de.vistoo.work.ui.ideas.IdeasScreen
import de.vistoo.work.ui.milestones.MilestoneDetailScreen
import de.vistoo.work.ui.milestones.MilestonesScreen
import de.vistoo.work.ui.todos.TodosScreen
import kotlinx.serialization.Serializable

// Typed routes (Navigation Compose with kotlinx.serialization).

@Serializable data object HomeRoute
@Serializable data object TasksRoute
@Serializable data object ProjectsRoute
@Serializable data class ProjectRoute(val id: String)
@Serializable data object ChatRoute
@Serializable data class ConversationRoute(val id: String)
@Serializable data object MoreRoute

/** Destinations of the "Mehr" stack (also reachable from "Für mich"), like iOS `AreaRoute`. */
@Serializable data object TodosRoute
@Serializable data object MilestonesRoute
@Serializable data class MilestoneRoute(val id: String)
@Serializable data object IdeasRoute
@Serializable data class IdeaRoute(val id: String)
@Serializable data object DecisionsRoute
@Serializable data class DecisionRoute(val id: String)
@Serializable data object CrmRoute
@Serializable data class AttractionRoute(val id: String)

/** Registers every area screen (to-dos, milestones, ideas, decisions, CRM) in a tab's graph. */
fun NavGraphBuilder.areaDestinations(session: SessionModel, nav: NavHostController) {
    composable<TodosRoute> { TodosScreen(session, onBack = { nav.popBackStack() }) }
    composable<MilestonesRoute> { MilestonesScreen(session, nav) }
    composable<MilestoneRoute> { MilestoneDetailScreen(session, it.toRoute<MilestoneRoute>().id, nav) }
    composable<IdeasRoute> { IdeasScreen(session, nav) }
    composable<IdeaRoute> { IdeaDetailScreen(session, it.toRoute<IdeaRoute>().id, nav) }
    composable<DecisionsRoute> { DecisionsScreen(session, nav) }
    composable<DecisionRoute> { DecisionDetailScreen(session, it.toRoute<DecisionRoute>().id, nav) }
    composable<CrmRoute> { CRMScreen(session, nav) }
    composable<AttractionRoute> { AttractionDetailScreen(session, it.toRoute<AttractionRoute>().id, nav) }
}

/** Navigation state of the signed-in app (tabs + one back stack per tab). */
class Navigator(private val tabState: MutableState<String>) {
    enum class Tab { Home, Tasks, Projects, Chat, More }

    /** Backed by saveable state: the selected tab survives rotation and process death. */
    var tab: Tab
        get() = runCatching { Tab.valueOf(tabState.value) }.getOrDefault(Tab.Home)
        set(value) {
            tabState.value = value.name
        }
    lateinit var controllers: Map<Tab, NavHostController>

    /** Task opened by link or from another area, shown as sheet above any tab. */
    var linkedTask by mutableStateOf<String?>(null)

    /** Account, notifications, team: rarely needed, so a sheet behind the avatar instead of a tab. */
    var showSettings by mutableStateOf(false)

    /**
     * Route to open in a tab. The tab's NavHost may not be composed yet (its graph is only
     * set then), so the target tab performs the navigation itself ([consumePending]).
     */
    var pending by mutableStateOf<Pair<Tab, Any>?>(null)
        private set

    fun open(link: DeepLink) {
        when (link) {
            is DeepLink.Task -> linkedTask = link.id
            is DeepLink.Project -> {
                tab = Tab.Projects
                pending = Tab.Projects to ProjectRoute(link.id)
            }
            is DeepLink.Conversation -> openConversation(link.id)
        }
    }

    fun openConversation(id: String) {
        tab = Tab.Chat
        pending = Tab.Chat to ConversationRoute(id)
    }

    /** Called by the composed NavHost of `tab`: shows the pending route on top of the tab root. */
    fun consumePending(tab: Tab, nav: NavHostController, root: Any) {
        val (target, route) = pending ?: return
        if (target != tab) return
        pending = null
        nav.popBackStack(root, inclusive = false)
        nav.navigate(route)
    }
}

val LocalNavigator = staticCompositionLocalOf<Navigator> { error("Navigator missing") }

/** The navigator of the signed-in UI. */
@Composable
fun navigator(): Navigator = LocalNavigator.current
