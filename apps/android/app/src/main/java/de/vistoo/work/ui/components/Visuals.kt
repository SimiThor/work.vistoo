package de.vistoo.work.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.vistoo.work.core.generated.ChatPerson
import de.vistoo.work.core.generated.Member
import de.vistoo.work.core.generated.ProjectColorDefinition
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.generated.Viewer
import de.vistoo.work.core.generated.label
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType

// MARK: Status

/** Icon colour (text stays neutral; shape + label carry the meaning). */
val TaskStatus.tint: Color
    get() = when (this) {
        TaskStatus.Open -> Tokens.Palette.statusOpen
        TaskStatus.InProgress -> Tokens.Palette.statusProgress
        TaskStatus.InReview -> Tokens.Palette.statusReview
        TaskStatus.Done -> Tokens.Palette.statusDone
        is TaskStatus.Unknown -> Tokens.Palette.mutedForeground
    }

/** Next status for the "advance" swipe action. */
val TaskStatus.next: TaskStatus?
    get() = when (this) {
        TaskStatus.Open -> TaskStatus.InProgress
        TaskStatus.InProgress -> TaskStatus.InReview
        TaskStatus.InReview -> TaskStatus.Done
        else -> null
    }

/** Status glyph distinguishable by shape (empty, half, three-quarter, check) — same as web and iOS. */
@Composable
fun StatusIcon(status: TaskStatus, size: Dp = 16.dp, modifier: Modifier = Modifier) {
    val tint = status.tint
    Canvas(modifier.size(size)) {
        val s = this.size.minDimension
        val stroke = s * 0.1f
        drawCircle(tint, radius = (s - stroke) / 2, style = Stroke(stroke))
        val inset = s * 0.2f
        val arcSize = Size(s - 2 * inset, s - 2 * inset)
        when (status) {
            TaskStatus.InProgress -> drawArc(tint, -90f, 180f, true, topLeft = Offset(inset, inset), size = arcSize)
            TaskStatus.InReview -> drawArc(tint, -90f, 270f, true, topLeft = Offset(inset, inset), size = arcSize)
            TaskStatus.Done -> {
                drawCircle(tint, radius = s / 2)
                // Check mark.
                val p = androidx.compose.ui.graphics.Path().apply {
                    moveTo(s * 0.28f, s * 0.52f)
                    lineTo(s * 0.44f, s * 0.67f)
                    lineTo(s * 0.72f, s * 0.36f)
                }
                drawPath(p, Color.White, style = Stroke(width = s * 0.12f, cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
            }
            else -> Unit
        }
    }
}

@Composable
fun StatusLabel(status: TaskStatus, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusIcon(status)
        Text(status.label)
    }
}

/** Small coloured dot for statuses (text stays neutral, as on the web). */
@Composable
fun StatusDot(hex: Long, size: Dp = 8.dp) {
    Box(Modifier.size(size).background(Color(0xFF000000 or hex), CircleShape))
}

/** Label with the status dot in front. */
@Composable
fun DotLabel(text: String, hex: Long, modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        StatusDot(hex)
        Text(text, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun ProjectDot(colorKey: String, size: Dp = 8.dp) {
    StatusDot(ProjectColorDefinition.forKey(colorKey).hex, size)
}

fun colorOf(hex: Long): Color = Color(0xFF000000 or hex)

// MARK: People

/** Display name rules of the web (`displayName`, `initials`). */
object PersonName {
    fun display(fullName: String?, email: String): String {
        val n = fullName?.trim()
        if (!n.isNullOrEmpty()) return n
        return email.substringBefore('@')
    }

    fun initials(fullName: String?, email: String): String {
        val name = display(fullName, email)
        val parts = name.split(' ', '.', '_', '-').filter { it.isNotEmpty() }
        val letters = if (parts.size >= 2) "${parts[0].take(1)}${parts[1].take(1)}" else name.take(2)
        return letters.uppercase()
    }
}

val Member.displayName: String get() = PersonName.display(fullName, email)
val ChatPerson.displayName: String get() = PersonName.display(fullName, email)
val Viewer.displayName: String get() = PersonName.display(fullName, email)

@Composable
fun Avatar(fullName: String?, email: String?, size: Dp = 28.dp, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size).background(Tokens.Palette.surfaceSunken, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (email != null) {
            Text(
                PersonName.initials(fullName, email),
                fontSize = (size.value * 0.38f).sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Palette.foreground,
                maxLines = 1,
            )
        } else {
            Icon(Icons.Outlined.Person, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(size * 0.55f))
        }
    }
}

// MARK: Brand

/** Vistoo logo: a "V" from a black and a navy stroke, followed by "istoo". Same vector paths as web and iOS. */
object BrandPaths {
    const val markBlack = "M164.2 265C161.7 260.7 161.7 255.4 164.2 251C166.7 246.7 171.3 244 176.3 244L313 244C327.2 244 340.4 251.6 347.6 263.9L572.7 652.2C578.4 661.9 578.1 673.9 572.1 683.4L516 771.1C509.6 781.1 498.5 787 486.7 786.7C474.8 786.5 463.9 780.1 458 769.8Z"
    const val markNavy = "M653.4 268.2C662.5 253.2 678.7 244 696.2 244L840.8 244C845.9 244 850.6 246.8 853 251.2C855.5 255.7 855.4 261.1 852.7 265.4L700.8 509.2C693.5 520.9 680.7 528 666.9 528L588.7 528C569.9 528 552.6 517.9 543.4 501.6C534.2 485.2 534.5 465.2 544.2 449.1Z"
    const val letters = "M596.9 249.7C589.6 249.1 580.7 247 574.5 244.3C546.3 232.2 530 206.9 530 175.2C530 171 530.4 165.3 530.9 162.2C533.8 144.8 540.1 132.3 552.3 120C560.6 111.5 572.7 104.8 585.2 101.6C591.4 100.1 600.7 99.4 606.5 100C621.5 101.6 627.7 103.3 638.5 108.8C647.1 113.1 659.4 124 663.9 131.4C681.5 159.6 680.8 195.2 662.3 221.1C652.6 234.6 634.6 245.6 617 248.8C612.3 249.6 601.5 250.1 596.9 249.7ZM746 249.6C726.6 247.5 711 239.3 699.1 225C688.1 211.8 682.7 198.5 681.4 181.2C679.8 161.1 685.1 143.2 697.7 126.3C705.4 115.9 718.5 107.1 732.8 102.5C741.9 99.7 758.5 99.2 769.5 101.5C777.6 103.2 788.1 107.6 794 111.7C804.5 119 807.9 122 812.2 128.1C813.3 129.7 815.1 132.1 816.2 133.4C819.7 137.6 823.7 145.5 825.5 152C831 171.3 829.6 189.9 821.6 207.9C819.4 212.8 810.3 225.4 806.2 229.1C795.1 239.4 782.2 246.2 769.6 248.3C760.8 249.9 752.5 250.3 746 249.6ZM363.2 249.2C350.7 247.9 337.5 243.3 328 236.9C322.3 233 320.9 231.9 317.3 228.1C311.7 222.2 311.7 221.5 316.6 215.2C317.9 213.7 319.8 211.2 320.8 209.7C321.9 208.3 323.5 206.2 324.4 205.2C325.2 204.1 326.3 202.8 326.8 202.1C328.5 199.6 330.2 199.5 333 202.1C344.1 212.5 358.1 218.5 371.2 218.5C383.2 218.6 390 216 393.9 210.2C399 202.4 394.9 195.2 383.4 191.6C381.7 191.1 378.8 190.2 376.9 189.6C372.6 188.3 371.4 188 362 185.6C343.4 180.9 333.8 176.3 326.6 169C321.3 163.4 318.6 158.5 317 151.1C314.8 140.8 317.3 127.8 323 120.3C331.2 109.6 345 102.4 360.9 100.5C372.4 99.2 378 99.4 390.5 101.8C400.3 103.6 413.4 109.7 420.9 115.9C425.9 120 425.8 120.5 416.8 134.5C410.9 143.7 410.4 144 406.7 141.3C394.5 132.3 378.6 127.4 366.4 128.9C354.8 130.2 348 138 351.7 145.8C354 150.8 357.8 152.3 384.9 158.8C397.8 162 407.3 165.5 413 169.3C426.2 178.1 432.8 194.3 429.5 210.2C427 222.3 422 230.2 411.8 237.8C399.9 246.8 381.4 251.2 363.2 249.2ZM492.5 249.6C479.5 248.2 469.3 243.6 461.1 235.4C450.4 224.7 445.2 211.5 444.5 193.4C444.1 183.1 444.2 68.8 444.6 67.7C445.7 64.7 445.5 64.7 461.2 64.7C475.6 64.6 475.4 64.6 476.8 66C478.6 67.6 478.5 66.6 478.5 85.5C478.5 102.5 478.5 102.5 479.1 102.9C479.7 103.4 480.4 103.4 498.5 103.5C522.3 103.5 521.9 103.5 523.3 105.9C524.1 107.3 524.4 128 523.5 129.7C522.1 132.4 523.4 132.3 500.2 132.4C478.4 132.5 479.1 132.5 478.7 133.3C478.2 134.2 478.4 197.3 478.9 200.6C480.2 209 486.8 216.2 494.6 217.8C501 219.1 507.8 217.6 514.4 213.5C520.3 209.8 521.1 210.5 528.2 225.6C528.9 227.1 530.1 229.6 530.9 231C533.3 235.7 532.6 236.9 524.5 242.1C515.7 247.7 503 250.7 492.5 249.6ZM264.9 248C262.9 247.6 261.5 246.2 261 244.5C260.8 243.9 260.8 237.1 260.8 225.1C260.8 214.9 260.8 184.1 260.8 156.7C260.7 106.7 260.7 106.7 261.3 105.5C262.4 103.3 261.8 103.4 278.1 103.5C294.1 103.5 293.7 103.5 295.1 105.4C295.8 106.2 295.9 106.5 296.1 109.5C296.4 114.8 296.1 244.2 295.8 245.1C295.3 246.4 294 247.5 292.6 247.9C291.3 248.3 266.4 248.4 264.9 248ZM607.9 217C618.5 215.6 628.7 209.4 634.2 201.2C639.2 193.7 641.3 188.5 642.1 180.9C645.4 152.5 626.9 130 601.4 131.3C594.2 131.7 585.5 134.7 580.9 138.4C572.5 145.1 567.4 153.2 564.9 164.2C563 172.5 563.2 178.3 565.8 188.4C567.3 194.5 572 202.4 576.6 206.5C585.6 214.6 597.2 218.4 607.9 217ZM762 216.5C785.9 211.5 799.1 186.2 791.7 159.9C789.4 151.6 780.6 140 774.1 136.6C763.4 131 752.4 129.8 742.4 133.2C724.1 139.2 712.5 159.5 715.3 180.9C717.8 200.7 731.4 214.7 750.5 217.1C752.7 217.4 759.4 217 762 216.5ZM273.8 86.7C265 84.9 258.7 77.2 258.1 67.6C257.7 61 259.4 56.5 264.4 51.6C272.3 43.6 285.2 44.1 293.7 52.7C301.2 60.3 299.8 77 291.2 82.8C286.3 86.1 278.8 87.8 273.8 86.7Z"
    const val boxX = 40f
    const val boxY = 42f
    const val boxW = 792f
    const val boxH = 212f
}

/** The full wordmark "Vistoo". */
@Composable
fun BrandMark(height: Dp = 30.dp, modifier: Modifier = Modifier) {
    val paths = remember {
        Triple(
            PathParser().parsePathString(BrandPaths.markBlack).toPath(),
            PathParser().parsePathString(BrandPaths.markNavy).toPath(),
            PathParser().parsePathString(BrandPaths.letters).toPath().apply { fillType = PathFillType.EvenOdd },
        )
    }
    val width = height * (BrandPaths.boxW / BrandPaths.boxH)
    Canvas(modifier.size(width, height).semantics { contentDescription = "Vistoo Work" }) {
        val s = size.height / BrandPaths.boxH
        scale(s, s, pivot = Offset.Zero) {
            translate(-BrandPaths.boxX, -BrandPaths.boxY) {
                // The mark sits inside the wordmark (same transform as iOS: translate 42/97, scale 0.2757, translate -156/-244).
                translate(42f, 97f) {
                    scale(0.2757f, 0.2757f, pivot = Offset.Zero) {
                        translate(-156f, -244f) {
                            drawPath(paths.first, Tokens.Palette.foreground)
                            drawPath(paths.second, Tokens.Palette.brand)
                        }
                    }
                }
                drawPath(paths.third, Tokens.Palette.foreground)
            }
        }
    }
}

@Composable
fun MutedText(text: String, modifier: Modifier = Modifier, style: androidx.compose.ui.text.TextStyle = VType.caption, maxLines: Int = Int.MAX_VALUE) {
    Text(text, modifier, color = Tokens.Palette.mutedForeground, style = style, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
