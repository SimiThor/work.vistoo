package de.vistoo.work.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

/*
 * iOS-style lists in Compose: "grouped" (white rounded sections on the subtle
 * background, like `.insetGrouped`) and "plain" (full-width rows with dividers).
 * Sections are built inside LazyColumn content so long lists stay lazy.
 */

/** Grouped list container (iOS `.insetGrouped`). */
@Composable
fun GroupedList(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(bottom = 24.dp),
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        modifier.fillMaxSize().background(Tokens.Palette.surfaceSubtle),
        state = state,
        contentPadding = contentPadding,
        content = content,
    )
}

/** Plain list container (iOS `.plain`): white background, full-width rows. */
@Composable
fun PlainList(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(bottom = 24.dp),
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(modifier.fillMaxSize().background(Tokens.Palette.background), state = state, contentPadding = contentPadding, content = content)
}

/** Collects the rows of a section (non-composable builder, executed inside LazyColumn content). */
class SectionScope {
    internal val rows = mutableListOf<Pair<Any?, @Composable () -> Unit>>()

    fun row(key: Any? = null, content: @Composable () -> Unit) {
        rows += key to content
    }
}

/**
 * One section of a grouped list: header, rows in a rounded white card, footer.
 * `expanded`/`onToggle` make the header a disclosure (iOS `Section(isExpanded:)`).
 */
fun LazyListScope.section(
    key: String,
    header: String? = null,
    headerTrailing: String? = null,
    headerColor: Color? = null,
    footer: String? = null,
    footerContent: (@Composable () -> Unit)? = null,
    expanded: Boolean = true,
    onToggle: (() -> Unit)? = null,
    plain: Boolean = false,
    build: SectionScope.() -> Unit,
) {
    val scope = SectionScope().apply(build)
    if (header != null) {
        item(key = "$key-header") {
            SectionHeader(header, headerTrailing, headerColor, expanded, onToggle, plain)
        }
    } else if (!plain) {
        item(key = "$key-gap") { Spacer(Modifier.padding(top = 18.dp)) }
    }
    if (expanded) {
        val count = scope.rows.size
        scope.rows.forEachIndexed { index, (rowKey, content) ->
            item(key = rowKey?.let { "$key-$it" }) {
                SectionRowContainer(first = index == 0, last = index == count - 1, plain = plain) { content() }
            }
        }
    }
    if (footer != null || footerContent != null) {
        item(key = "$key-footer") {
            Box(Modifier.fillMaxWidth().padding(horizontal = if (plain) 16.dp else 32.dp, vertical = 6.dp)) {
                CompositionLocalProvider(LocalContentColor provides Tokens.Palette.mutedForeground) {
                    ProvideTextStyle(VType.footnote.copy(color = Tokens.Palette.mutedForeground)) {
                        if (footerContent != null) footerContent() else Text(footer!!)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(
    title: String,
    trailing: String?,
    color: Color?,
    expanded: Boolean,
    onToggle: (() -> Unit)?,
    plain: Boolean,
) {
    val rotation = animateFloatAsState(if (expanded) 0f else -90f, label = "disclosure")
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (plain) Modifier.background(Tokens.Palette.surfaceSubtle) else Modifier)
            .then(if (onToggle != null) Modifier.clickable(onClick = onToggle) else Modifier)
            .padding(start = if (plain) 16.dp else 32.dp, end = if (plain) 16.dp else 32.dp, top = if (plain) 8.dp else 22.dp, bottom = 6.dp)
            .semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val c = color ?: Tokens.Palette.mutedForeground
        Text(title.uppercase(Formatting.locale), style = VType.sectionHeader, color = c, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = VType.sectionHeader, color = c)
        if (onToggle != null) {
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = if (expanded) "Einklappen" else "Ausklappen",
                tint = Tokens.Palette.accentBlue,
                modifier = Modifier.size(20.dp).rotate(rotation.value),
            )
        }
    }
}

@Composable
private fun SectionRowContainer(first: Boolean, last: Boolean, plain: Boolean, content: @Composable () -> Unit) {
    val r = Tokens.Radius.lg
    val shape = when {
        plain -> RoundedCornerShape(0.dp)
        first && last -> RoundedCornerShape(r)
        first -> RoundedCornerShape(topStart = r, topEnd = r)
        last -> RoundedCornerShape(bottomStart = r, bottomEnd = r)
        else -> RoundedCornerShape(0.dp)
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = if (plain) 0.dp else 16.dp)
            .clip(shape)
            .background(Tokens.Palette.background),
    ) {
        if (!first) HorizontalDivider(Modifier.padding(start = 16.dp), color = Tokens.Palette.border)
        content()
    }
}

/**
 * Standard row: optional leading icon, content, trailing content. Min height 48dp
 * (touch target), padding like iOS list rows.
 */
@Composable
fun ListRow(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    verticalAlignment: Alignment.Vertical = Alignment.CenterVertically,
    content: @Composable () -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = verticalAlignment,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (leading != null) leading()
        Box(Modifier.weight(1f)) {
            ProvideTextStyle(VType.body.copy(color = if (enabled) Tokens.Palette.foreground else Tokens.Palette.mutedForeground)) { content() }
        }
        if (trailing != null) trailing()
    }
}

/** Row that navigates (title, optional detail, chevron). */
@Composable
fun NavRow(
    title: String,
    onClick: () -> Unit,
    icon: (@Composable () -> Unit)? = null,
    detail: String? = null,
) {
    ListRow(onClick = onClick, leading = icon, trailing = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (detail != null) Text(detail, color = Tokens.Palette.mutedForeground, style = VType.body)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Tokens.Palette.borderStrong)
        }
    }) { Text(title) }
}

/** iOS `LabeledContent`: label left, value right. */
@Composable
fun LabeledRow(label: String, value: String) {
    ListRow(trailing = { Text(value, color = Tokens.Palette.mutedForeground, style = VType.body, modifier = Modifier.padding(start = 8.dp)) }) {
        Text(label)
    }
}

/** Accent-coloured (or destructive) action row. */
@Composable
fun ActionRow(
    title: String,
    onClick: () -> Unit,
    icon: (@Composable () -> Unit)? = null,
    destructive: Boolean = false,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val color = when {
        !enabled -> Tokens.Palette.borderStrong
        destructive -> Tokens.Palette.destructive
        else -> Tokens.Palette.accentBlue
    }
    ListRow(onClick = onClick, enabled = enabled && !busy, leading = icon?.let { { CompositionLocalProvider(LocalContentColor provides color) { it() } } }, trailing = {
        if (busy) SmallProgress()
    }) {
        Text(title, color = color)
    }
}

/** Plain-list row helper with a divider below (iOS `.plain` rows). */
@Composable
fun PlainRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().background(Tokens.Palette.background)) {
        content()
        HorizontalDivider(Modifier.padding(start = 16.dp), color = Tokens.Palette.border)
    }
}

@Composable
fun SectionCaption(text: String, color: Color = Tokens.Palette.mutedForeground) {
    Text(text, style = VType.footnote, color = color, modifier = Modifier.padding(horizontal = 32.dp, vertical = 6.dp))
}

@Composable
fun Bold(text: String, modifier: Modifier = Modifier) = Text(text, modifier, fontWeight = FontWeight.SemiBold)

@Composable
fun HSpace(width: androidx.compose.ui.unit.Dp) = Spacer(Modifier.width(width))
