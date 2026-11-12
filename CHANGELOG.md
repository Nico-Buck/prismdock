# Changelog

All notable changes to PrismDock. The format follows [Keep a Changelog](https://keepachangelog.com),
versions follow [Semantic Versioning](https://semver.org).

## [1.3.0] – 2026-11-11

### Added
- Overview page in the app with stats, quick actions and the essential switches.
- Live volume: Core Audio pushes every change, the ring follows a headset wheel in ~10 ms.
- Event-driven, per-monitor full-screen detection (browsers in full screen, YouTube, games).
- New keys and service settings switch widgets from sample to live data immediately.
- `npm test` unit tests, `npm run check:native`, `npm run check:names`, CI on Windows.

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
- Start with Windows did nothing for the portable build (it registered a temporary folder).
- The taskbar setting could be lost after a reboot or crash, or stay hidden when quitting while the helper
  was busy; the helper now gives it back on every exit path and re-applies it after a restart.
- Window and monitor positions on scaled displays (125 %, 150 %) were read in the wrong units.
- A frozen media player could hang the native helper; it now times out and the helper restarts itself.
- Polling could run twice per topic after refreshes, slowly increasing CPU use over a session.
- A damaged or hand-edited config.json, or an import of an old export, could stop PrismDock from starting.
- Saving could show an error dialog while antivirus software held the file.
- The Layout Editor stopped working after selecting a widget.
- Integration test results were inserted as HTML; widget number fields could save 0 or empty values.
- Two quick edits of widget settings lost the first one; dragging a widget to the end of the list failed.
- Panels kept polling after being reopened or closed while loading; the glass stayed blank after a GPU reset.
- Pomodoro and Timer notified once per monitor; today's revenue and late-evening screen time landed on the
  wrong day; forecast weekdays were one day off west of UTC; a mistyped time zone broke World Clocks.
- Spotify could lose its sign-in when two requests refreshed the token at once.
- Long-running daily or weekly iCal series that started years ago did not show.
- Windows 10 and early Windows 11: the app window had no acrylic and showed plain black; it now has a
  solid background there. Terminal falls back to PowerShell where Windows Terminal is missing, Windows 10
  shell processes no longer show up as apps, and tablet mode no longer counts as full screen.
- Pomodoro and Timer alerts now also fire while the bar is hidden (show on hover, full-screen app).
- Reset everything kept the saved layouts but overwrote "Default" instead of the active one.
- Deleting the active layout in the Layout Editor now asks for a second click.
- Several font sizes in menus and buttons were ignored (invalid CSS shorthand).
- Notifications of the installed build use the installer's app ID, so Windows shows them.
- Start with Windows keeps a choice made in Task Manager; failed app icons are retried later.
- Third review: the Recycle Bin always showed empty on 64-bit Windows; Store apps (Calculator, Settings,
  Photos ...) were missing from the bar and the launcher; the native helper did not start under a Group
  Policy execution policy or with a non-Latin user name, and a blocked helper was respawned every 2 s.
- Layout Editor search filters while typing; Esc, arrow keys and Delete work; open panels are no longer
  rebuilt on every settings change; menus and panels stay on screen on small displays.
- Claude Code tokens were counted 2-3 times; Codex limits disappeared after a minute; revenue no longer
  adds up different currencies or misreads JPY; PayPal and Shopify read all pages.
- iCal: time zones (TZID), deleted, moved and cancelled occurrences, and monthly rules like the second
  Tuesday.
- Wi-Fi works in every Windows language; a solid colour desktop no longer shows the old wallpaper;
  clicking the active app minimizes it; offline network folders no longer freeze the dock.
- Many smaller fixes: ended events shown as now, Timer default length, World Clock offsets like +5:45,
  sun position for a weather city in another time zone, 24-hour format, drive letters, Charging vs
  Plugged in, YouTube hidden subscriber counts, Linear error messages, network spikes after VPN connects,
  local screenshot names, and the debug harness and open command are locked down.

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
