#!/usr/bin/env swift

import AppKit
import CoreGraphics
import CoreText
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
    case openGraph
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
  .init(name: "og-image.png", width: 1200, height: 630, alpha: false, kind: .openGraph),
]

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

private func drawLinearGradient(
  _ context: CGContext,
  rect: CGRect,
  radius: CGFloat,
  colors: [CGColor],
  start: CGPoint,
  end: CGPoint
) {
  context.saveGState()
  context.addPath(roundedRect(rect, radius: radius))
  context.clip()
  let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: nil)!
  context.drawLinearGradient(
    gradient,
    start: start,
    end: end,
    options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
  )
  context.restoreGState()
}

private func drawIcon(in context: CGContext, rect: CGRect, showLid: Bool, shadow: Bool = true) {
  let side = min(rect.width, rect.height)
  let origin = CGPoint(x: rect.midX - side / 2, y: rect.midY - side / 2)
  let canvas = CGRect(origin: origin, size: CGSize(width: side, height: side))

  drawLinearGradient(
    context,
    rect: canvas,
    radius: 0,
    colors: [color(0xFDF6EE), color(0xF4E4D4)],
    start: CGPoint(x: canvas.minX + side * 0.16, y: canvas.minY),
    end: CGPoint(x: canvas.maxX - side * 0.10, y: canvas.maxY)
  )

  context.saveGState()
  context.addRect(canvas)
  context.clip()
  let highlight = CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
    colors: [color(0xFFC79A, alpha: 0.55), color(0xFFC79A, alpha: 0)] as CFArray,
    locations: [0, 0.60]
  )!
  let highlightCenter = CGPoint(x: canvas.minX + side * 0.82, y: canvas.minY + side * 0.06)
  context.drawRadialGradient(
    highlight,
    startCenter: highlightCenter,
    startRadius: 0,
    endCenter: highlightCenter,
    endRadius: side * 0.60,
    options: [.drawsAfterEndLocation]
  )
  context.restoreGState()

  let body = CGRect(
    x: canvas.minX + side * (38.0 / 240.0),
    y: canvas.minY + side * (62.0 / 240.0),
    width: side * (164.0 / 240.0),
    height: side * (116.0 / 240.0)
  )
  let bodyRadius = side * (26.0 / 240.0)

  context.saveGState()
  if shadow {
    context.setShadow(
      offset: CGSize(width: 0, height: side * (10.0 / 240.0)),
      blur: side * (22.0 / 240.0),
      color: color(0x965A28, alpha: 0.18)
    )
  }
  context.addPath(roundedRect(body, radius: bodyRadius))
  context.setFillColor(color(0xFFFFFF, alpha: 0.85))
  context.fillPath()
  context.restoreGState()

  let padding = side * (10.0 / 240.0)
  let gap = side * (9.0 / 240.0)
  let available = body.width - padding * 2 - gap
  let rightWidth = available / 2.25
  let leftWidth = rightWidth * 1.25
  let compartmentY = body.minY + padding
  let compartmentHeight = body.height - padding * 2
  let compartmentRadius = side * (17.0 / 240.0)
  let left = CGRect(x: body.minX + padding, y: compartmentY, width: leftWidth, height: compartmentHeight)
  let right = CGRect(x: left.maxX + gap, y: compartmentY, width: rightWidth, height: compartmentHeight)

  drawLinearGradient(
    context,
    rect: left,
    radius: compartmentRadius,
    colors: [color(0xFF8143), color(0xE2500F)],
    start: CGPoint(x: left.minX, y: left.minY),
    end: CGPoint(x: left.maxX, y: left.maxY)
  )
  drawLinearGradient(
    context,
    rect: right,
    radius: compartmentRadius,
    colors: [color(0xA8CDBB), color(0x5E9E86)],
    start: CGPoint(x: right.minX, y: right.minY),
    end: CGPoint(x: right.maxX, y: right.maxY)
  )

  if showLid {
    let lid = CGRect(
      x: canvas.minX + side * (62.0 / 240.0),
      y: canvas.minY + side * (46.0 / 240.0),
      width: side * (116.0 / 240.0),
      height: max(side * (9.0 / 240.0), side < 24 ? 0 : 1)
    )
    context.addPath(roundedRect(lid, radius: side * (5.0 / 240.0)))
    context.setFillColor(color(0x2A1D14, alpha: 0.14))
    context.fillPath()
  }
}

private func drawBadge(in context: CGContext, rect: CGRect) {
  context.clear(rect)
  let side = min(rect.width, rect.height)
  let body = CGRect(x: side * 0.16, y: side * 0.30, width: side * 0.68, height: side * 0.45)
  let lid = CGRect(x: side * 0.26, y: side * 0.20, width: side * 0.48, height: side * 0.08)
  context.setFillColor(color(0xFFFFFF))
  context.addPath(roundedRect(body, radius: side * 0.11))
  context.fillPath()
  context.addPath(roundedRect(lid, radius: side * 0.025))
  context.fillPath()
}

private func drawText(_ text: String, in context: CGContext, at point: CGPoint, size: CGFloat, weight: NSFont.Weight, color textColor: CGColor) {
  let font = NSFont.systemFont(ofSize: size, weight: weight)
  let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor(cgColor: textColor)!,
  ]
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
  context.saveGState()
  context.translateBy(x: point.x, y: point.y + size)
  context.scaleBy(x: 1, y: -1)
  context.textPosition = .zero
  CTLineDraw(line, context)
  context.restoreGState()
}

private func drawOpenGraph(in context: CGContext, rect: CGRect) {
  context.setFillColor(color(0xFDF6EE))
  context.fill(rect)
  drawIcon(in: context, rect: CGRect(x: 72, y: 195, width: 240, height: 240), showLid: true)
  drawText("Mise ·", in: context, at: CGPoint(x: 370, y: 243), size: 66, weight: .bold, color: color(0x2A1D14))
  drawText("одна готовка на неделю", in: context, at: CGPoint(x: 372, y: 325), size: 37, weight: .medium, color: color(0x2A1D14, alpha: 0.68))
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
    drawIcon(in: context, rect: rect, showLid: true)
  case .badge:
    drawBadge(in: context, rect: rect)
  case .openGraph:
    drawOpenGraph(in: context, rect: rect)
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
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FDF6EE"/><stop offset="1" stop-color="#F4E4D4"/></linearGradient>
    <radialGradient id="shine" cx="82%" cy="6%" r="60%"><stop stop-color="#FFC79A" stop-opacity=".55"/><stop offset=".6" stop-color="#FFC79A" stop-opacity="0"/></radialGradient>
    <linearGradient id="left" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FF8143"/><stop offset="1" stop-color="#E2500F"/></linearGradient>
    <linearGradient id="right" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#A8CDBB"/><stop offset="1" stop-color="#5E9E86"/></linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="11" flood-color="#965A28" flood-opacity=".18"/></filter>
  </defs>
  <rect width="240" height="240" fill="url(#bg)"/>
  <rect width="240" height="240" fill="url(#shine)"/>
  <rect x="38" y="62" width="164" height="116" rx="26" fill="#fff" fill-opacity=".85" filter="url(#shadow)"/>
  <rect x="48" y="72" width="75" height="96" rx="17" fill="url(#left)"/>
  <rect x="132" y="72" width="60" height="96" rx="17" fill="url(#right)"/>
  <rect x="62" y="46" width="116" height="9" rx="5" fill="#2A1D14" fill-opacity=".2"/>
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
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for spec in exports {
  try render(spec).write(to: output.appendingPathComponent(spec.name), options: .atomic)
}
try Data(faviconSVG.utf8).write(to: output.appendingPathComponent("favicon.svg"), options: .atomic)
print("Generated \(exports.count + 1) Mise icon assets in \(output.path)")
