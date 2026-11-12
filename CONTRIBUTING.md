# Contributing

Thanks for helping improve PrismDock. This project values small, readable changes over new features.

## Setup

```bash
npm install
npm start      # run from source
npm test       # unit tests
npm run check:native   # compile the C# of the native helper and the guardian
npm run check:names    # find names that are used but never defined or imported
```

Use a separate profile while developing so your own settings stay untouched:

```bash
set "PRISM_USER_DATA=%CD%\test-profile" && npm run dev
```

(`test-profile/` is ignored by git.)

## Test harness

`npm run dev` sets `PRISM_DEBUG=1`. The main process then logs renderer console output and serves a
small HTTP API on `127.0.0.1:39847` (see `src/main/debug.js`):

| Endpoint | Purpose |
| --- | --- |
| `POST /eval?w=dock1` | evaluate the request body in a window (`dock1`, `dock2` … or `settings`) |
| `GET /shot?w=dock1&file=C:\path\shot.png` | screenshot of a window |
| `POST /frames?w=dock1&n=12&dir=C:\dir` | run a script, then capture frames as fast as possible |
| `GET /reload?w=dock1` | reload a window without cache |
| `GET /settings?s=behavior` | open the settings on a section |

`window.__view` (the `DockView` of a window) and `window.__go(section)` in the settings exist for these
scripts.

## Code style

- Plain JavaScript, no build step: CommonJS in `src/main`, ES modules in `src/renderer`.
- Two-space indentation, single quotes, semicolons, `const` by default.
- Comments explain *why* something is done, not what the line says.
- UI interactions change colour, background or opacity only – no scaling, bouncing or movement.
  Use the tokens in `src/renderer/shared/tokens.css` for radii, spacing and motion.
- Anything that runs repeatedly must stop when nobody needs it (unsubscribe, clear timers, pause when
  hidden). Measure before and after a performance change.

## Widgets

A widget is an object in one of the files in `src/renderer/widgets/`:

```js
{
  type: 'example', name: 'Example', cat: 'system', icon: 'cpu', desc: 'One line for the gallery.',
  sizes: ['s', 'm'], size: 's',          // available sizes and the default
  topics: ['cpu'],                       // data the tile needs (see shared/hub.js)
  panelTopics: [],                       // extra data only while its panel is open
  tile(ctx, data) { return '<div class="tin">…</div>'; },
  panel(ctx, data) { return '<div class="pn">…</div>'; },
  on: { action(ctx, el) {} },            // handlers for data-a="action" buttons
  settings: [{ key: 'x', label: 'X', type: 'toggle', default: true }],
}
```

Tiles and panels return HTML strings; render the same markup for the same data so the DOM patcher can
skip unchanged updates. Use `graph.js` for charts.

## Secrets and personal data

Never commit `config.json`, `data.json`, `secrets.bin`, API keys or tokens. Integrations read keys only
through the encrypted secret store.

## Pull requests

1. Keep the change focused and describe how you tested it.
2. `npm test`, `npm run check:names` and `npm run check:native` must pass, and the app must start without console errors.
3. For UI changes, add a screenshot.
