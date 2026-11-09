// Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand.
@file:Suppress("unused", "ktlint")

package de.vistoo.work.ui.generated

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Vistoo design tokens for Android (base values + explicit Android overrides). */
object Tokens {
  object Palette {
    /** Page and card background */
    val background = Color(0xFFFFFFFF)
    /** Android override: The Android app mirrors the iOS screen layout (grouped lists); same grouped background as iOS so both apps look alike. */
    val surfaceSubtle = Color(0xFFF2F2F7)
    /** Hover/pressed on subtle surfaces */
    val surfaceSunken = Color(0xFFECECF0)
    /** Primary text */
    val foreground = Color(0xFF1D1D1F)
    /** Secondary text (5.0:1 on white) */
    val mutedForeground = Color(0xFF6E6E73)
    val border = Color(0xFFE3E3E8)
    val borderStrong = Color(0xFFD1D1D6)
    val input = Color(0xFFD1D1D6)
    /** Interaction accent (4.7:1 with white text) */
    val accentBlue = Color(0xFF0071E3)
    val accentBlueHover = Color(0xFF0062C4)
    /** Selected / in-progress backgrounds */
    val accentBlueSoft = Color(0xFFE8F1FC)
    /** Accent as text on white (6.6:1) */
    val accentBlueText = Color(0xFF0058B0)
    /** Logo accent (navy stroke of the V); only for the brand mark */
    val brand = Color(0xFF1E185C)
    /** Status icon colour; text stays neutral */
    val statusOpen = Color(0xFF8E8E93)
    val statusProgress = Color(0xFF0071E3)
    val statusReview = Color(0xFFB86E00)
    val statusDone = Color(0xFF248A3D)
    val destructive = Color(0xFFD70015)
    val warningBg = Color(0xFFFFF6E5)
    val warningFg = Color(0xFF7A4A00)
    /** Timeline bar fill per status */
    val timelineOpenBg = Color(0xFFF0F1F4)
    val timelineOpenBorder = Color(0xFFD6D8DE)
    val timelineReviewBg = Color(0xFFFBF2E3)
    val timelineReviewBorder = Color(0xFFEAD3AB)
    val timelineProgressBorder = Color(0xFFB9D3F3)
  }

  object Radius {
    /** px/pt. Web derives sm/md/lg/xl from --radius; iOS uses the named steps. */
    val base = 8.dp
    val sm = 4.dp
    val md = 6.dp
    /** Android override: Same touch-sized card and button corners as the iOS app. */
    val lg = 10.dp
    val xl = 12.dp
  }

  object Spacing {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
  }

  /** Same shadow parameters as iOS (opacity, blur radius, y offset in dp). */
  data class Shadow(val opacity: Float, val radius: Float, val y: Float) {
    companion object {
      val card = Shadow(opacity = 0.06f, radius = 2f, y = 1f)
      val raised = Shadow(opacity = 0.1f, radius = 12f, y = 4f)
      val overlay = Shadow(opacity = 0.14f, radius = 24f, y = 8f)
    }
  }

  /** Semantic text roles (sp: they scale with the system font size). */
  object Typography {
    val pageTitle = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold)
    val sectionTitle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    val dense = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
  }
}
