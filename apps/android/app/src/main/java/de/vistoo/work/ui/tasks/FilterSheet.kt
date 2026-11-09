package de.vistoo.work.ui.tasks

import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import de.vistoo.work.core.generated.DomainDefaults
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.label
import de.vistoo.work.core.stores.TaskFilters
import de.vistoo.work.core.stores.WorkScope
import de.vistoo.work.core.stores.WorkStore
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.ListRow
import de.vistoo.work.ui.components.ProjectDot
import de.vistoo.work.ui.components.StatusIcon
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens

@Composable
fun FilterSheet(work: WorkStore, scope: WorkScope, filters: TaskFilters, onChange: (TaskFilters) -> Unit, onDismiss: () -> Unit) {
    fun flip(set: Set<String>, v: String) = if (v in set) set - v else set + v
    FormSheet(
        title = "Filter",
        onDismiss = { onChange(TaskFilters(query = filters.query)) },
        dismissLabel = "Zurücksetzen",
        dismissEnabled = filters.count > 0,
        confirmLabel = "Fertig",
        onConfirm = onDismiss,
    ) {
        androidx.activity.compose.BackHandler(onBack = onDismiss)
        GroupedList {
            if (scope == WorkScope.All) {
                section("projects", header = "Projekt") {
                    for (p in work.activeProjects) row(p.id) {
                        CheckRow(p.name, p.id in filters.projects, { onChange(filters.copy(projects = flip(filters.projects, p.id))) }) { ProjectDot(p.color) }
                    }
                }
            }
            section("people", header = "Person") {
                row("none") {
                    CheckRow("Nicht zugewiesen", DomainDefaults.unassigned in filters.assignees, {
                        onChange(filters.copy(assignees = flip(filters.assignees, DomainDefaults.unassigned)))
                    })
                }
                for (m in work.members) row(m.userId) {
                    CheckRow(m.displayName, m.userId in filters.assignees, { onChange(filters.copy(assignees = flip(filters.assignees, m.userId))) }) {
                        Avatar(m.fullName, m.email, size = 22.dp)
                    }
                }
            }
            section("status", header = "Status") {
                for (s in TaskStatus.knownCases) row(s.rawValue) {
                    CheckRow(s.label, s in filters.statuses, {
                        onChange(filters.copy(statuses = if (s in filters.statuses) filters.statuses - s else filters.statuses + s))
                    }) { StatusIcon(s) }
                }
            }
        }
    }
}

@Composable
fun CheckRow(title: String, checked: Boolean, onClick: () -> Unit, icon: (@Composable () -> Unit)? = null) {
    ListRow(
        modifier = Modifier.semantics { selected = checked },
        onClick = onClick,
        leading = icon,
        trailing = { if (checked) Icon(Icons.Filled.Check, null, tint = Tokens.Palette.accentBlue) },
    ) { Text(title) }
}

