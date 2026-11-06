// swift-tools-version: 6.0
import PackageDescription

// VistooKit: everything of the iOS app except the thin app target.
//  - VistooCore: generated API models/endpoints, API client, auth (Supabase,
//    Keychain), realtime, observable stores. No SwiftUI.
//  - VistooUI: SwiftUI screens and components.
// The package also builds for macOS so that `swift build` / `swift test`
// can verify most of the code without Xcode (see apps/ios/README.md).
let package = Package(
    name: "VistooKit",
    defaultLocalization: "de",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "VistooCore", targets: ["VistooCore"]),
        .library(name: "VistooUI", targets: ["VistooUI"]),
    ],
    dependencies: [
        // Official Supabase client (Auth with Keychain storage, Realtime).
        .package(url: "https://github.com/supabase/supabase-swift.git", .upToNextMinor(from: "2.55.6")),
    ],
    targets: [
        .target(
            name: "VistooCore",
            dependencies: [.product(name: "Supabase", package: "supabase-swift")]
        ),
        .target(name: "VistooUI", dependencies: ["VistooCore"]),
        .testTarget(
            name: "VistooCoreTests",
            dependencies: ["VistooCore", .product(name: "Supabase", package: "supabase-swift")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
