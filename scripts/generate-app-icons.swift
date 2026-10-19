#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

private struct ExportSpec {
  let name: String
  let width: Int
  let height: Int
  let alpha: Bool
  let kind: Kind

  enum Kind {
    case icon(showLid: Bool)
    case maskable
    case badge
  }
}

private let exports: [ExportSpec] = [
  .init(name: "apple-touch-icon.png", width: 180, height: 180, alpha: false, kind: .icon(showLid: true)),
  .init(name: "icon-192.png", width: 192, height: 192, alpha: false, kind: .icon(showLid: true)),
  .init(name: "icon-512.png", width: 512, height: 512, alpha: false, kind: .icon(showLid: true)),
  .init(name: "icon-maskable-512.png", width: 512, height: 512, alpha: false, kind: .maskable),
  .init(name: "favicon-32.png", width: 32, height: 32, alpha: false, kind: .icon(showLid: true)),
  .init(name: "favicon-16.png", width: 16, height: 16, alpha: false, kind: .icon(showLid: false)),
  .init(name: "badge-96.png", width: 96, height: 96, alpha: true, kind: .badge),
]

// Палитра кита C v2.2 (REDESIGN_C_KIT.md §4.2, §8): крем на чернилах, терракотовый акцент.
private let inkHex: UInt32 = 0x2A1D14
private let creamHex: UInt32 = 0xFFF1E6
private let terracottaHex: UInt32 = 0xC9400D
private let lidTintHex: UInt32 = 0xFFD2B8
// Безопасная зона маскируемой иконки — круг диаметром 80 % холста; знак уменьшен с запасом.
private let maskableContentScale: CGFloat = 0.8

private func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
  CGColor(
    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    components: [
      CGFloat((hex >> 16) & 0xff) / 255,
      CGFloat((hex >> 8) & 0xff) / 255,
      CGFloat(hex & 0xff) / 255,
      alpha,
    ]
  )!
}

private func roundedRect(_ rect: CGRect, radius: CGFloat) -> CGPath {
  CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

/// Знак Mise в сетке 240: корпус контейнера, два отсека 1.25 : 1 и крышка над ним.
/// `scale` уменьшает знак вокруг центра холста (маскируемая версия, бейдж).
private func markRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, canvas: CGRect, side: CGFloat, scale: CGFloat) -> CGRect {
  let unit = side / 240.0 * scale
  let offset = 120.0 * (1 - scale) * side / 240.0
  return CGRect(x: canvas.minX + offset + x * unit, y: canvas.minY + offset + y * unit, width: w * unit, height: h * unit)
}

private func drawIcon(in context: CGContext, rect: CGRect, showLid: Bool, scale: CGFloat = 1) {
  let side = min(rect.width, rect.height)
  let origin = CGPoint(x: rect.midX - side / 2, y: rect.midY - side / 2)
  let canvas = CGRect(origin: origin, size: CGSize(width: side, height: side))
  let unit = side / 240.0 * scale

  context.setFillColor(color(inkHex))
  context.fill(canvas)

  let body = markRect(38, 62, 164, 116, canvas: canvas, side: side, scale: scale)
  context.addPath(roundedRect(body, radius: 26 * unit))
  context.setFillColor(color(creamHex))
  context.fillPath()

  let padding = 10 * unit
  let gap = 9 * unit
  let available = body.width - padding * 2 - gap
  let rightWidth = available / 2.25
  let leftWidth = rightWidth * 1.25
  let compartmentY = body.minY + padding
  let compartmentHeight = body.height - padding * 2
  let compartmentRadius = 17 * unit
  let left = CGRect(x: body.minX + padding, y: compartmentY, width: leftWidth, height: compartmentHeight)
  let right = CGRect(x: left.maxX + gap, y: compartmentY, width: rightWidth, height: compartmentHeight)
  context.addPath(roundedRect(left, radius: compartmentRadius))
  context.setFillColor(color(terracottaHex))
  context.fillPath()
  context.addPath(roundedRect(right, radius: compartmentRadius))
  context.setFillColor(color(lidTintHex))
  context.fillPath()

  if showLid {
    var lid = markRect(62, 46, 116, 9, canvas: canvas, side: side, scale: scale)
    lid.size.height = max(lid.height, side < 24 ? 0 : 1)
    context.addPath(roundedRect(lid, radius: 5 * unit))
    context.setFillColor(color(creamHex, alpha: 0.2))
    context.fillPath()
  }
}

/// Монохромный бейдж уведомления: белый силуэт контейнера с вырезанными отсеками и крышкой.
private func drawBadge(in context: CGContext, rect: CGRect) {
  context.clear(rect)
  let side = min(rect.width, rect.height)
  let scale: CGFloat = 1.2
  let unit = side / 240.0 * scale
  let body = markRect(38, 62, 164, 116, canvas: rect, side: side, scale: scale)
  let padding = 10 * unit
  let gap = 9 * unit
  let rightWidth = (body.width - padding * 2 - gap) / 2.25
  let left = CGRect(x: body.minX + padding, y: body.minY + padding, width: rightWidth * 1.25, height: body.height - padding * 2)
  let right = CGRect(x: left.maxX + gap, y: left.minY, width: rightWidth, height: left.height)
  let silhouette = CGMutablePath()
  silhouette.addPath(roundedRect(body, radius: 26 * unit))
  silhouette.addPath(roundedRect(left, radius: 17 * unit))
  silhouette.addPath(roundedRect(right, radius: 17 * unit))
  context.setFillColor(color(0xFFFFFF))
  context.addPath(silhouette)
  context.fillPath(using: .evenOdd)
  let lid = markRect(62, 46, 116, 9, canvas: rect, side: side, scale: scale)
  context.addPath(roundedRect(lid, radius: 5 * unit))
  context.fillPath()
}

private func render(_ spec: ExportSpec) throws -> Data {
  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  let bitmapInfo: CGBitmapInfo = spec.alpha
    ? CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
    : CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue)
  guard let context = CGContext(
    data: nil,
    width: spec.width,
    height: spec.height,
    bitsPerComponent: 8,
    bytesPerRow: spec.width * 4,
    space: colorSpace,
    bitmapInfo: bitmapInfo.rawValue
  ) else { throw NSError(domain: "MiseIcon", code: 1) }

  context.translateBy(x: 0, y: CGFloat(spec.height))
  context.scaleBy(x: 1, y: -1)
  let rect = CGRect(x: 0, y: 0, width: spec.width, height: spec.height)
  switch spec.kind {
  case .icon(let showLid):
    drawIcon(in: context, rect: rect, showLid: showLid)
  case .maskable:
    drawIcon(in: context, rect: rect, showLid: true, scale: maskableContentScale)
  case .badge:
    drawBadge(in: context, rect: rect)
  }

  guard let image = context.makeImage() else { throw NSError(domain: "MiseIcon", code: 2) }
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [.compressionFactor: 1]) else {
    throw NSError(domain: "MiseIcon", code: 3)
  }
  return data
}

private let faviconSVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="52" fill="#2A1D14"/>
  <rect x="38" y="62" width="164" height="116" rx="26" fill="#FFF1E6"/>
  <rect x="48" y="72" width="75" height="96" rx="17" fill="#C9400D"/>
  <rect x="132" y="72" width="60" height="96" rx="17" fill="#FFD2B8"/>
  <rect x="62" y="46" width="116" height="9" rx="5" fill="#FFF1E6" fill-opacity=".2"/>
</svg>
"""

private func outputDirectory() -> URL {
  let arguments = CommandLine.arguments
  if let index = arguments.firstIndex(of: "--output"), arguments.indices.contains(index + 1) {
    return URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
  }
  return URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("public", isDirectory: true)
}

let output = outputDirectory()
let nativeOnly = CommandLine.arguments.contains("--native")
private let selectedExports: [ExportSpec] = nativeOnly
  ? [.init(name: "icon.png", width: 1024, height: 1024, alpha: false, kind: .icon(showLid: true))]
  : exports
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for spec in selectedExports {
  try render(spec).write(to: output.appendingPathComponent(spec.name), options: .atomic)
}
if !nativeOnly {
  try Data(faviconSVG.utf8).write(to: output.appendingPathComponent("favicon.svg"), options: .atomic)
}
print("Generated \(selectedExports.count + (nativeOnly ? 0 : 1)) Mise icon assets in \(output.path)")
