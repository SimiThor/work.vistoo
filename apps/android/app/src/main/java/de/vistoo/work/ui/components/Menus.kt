package de.vistoo.work.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

/** Entries of a long-press menu (iOS context menu); submenus open in place. */
sealed interface MenuEntry {
    data class Item(
        val label: String,
        val icon: ImageVector? = null,
        val destructive: Boolean = false,
        val checked: Boolean = false,
        val enabled: Boolean = true,
        val onClick: () -> Unit,
    ) : MenuEntry

    data class Submenu(val label: String, val icon: ImageVector? = null, val entries: List<MenuEntry>) : MenuEntry
    data class Header(val label: String) : MenuEntry
    data object Divider : MenuEntry
}

/** Dropdown with submenu support. */
@Composable
fun EntryMenu(expanded: Boolean, onDismiss: () -> Unit, entries: List<MenuEntry>) {
    var submenu by remember { mutableStateOf<MenuEntry.Submenu?>(null) }
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = {
            submenu = null
            onDismiss()
        },
        containerColor = Tokens.Palette.background,
    ) {
        val current = submenu
        if (current != null) {
            DropdownMenuItem(
                text = { Text(current.label, fontWeight = FontWeight.SemiBold) },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") },
                onClick = { submenu = null },
            )
            HorizontalDivider(color = Tokens.Palette.border)
        }
        for (entry in current?.entries ?: entries) {
            when (entry) {
                is MenuEntry.Item -> DropdownMenuItem(
                    text = { Text(entry.label, color = if (entry.destructive) Tokens.Palette.destructive else Tokens.Palette.foreground) },
                    leadingIcon = (if (entry.checked) Icons.Filled.Check else entry.icon)?.let { icon ->
                        { Icon(icon, null, tint = if (entry.destructive) Tokens.Palette.destructive else Tokens.Palette.foreground) }
                    },
                    enabled = entry.enabled,
                    onClick = {
                        submenu = null
                        onDismiss()
                        entry.onClick()
                    },
                )
                is MenuEntry.Submenu -> DropdownMenuItem(
                    text = { Text(entry.label) },
                    leadingIcon = entry.icon?.let { { Icon(it, null) } },
                    trailingIcon = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) },
                    onClick = { submenu = entry },
                )
                is MenuEntry.Header -> Text(
                    entry.label.uppercase(Formatting.locale),
                    style = VType.caption2,
                    color = Tokens.Palette.mutedForeground,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                )
                MenuEntry.Divider -> HorizontalDivider(color = Tokens.Palette.border)
            }
        }
    }
}

/**
 * Tap + long-press target: long press opens the menu (with a haptic tick), the menu
 * entries are also exposed as accessibility actions (TalkBack).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MenuTarget(
    entries: () -> List<MenuEntry>,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    /** TalkBack hint for the tap (iOS `accessibilityHint`). */
    onClickLabel: String? = null,
    content: @Composable () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Box(
        modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { onClick?.invoke() },
                onClickLabel = onClickLabel,
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    open = true
                },
                onLongClickLabel = "Aktionen",
            )
            .semantics {
                customActions = entries().flatMap { flattenForAccessibility(it) }
            },
    ) {
        content()
        EntryMenu(open, { open = false }, if (open) entries() else emptyList())
    }
}

private fun flattenForAccessibility(entry: MenuEntry): List<CustomAccessibilityAction> = when (entry) {
    is MenuEntry.Item -> if (entry.enabled) listOf(CustomAccessibilityAction(entry.label) { entry.onClick(); true }) else emptyList()
    is MenuEntry.Submenu -> entry.entries.flatMap { e ->
        flattenForAccessibility(e).map { CustomAccessibilityAction("${entry.label}: ${it.label}", it.action) }
    }
    else -> emptyList()
}

/** Toolbar overflow-style menu button with an arbitrary icon. */
@Composable
fun MenuButton(icon: ImageVector, contentDescription: String, entries: () -> List<MenuEntry>, badge: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    Box {
        androidx.compose.material3.IconButton(onClick = { open = true }) {
            Box {
                Icon(icon, contentDescription, tint = Tokens.Palette.accentBlue)
                if (badge) Box(Modifier.size(7.dp).background(Tokens.Palette.accentBlue, androidx.compose.foundation.shape.CircleShape).align(androidx.compose.ui.Alignment.TopEnd))
            }
        }
        EntryMenu(open, { open = false }, if (open) entries() else emptyList())
    }
}
