// Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand.
// swiftlint:disable all
import SwiftUI

/// Vistoo design tokens for iOS (base values + explicit iOS overrides).
public enum Tokens {
  public enum Palette {
    /// Page and card background
    public static let background = Color(hex: 0xFFFFFF)
    /// iOS override: Matches iOS grouped list backgrounds (systemGroupedBackground) so native lists and custom surfaces blend.
    public static let surfaceSubtle = Color(hex: 0xF2F2F7)
    /// Hover/pressed on subtle surfaces
    public static let surfaceSunken = Color(hex: 0xECECF0)
    /// Primary text
    public static let foreground = Color(hex: 0x1D1D1F)
    /// Secondary text (5.0:1 on white)
    public static let mutedForeground = Color(hex: 0x6E6E73)
    public static let border = Color(hex: 0xE3E3E8)
    public static let borderStrong = Color(hex: 0xD1D1D6)
    public static let input = Color(hex: 0xD1D1D6)
    /// Interaction accent (4.7:1 with white text)
    public static let accentBlue = Color(hex: 0x0071E3)
    public static let accentBlueHover = Color(hex: 0x0062C4)
    /// Selected / in-progress backgrounds
    public static let accentBlueSoft = Color(hex: 0xE8F1FC)
    /// Accent as text on white (6.6:1)
    public static let accentBlueText = Color(hex: 0x0058B0)
    /// Logo accent (navy stroke of the V); only for the brand mark
    public static let brand = Color(hex: 0x1E185C)
    /// Status icon colour; text stays neutral
    public static let statusOpen = Color(hex: 0x8E8E93)
    public static let statusProgress = Color(hex: 0x0071E3)
    public static let statusReview = Color(hex: 0xB86E00)
    public static let statusDone = Color(hex: 0x248A3D)
    public static let destructive = Color(hex: 0xD70015)
    public static let warningBg = Color(hex: 0xFFF6E5)
    public static let warningFg = Color(hex: 0x7A4A00)
    /// Timeline bar fill per status
    public static let timelineOpenBg = Color(hex: 0xF0F1F4)
    public static let timelineOpenBorder = Color(hex: 0xD6D8DE)
    public static let timelineReviewBg = Color(hex: 0xFBF2E3)
    public static let timelineReviewBorder = Color(hex: 0xEAD3AB)
    public static let timelineProgressBorder = Color(hex: 0xB9D3F3)
  }

  public enum Radius {
    /// px/pt. Web derives sm/md/lg/xl from --radius; iOS uses the named steps.
    public static let base: CGFloat = 8
    public static let sm: CGFloat = 4
    public static let md: CGFloat = 6
    /// iOS override: Touch-sized cards and buttons read better with slightly rounder corners on iPhone.
    public static let lg: CGFloat = 10
    public static let xl: CGFloat = 12
  }

  public enum Spacing {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32
  }

  public struct Shadow: Sendable {
    public let opacity: Double
    public let radius: CGFloat
    public let y: CGFloat
    public static let card = Shadow(opacity: 0.06, radius: 2, y: 1)
    public static let raised = Shadow(opacity: 0.1, radius: 12, y: 4)
    public static let overlay = Shadow(opacity: 0.14, radius: 24, y: 8)
  }

  /// Semantic text roles mapped to Dynamic Type styles.
  public enum Typography {
    public static let pageTitle: Font = .system(.title2, weight: .semibold)
    public static let sectionTitle: Font = .system(.headline, weight: .semibold)
    public static let body: Font = .system(.body, weight: .regular)
    public static let dense: Font = .system(.subheadline, weight: .regular)
    public static let caption: Font = .system(.caption, weight: .regular)
  }
}
