// Deskland Mac host: where the Desktop icons are.
// Copyright (C) 2026 Jeremy Day. Part of the Mac host for Deskland (BLEZZ0102/Deskland).
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. See LICENSE at the top of the repository.
//
// Adapted from Desk Critters (wallpaper/Icons.swift). macOS tells an app where Finder's desktop
// icons are only through Accessibility, which the person grants in System Settings > Privacy &
// Security > Accessibility. Only the position and the size of each icon are read: never a title,
// file name, URL or any other attribute, and no action is ever performed on an icon.

import ApplicationServices
import Cocoa

enum Accessibility {
  /// Whether Accessibility has been granted. Never prompts.
  static var trusted: Bool { AXIsProcessTrusted() }

  /// Shows macOS's own Accessibility prompt (only from the menu item that says so).
  static func ask() {
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
  }
}

/// Polls Finder for the icon rects and reports them when they change.
final class DesktopIcons {
  /// The icons on the main screen, from its top left, in physical pixels: [left, top, right,
  /// bottom] as the page's {"t":"icons"} message takes them. Called on the main thread, only when
  /// the list differs from the last one. Without Accessibility: called once with an empty list.
  var onChange: ([[Int]]) -> Void = { _ in }
  /// Whether Accessibility is granted, when that changes (for the menu).
  var onTrust: (Bool) -> Void = { _ in }

  /// As the Windows host: a look every 0.4 s, and every 0.1 s for 2 s after a change, so a
  /// dragged icon is followed smoothly.
  private static let slow = 0.4, fast = 0.1, quickFor = 2.0
  /// Without the permission, how often to see whether it has been granted since.
  private static let recheck = 2.0
  /// A busy Finder gets this long to answer one question.
  private static let patience: Float = 0.25
  private static let most = 600

  private var timer: Timer?
  private var reading = false
  private var lastLook = -Double.infinity
  private var lastTrustCheck = -Double.infinity
  private var lastChange = -Double.infinity
  private(set) var trusted = false
  private var last: [[Int]]?
  private let queue = DispatchQueue(label: "deskland.icons", qos: .utility)

  func start() {
    guard timer == nil else { return }
    trusted = Accessibility.trusted
    onTrust(trusted)
    if !trusted { report([]) }
    let timer = Timer(timeInterval: Self.fast, repeats: true) { [weak self] _ in self?.tick() }
    timer.tolerance = 0.03
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  /// Forgets the last list, so the next look is sent even if unchanged (after a page reload).
  func resend() {
    last = nil
    lastLook = -Double.infinity
    if !trusted { report([]) }
  }

  private func tick() {
    let now = ProcessInfo.processInfo.systemUptime
    if !trusted {
      guard now - lastTrustCheck >= Self.recheck else { return }
      lastTrustCheck = now
      guard Accessibility.trusted else { return }
      trusted = true
      onTrust(true)
    }
    let interval = now - lastChange < Self.quickFor ? Self.fast : Self.slow
    guard !reading, now - lastLook >= interval - 0.02 else { return }
    lastLook = now
    // The permission taken away: say so, show the plain scene and go back to checking.
    guard Accessibility.trusted else {
      trusted = false
      lastTrustCheck = now
      onTrust(false)
      report([])
      return
    }
    guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first
    else { return }
    let pid = finder.processIdentifier
    reading = true
    queue.async { [weak self] in
      let rects = Self.read(pid)
      DispatchQueue.main.async {
        guard let self else { return }
        self.reading = false
        if let rects { self.report(Self.physical(rects)) }
      }
    }
  }

  private func report(_ rects: [[Int]]) {
    guard rects != last else { return }
    if last != nil { lastChange = ProcessInfo.processInfo.systemUptime }
    last = rects
    onChange(rects)
  }

  /// Global top-left point rects to the main screen's physical pixels; icons on other screens are
  /// left out (main screen only, like the Windows host).
  static func physical(_ rects: [CGRect]) -> [[Int]] {
    guard let main = NSScreen.screens.first else { return [] }
    let scale = main.backingScaleFactor
    let area = CGRect(origin: .zero, size: main.frame.size)  // the main screen, top left at 0,0
    return rects.filter { area.contains(CGPoint(x: $0.midX, y: $0.midY)) }
      .map { [Int(($0.minX * scale).rounded()), Int(($0.minY * scale).rounded()),
              Int(($0.maxX * scale).rounded()), Int(($0.maxY * scale).rounded())] }
      .sorted { $0[1] != $1[1] ? $0[1] < $1[1] : $0[0] < $1[0] }
  }

  // MARK: - Reading Finder, off the main thread

  /// The rects of the icons on Finder's desktop (global, top left of the main screen, points), or
  /// nil when they cannot be read just now.
  private static func read(_ pid: pid_t) -> [CGRect]? {
    let finder = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(finder, patience)
    // The desktop is the scroll area among Finder's top elements; its windows are passed over.
    guard let top = children(of: finder) else { return nil }
    var rects: [CGRect] = []
    var found = false
    for area in top where role(of: area) == kAXScrollAreaRole as String {
      guard let inside = children(of: area) else { return nil }
      for group in inside where role(of: group) == kAXGroupRole as String {
        guard let icons = children(of: group), icons.count <= most else { return nil }
        found = true
        for icon in icons {
          guard let rect = frame(of: icon) else { return nil }
          if rect.width >= 8 && rect.height >= 8 && rect.width <= 600 && rect.height <= 600 { rects.append(rect) }
        }
      }
    }
    // Desktop icons hidden (Finder's "Show these items on the desktop" off, or Stage Manager
    // hiding them) or no desktop at all: no icons.
    return found ? rects : []
  }

  private static func children(of element: AXUIElement) -> [AXUIElement]? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success else { return nil }
    return value as? [AXUIElement]
  }

  private static func role(of element: AXUIElement) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success else { return nil }
    return value as? String
  }

  /// Position and size, in one message to Finder.
  private static func frame(of element: AXUIElement) -> CGRect? {
    let names = [kAXPositionAttribute, kAXSizeAttribute] as CFArray
    var values: CFArray?
    guard AXUIElementCopyMultipleAttributeValues(element, names, AXCopyMultipleAttributeOptions(), &values) == .success,
      let pair = values as? [AnyObject], pair.count == 2,
      CFGetTypeID(pair[0]) == AXValueGetTypeID(), CFGetTypeID(pair[1]) == AXValueGetTypeID()
    else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(pair[0] as! AXValue, .cgPoint, &origin), AXValueGetValue(pair[1] as! AXValue, .cgSize, &size)
    else { return nil }
    return CGRect(origin: origin, size: size)
  }
}
