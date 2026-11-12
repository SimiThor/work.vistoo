// Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand.
// swiftlint:disable all
import SwiftUI

/// Vistoo design tokens for iOS (base values + explicit iOS overrides).
/// Colours adapt to the system appearance (light/dark).
public enum Tokens {
  public enum Palette {
    /// Page and card background
    public static let background = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
    /// iOS override: Matches iOS grouped list backgrounds (systemGroupedBackground, black in dark mode) so native lists and custom surfaces blend.
    public static let surfaceSubtle = Color(light: 0xF2F2F7, dark: 0x000000)
    /// Hover/pressed on subtle surfaces
    public static let surfaceSunken = Color(light: 0xECECF0, dark: 0x2A2A2D)
    /// Primary text
    public static let foreground = Color(light: 0x1D1D1F, dark: 0xF5F5F7)
    /// Secondary text (5.0:1 on white)
    public static let mutedForeground = Color(light: 0x6E6E73, dark: 0x98989F)
    public static let border = Color(light: 0xE3E3E8, dark: 0x2F2F33)
    public static let borderStrong = Color(light: 0xD1D1D6, dark: 0x3D3D42)
    public static let input = Color(light: 0xD1D1D6, dark: 0x3D3D42)
    /// Interaction accent (4.7:1 with white text)
    public static let accentBlue = Color(hex: 0x0071E3)
    public static let accentBlueHover = Color(light: 0x0062C4, dark: 0x1A82F0)
    /// Selected / in-progress backgrounds
    public static let accentBlueSoft = Color(light: 0xE8F1FC, dark: 0x11294A)
    /// Accent as text on white (6.6:1)
    public static let accentBlueText = Color(light: 0x0058B0, dark: 0x5AA9FF)
    /// Logo accent (navy stroke of the V); only for the brand mark
    public static let brand = Color(light: 0x1E185C, dark: 0xA9A4F2)
    /// Popovers, menus, dialogs (lifted above the page in dark mode)
    public static let elevated = Color(light: 0xFFFFFF, dark: 0x2C2C2E)
    /// Backlog icon (dashed circle); text stays neutral
    public static let statusBacklog = Color(light: 0xAEAEB2, dark: 0x6E6E73)
    /// Status icon colour; text stays neutral
    public static let statusOpen = Color(hex: 0x8E8E93)
    public static let statusProgress = Color(light: 0x0071E3, dark: 0x0A84FF)
    public static let statusReview = Color(light: 0xB86E00, dark: 0xFF9F0A)
    public static let statusDone = Color(light: 0x248A3D, dark: 0x30D158)
    public static let destructive = Color(light: 0xD70015, dark: 0xFF453A)
    public static let warningBg = Color(light: 0xFFF6E5, dark: 0x3A2B0C)
    public static let warningFg = Color(light: 0x7A4A00, dark: 0xFFD38A)
    /// Timeline bar fill per status
    public static let timelineOpenBg = Color(light: 0xF0F1F4, dark: 0x2A2A2E)
    public static let timelineOpenBorder = Color(light: 0xD6D8DE, dark: 0x414147)
    public static let timelineReviewBg = Color(light: 0xFBF2E3, dark: 0x3B2D14)
    public static let timelineReviewBorder = Color(light: 0xEAD3AB, dark: 0x6A4F22)
    public static let timelineProgressBorder = Color(light: 0xB9D3F3, dark: 0x1F4F8A)
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
