// Renders the app icon: the Vistoo mark (black + navy stroke) on white, at the
// proportions of the supplied 1024×1024 icon. Same paths as
// VistooUI/Components/Brand.swift and apps/web/src/components/brand.tsx.
// iOS applies the corner mask itself, so the icon is a full-bleed square without alpha.
// Usage: swift apps/ios/scripts/render-app-icon.swift <output.png>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let markBlack = "M164.2 265C161.7 260.7 161.7 255.4 164.2 251C166.7 246.7 171.3 244 176.3 244L313 244C327.2 244 340.4 251.6 347.6 263.9L572.7 652.2C578.4 661.9 578.1 673.9 572.1 683.4L516 771.1C509.6 781.1 498.5 787 486.7 786.7C474.8 786.5 463.9 780.1 458 769.8Z"
let markNavy = "M653.4 268.2C662.5 253.2 678.7 244 696.2 244L840.8 244C845.9 244 850.6 246.8 853 251.2C855.5 255.7 855.4 261.1 852.7 265.4L700.8 509.2C693.5 520.9 680.7 528 666.9 528L588.7 528C569.9 528 552.6 517.9 543.4 501.6C534.2 485.2 534.5 465.2 544.2 449.1Z"

/// Absolute SVG path data (M, L, C, Z) in y-down coordinates.
func path(_ d: String, height: CGFloat) -> CGPath {
    let p = CGMutablePath()
    var nums: [CGFloat] = []
    var cmd: Character = " "
    func pt(_ i: Int) -> CGPoint { CGPoint(x: nums[i], y: height - nums[i + 1]) }
    func flush() {
        switch cmd {
        case "M": p.move(to: pt(0))
        case "L": p.addLine(to: pt(0))
        case "C": p.addCurve(to: pt(4), control1: pt(0), control2: pt(2))
        case "Z": p.closeSubpath()
        default: break
        }
        nums = []
    }
    var token = ""
    for ch in d {
        if "MLCZ".contains(ch) {
            if let n = Double(token) { nums.append(n) }
            token = ""; flush(); cmd = ch
        } else if ch == " " {
            if let n = Double(token) { nums.append(n) }
            token = ""
        } else { token.append(ch) }
    }
    if let n = Double(token) { nums.append(n) }
    flush()
    return p
}

let size = 1024
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon-1024.png")
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
ctx.addPath(path(markBlack, height: CGFloat(size)))
ctx.fillPath()
ctx.setFillColor(CGColor(srgbRed: 0x1e / 255, green: 0x18 / 255, blue: 0x5c / 255, alpha: 1)) // token "brand"
ctx.addPath(path(markNavy, height: CGFloat(size)))
ctx.fillPath()
let image = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
precondition(CGImageDestinationFinalize(dest))
print("✓ \(out.path)")
