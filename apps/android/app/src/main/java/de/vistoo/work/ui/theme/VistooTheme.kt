package de.vistoo.work.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import de.vistoo.work.ui.generated.Tokens

/**
 * Material 3 as the technical base, coloured and sized from the generated Vistoo tokens.
 * Light appearance only, like the web and iOS (the tokens define no dark palette yet).
 */
private val VistooColors = lightColorScheme(
    primary = Tokens.Palette.accentBlue,
    onPrimary = Color.White,
    primaryContainer = Tokens.Palette.accentBlueSoft,
    onPrimaryContainer = Tokens.Palette.accentBlueText,
    secondary = Tokens.Palette.mutedForeground,
    onSecondary = Color.White,
    secondaryContainer = Tokens.Palette.surfaceSunken,
    onSecondaryContainer = Tokens.Palette.foreground,
    tertiary = Tokens.Palette.brand,
    background = Tokens.Palette.surfaceSubtle,
    onBackground = Tokens.Palette.foreground,
    surface = Tokens.Palette.background,
    onSurface = Tokens.Palette.foreground,
    surfaceVariant = Tokens.Palette.surfaceSubtle,
    onSurfaceVariant = Tokens.Palette.mutedForeground,
    surfaceContainerLowest = Tokens.Palette.background,
    surfaceContainerLow = Tokens.Palette.background,
    surfaceContainer = Tokens.Palette.background,
    surfaceContainerHigh = Tokens.Palette.background,
    surfaceContainerHighest = Tokens.Palette.surfaceSunken,
    surfaceTint = Color.Transparent,
    outline = Tokens.Palette.borderStrong,
    outlineVariant = Tokens.Palette.border,
    error = Tokens.Palette.destructive,
    onError = Color.White,
)

/** Semantic text roles: Tokens.Typography plus the iOS text styles the screens use. */
object VType {
    val pageTitle = Tokens.Typography.pageTitle
    val sectionTitle = Tokens.Typography.sectionTitle
    val body = Tokens.Typography.body
    val dense = Tokens.Typography.dense
    val caption = Tokens.Typography.caption
    val headline = Tokens.Typography.sectionTitle
    val callout = TextStyle(fontSize = 16.sp, lineHeight = 21.sp)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val caption2 = TextStyle(fontSize = 11.sp, lineHeight = 13.sp)
    val title3 = TextStyle(fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
    val sectionHeader = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
}

private val VistooTypography = Typography(
    titleLarge = Tokens.Typography.pageTitle,
    titleMedium = Tokens.Typography.sectionTitle,
    titleSmall = VType.footnote.copy(fontWeight = FontWeight.SemiBold),
    bodyLarge = Tokens.Typography.body,
    bodyMedium = Tokens.Typography.dense,
    bodySmall = Tokens.Typography.caption,
    labelLarge = Tokens.Typography.dense.copy(fontWeight = FontWeight.Medium),
    labelMedium = Tokens.Typography.caption.copy(fontWeight = FontWeight.Medium),
    labelSmall = VType.caption2.copy(fontWeight = FontWeight.Medium),
)

@Composable
fun VistooTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = VistooColors, typography = VistooTypography, content = content)
}
