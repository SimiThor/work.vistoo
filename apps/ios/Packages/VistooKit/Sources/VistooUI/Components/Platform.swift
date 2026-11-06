import SwiftUI

/// iOS-only modifiers behind small helpers. The package also compiles for
/// macOS (to verify most of the UI code without Xcode); there these are no-ops.
extension View {
    func inlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    func largeNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.large)
        #else
        self
        #endif
    }

    func emailInput() -> some View {
        #if os(iOS)
        keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .textContentType(.emailAddress)
            .autocorrectionDisabled()
        #else
        autocorrectionDisabled()
        #endif
    }

    func oneTimeCodeInput() -> some View {
        #if os(iOS)
        keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
        #else
        self
        #endif
    }

    func nameInput() -> some View {
        #if os(iOS)
        textContentType(.name)
            .textInputAutocapitalization(.words)
        #else
        self
        #endif
    }

    func groupedListStyle() -> some View {
        #if os(iOS)
        listStyle(.insetGrouped)
        #else
        listStyle(.inset)
        #endif
    }

    func plainListStyle() -> some View {
        listStyle(.plain)
    }
}

/// Toolbar placements that exist on all platforms with an iOS-like meaning.
extension ToolbarItemPlacement {
    static var leading: ToolbarItemPlacement {
        #if os(iOS)
        .topBarLeading
        #else
        .navigation
        #endif
    }

    static var bottom: ToolbarItemPlacement {
        #if os(iOS)
        .bottomBar
        #else
        .automatic
        #endif
    }

    static var trailing: ToolbarItemPlacement {
        #if os(iOS)
        .topBarTrailing
        #else
        .primaryAction
        #endif
    }
}
