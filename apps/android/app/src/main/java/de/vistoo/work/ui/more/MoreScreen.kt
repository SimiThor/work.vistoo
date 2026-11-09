package de.vistoo.work.ui.more

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import de.vistoo.work.core.generated.IdeaStatus
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.ui.app.AccountButton
import de.vistoo.work.ui.app.CrmRoute
import de.vistoo.work.ui.app.DecisionsRoute
import de.vistoo.work.ui.app.IdeasRoute
import de.vistoo.work.ui.app.MilestonesRoute
import de.vistoo.work.ui.app.TodosRoute
import de.vistoo.work.ui.components.ActionRow
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.NavRow
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.openUrl
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.crm.followUpOverdue
import de.vistoo.work.ui.generated.Tokens

/**
 * "Mehr": everything that is not needed every few minutes, one tap away.
 * Own to-dos live on the start tab; here they are listed again for completeness.
 */
@Composable
fun MoreScreen(session: SessionModel, nav: NavHostController) {
    val context = LocalContext.current
    fun count(n: Int, loaded: Boolean, suffix: String? = null): String? =
        if (!loaded || n <= 0) null else suffix?.let { "$n $it" } ?: "$n"

    val openTodos = session.todos.open.size.takeIf { it > 0 }?.toString()
    val overdue = if (session.crm.state == LoadState.Loaded) session.crm.attractions.count { it.followUpOverdue() }.takeIf { it > 0 }?.let { "$it überfällig" } else null

    Scaffold(
        containerColor = Tokens.Palette.surfaceSubtle,
        topBar = { VistooTopBar("Mehr", large = true, navigationIcon = { AccountButton(session) }) },
    ) { padding ->
        GroupedList(Modifier.fillMaxSize().padding(padding)) {
            section("todos", footer = "Private Checkliste – nur du siehst sie.") {
                row { NavRow("Meine To-dos", { nav.navigate(TodosRoute) }, icon = { RowIcon(Icons.Outlined.Checklist) }, detail = openTodos) }
            }
            section("team", header = "Team") {
                row("m") {
                    NavRow("Meilensteine", { nav.navigate(MilestonesRoute) }, icon = { RowIcon(Icons.Outlined.Flag) },
                        detail = count(session.milestones.open.size, session.milestones.state == LoadState.Loaded))
                }
                row("i") {
                    NavRow("Ideen", { nav.navigate(IdeasRoute) }, icon = { RowIcon(Icons.Outlined.Lightbulb) },
                        detail = count(session.ideas.ideas.count { it.status == IdeaStatus.New }, session.ideas.state == LoadState.Loaded, "neu"))
                }
                row("d") { NavRow("Entscheidungen", { nav.navigate(DecisionsRoute) }, icon = { RowIcon(Icons.Outlined.Verified) }) }
                row("c") { NavRow("CRM", { nav.navigate(CrmRoute) }, icon = { RowIcon(Icons.Outlined.Apartment) }, detail = overdue) }
            }
            val link = session.viewer.meetingUrl
            if (!link.isNullOrBlank()) {
                section("meeting", footer = "Öffnet den Sprachkanal des Teams.") {
                    row { ActionRow("Besprechung beitreten", icon = { Icon(Icons.Outlined.Headphones, null) }, onClick = { openUrl(context, link) }) }
                }
            }
        }
    }
}

@Composable
fun RowIcon(icon: ImageVector) = Icon(icon, null, tint = Tokens.Palette.accentBlue)
