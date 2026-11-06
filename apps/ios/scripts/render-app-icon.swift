// Renders the app icon from the web logo geometry (apps/web/src/components/brand.tsx):
// a dark square (#1d1d1f) with a white "V" (path M5.5 6 L10 14.5 L14.5 6 in a 20×20 box).
// iOS applies the corner mask itself, so the icon is a full-bleed square without alpha.
// Usage: swift apps/ios/scripts/render-app-icon.swift <output.png>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon-1024.png")
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setFillColor(CGColor(srgbRed: 0x1d / 255, green: 0x1d / 255, blue: 0x1f / 255, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
// The glyph occupies the inner 70% (optical padding), drawn in a 20×20 coordinate system.
let s = CGFloat(size) * 0.7 / 20
let offset = CGFloat(size) * 0.15
func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: offset + x * s, y: CGFloat(size) - (offset + y * s)) }
ctx.setStrokeColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
ctx.setLineWidth(2 * s)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.move(to: point(5.5, 6))
ctx.addLine(to: point(10, 14.5))
ctx.addLine(to: point(14.5, 6))
ctx.strokePath()
let image = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
precondition(CGImageDestinationFinalize(dest))
print("✓ \(out.path)")
