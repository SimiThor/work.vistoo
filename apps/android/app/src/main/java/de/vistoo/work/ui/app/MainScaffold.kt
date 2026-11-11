package de.vistoo.work.ui.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.FactCheck
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.stores.overdueCount
import de.vistoo.work.ui.chat.ChatListScreen
import de.vistoo.work.ui.chat.ConversationScreen
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.EmptyState
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.OfflineBanner
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.BarButton
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.home.HomeScreen
import de.vistoo.work.ui.more.MoreScreen
import de.vistoo.work.ui.projects.ProjectDetailScreen
import de.vistoo.work.ui.projects.ProjectsScreen
import de.vistoo.work.ui.settings.SettingsSheet
import de.vistoo.work.ui.tasks.TaskDetailView
import de.vistoo.work.ui.tasks.WorkScreen
import de.vistoo.work.core.api.userMessage

/**
 * Main areas, most important first: Für mich (own to-dos, open tasks, unread chats),
 * Aufgaben (whole team), Projekte, Chat, Mehr (milestones, ideas, decisions, CRM).
 * Settings sit behind the avatar in the top-left corner of every tab ([AccountButton]).
 * Each tab keeps its own back stack, as on iOS.
 */
@Composable
fun MainScaffold(app: AppModel, session: SessionModel) {
    val savedTab = rememberSaveable { mutableStateOf(Navigator.Tab.Home.name) }
    val navigator = remember { Navigator(savedTab) }
    val controllers = mapOf(
        Navigator.Tab.Home to rememberNavController(),
        Navigator.Tab.Tasks to rememberNavController(),
        Navigator.Tab.Projects to rememberNavController(),
        Navigator.Tab.Chat to rememberNavController(),
        Navigator.Tab.More to rememberNavController(),
    )
    navigator.controllers = controllers
    val saveable = rememberSaveableStateHolder()

    LaunchedEffect(app.pendingLink) {
        val link = app.pendingLink ?: return@LaunchedEffect
        navigator.open(link)
        app.pendingLink = null
    }

    // Back at a tab root returns to "Für mich" before leaving the app.
    BackHandler(enabled = navigator.tab != Navigator.Tab.Home && controllers[navigator.tab]?.previousBackStackEntry == null) {
        navigator.tab = Navigator.Tab.Home
    }

    CompositionLocalProvider(LocalNavigator provides navigator) {
        Scaffold(
            containerColor = Tokens.Palette.surfaceSubtle,
            contentWindowInsets = WindowInsets(0),
            bottomBar = { TabBar(navigator, session) },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                if (!app.network.isOnline) {
                    Box(Modifier.statusBarsPadding()) { OfflineBanner() }
                }
                // The banner already covers the status bar: screens below must not pad for it again.
                Box(Modifier.weight(1f).then(if (!app.network.isOnline) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier)) {
                    val tab = navigator.tab
                    saveable.SaveableStateProvider(tab.name) {
                        TabHost(tab, controllers.getValue(tab), session)
                    }
                }
            }
        }

        if (navigator.showSettings) {
            SettingsSheet(app, session) { navigator.showSettings = false }
        }
        navigator.linkedTask?.let { id ->
            LinkedTaskSheet(session, id) { navigator.linkedTask = null }
        }
    }
}

@Composable
private fun TabHost(tab: Navigator.Tab, nav: NavHostController, session: SessionModel) {
    val navigator = navigator()
    // Runs after the NavHost below has set its graph in this composition.
    LaunchedEffect(navigator.pending, tab) {
        val root: Any = when (tab) {
            Navigator.Tab.Home -> HomeRoute
            Navigator.Tab.Tasks -> TasksRoute
            Navigator.Tab.Projects -> ProjectsRoute
            Navigator.Tab.Chat -> ChatRoute
            Navigator.Tab.More -> MoreRoute
        }
        navigator.consumePending(tab, nav, root)
    }
    when (tab) {
        Navigator.Tab.Home -> NavHost(nav, startDestination = HomeRoute) {
            composable<HomeRoute> { HomeScreen(session, nav) }
            areaDestinations(session, nav)
        }
        Navigator.Tab.Tasks -> NavHost(nav, startDestination = TasksRoute) {
            composable<TasksRoute> { WorkScreen(session, WorkScope.All, "Alle Aufgaben", onBack = null) }
        }
        Navigator.Tab.Projects -> NavHost(nav, startDestination = ProjectsRoute) {
            composable<ProjectsRoute> { ProjectsScreen(session, nav) }
            composable<ProjectRoute> { ProjectDetailScreen(session, it.toRoute<ProjectRoute>().id, onBack = { nav.popBackStack() }) }
        }
        Navigator.Tab.Chat -> NavHost(nav, startDestination = ChatRoute) {
            composable<ChatRoute> { ChatListScreen(session, nav) }
            composable<ConversationRoute> { ConversationScreen(session, it.toRoute<ConversationRoute>().id, onBack = { nav.popBackStack() }) }
        }
        Navigator.Tab.More -> NavHost(nav, startDestination = MoreRoute) {
            composable<MoreRoute> { MoreScreen(session, nav) }
            areaDestinations(session, nav)
        }
    }
}

@Composable
private fun TabBar(navigator: Navigator, session: SessionModel) {
    val homeBadge = session.work.overdueCount(session.userId) + session.todos.overdueCount()
    val chatBadge = session.chat.unreadCount
    NavigationBar(containerColor = Tokens.Palette.background, tonalElevation = 0.dp) {
        TabItem(navigator, Navigator.Tab.Home, "Für mich", Icons.Outlined.AccountCircle, homeBadge)
        TabItem(navigator, Navigator.Tab.Tasks, "Aufgaben", Icons.AutoMirrored.Outlined.FactCheck, 0)
        TabItem(navigator, Navigator.Tab.Projects, "Projekte", Icons.Outlined.Folder, 0)
        TabItem(navigator, Navigator.Tab.Chat, "Chat", Icons.AutoMirrored.Outlined.Chat, chatBadge)
        TabItem(navigator, Navigator.Tab.More, "Mehr", Icons.Outlined.GridView, 0)
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(navigator: Navigator, tab: Navigator.Tab, label: String, icon: ImageVector, badge: Int) {
    val selected = navigator.tab == tab
    NavigationBarItem(
        selected = selected,
        onClick = {
            if (selected) {
                // Tapping the active tab returns to its root (as on iOS).
                navigator.controllers[tab]?.let { nav -> while (nav.previousBackStackEntry != null) nav.popBackStack() }
            } else {
                navigator.tab = tab
            }
        },
        icon = {
            BadgedBox(badge = { if (badge > 0) Badge(containerColor = Tokens.Palette.destructive) { Text("$badge") } }) {
                Icon(icon, null)
            }
        },
        label = { Text(label, maxLines = 1) },
        modifier = Modifier.semantics { contentDescription = if (badge > 0) "$label, $badge" else label },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Tokens.Palette.accentBlue,
            selectedTextColor = Tokens.Palette.accentBlue,
            indicatorColor = Tokens.Palette.accentBlueSoft,
            unselectedIconColor = Tokens.Palette.mutedForeground,
            unselectedTextColor = Tokens.Palette.mutedForeground,
        ),
    )
}

/** Top-left avatar on every tab root: opens account, notifications and team settings. */
@Composable
fun AccountButton(session: SessionModel) {
    val navigator = navigator()
    IconButton(
        onClick = { navigator.showSettings = true },
        modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).semantics { contentDescription = "Konto und Einstellungen" },
    ) {
        Avatar(session.viewer.fullName, session.viewer.email, size = 30.dp)
    }
}

/** Resolves a task by id (also tasks of archived projects) and shows its details. */
@Composable
fun LinkedTaskSheet(session: SessionModel, taskId: String, onDismiss: () -> Unit) {
    var failure by remember { mutableStateOf<String?>(null) }
    val task = session.work.task(taskId)
    LaunchedEffect(taskId) {
        if (session.work.task(taskId) == null) {
            try {
                session.work.fetchTask(taskId)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                failure = e.userMessage.ifEmpty { "Die Aufgabe konnte nicht geladen werden." }
            }
        }
    }
    when {
        task != null -> TaskDetailView(session, taskId, onDismiss = onDismiss)
        else -> de.vistoo.work.ui.components.FullScreenSheet(onDismiss) {
            Scaffold(containerColor = Tokens.Palette.surfaceSubtle, topBar = {
                VistooTopBar("Aufgabe", navigationIcon = { BarButton("Schließen", onDismiss) })
            }) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    if (failure != null) {
                        EmptyState("Aufgabe nicht gefunden", Icons.Outlined.HelpOutline, failure)
                    } else {
                        LoadingView()
                    }
                }
            }
        }
    }
}

