# Changelog

All notable changes to PrismDock. The format follows [Keep a Changelog](https://keepachangelog.com),
versions follow [Semantic Versioning](https://semver.org).

## [1.3.0] – 2026-11-11

### Added
- Overview page in the app with stats, quick actions and the essential switches.
- Live volume: Core Audio pushes every change, the ring follows a headset wheel in ~10 ms.
- Event-driven, per-monitor full-screen detection (browsers in full screen, YouTube, games).
- New keys and service settings switch widgets from sample to live data immediately.
- `npm test` unit tests, `npm run check:native`, CI on Windows.

### Changed
- App redesigned in the dock's design language: floating glass sidebar, round window corners,
  compact rows, one accent colour.
- Charts rebuilt as responsive SVG (correct scaling, right-aligned short histories, live "now" dot).
- Live updates patch the DOM instead of rebuilding it; the glass redraws only when a glass shape
  changes and only inside its bounds.
- The taskbar guardian is a compiled 5 kB program instead of a PowerShell instance (63 MB → 12 MB).
- Calmer interaction: no glows, no scaling or bouncing; short opacity fades only.

### Fixed
- The app's content area did not scroll.
- Spotify queue and playlist covers were blocked by the Content-Security-Policy.
- Play/pause icons now change immediately on click and sit centred in their buttons.
- The dock reappeared over a full-screen video when another monitor got focus.

### Performance
- Idle CPU −71 %, mouse-move CPU −49 %, idle memory −18 % compared with 1.2.0 (see README).

## [1.2.0]

### Added
- One dock per monitor (all, main only or a selection) with per-display show-on-hover.
- Start button widget, redesigned Spotify player with precise seeking and its playlist.

### Fixed
- The Windows taskbar could reappear after the Start menu, an Explorer restart or sleep.

## [1.1.0]

### Added
- Layout Editor on the bar itself and saved layouts.
- Replacing the Windows taskbar, with automatic restore on quit and after a crash.

## [1.0.0]

- First version: the liquid-glass dock, six styles, widget library, settings app and Windows
  integration (audio, media, windows, battery, network, brightness).
