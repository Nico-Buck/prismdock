// Test harness for development (only started with PRISM_DEBUG=1, listens on localhost only).
// Lets scripts evaluate code in a window, take screenshots and reload windows; see CONTRIBUTING.md.
const fs = require('fs');
const path = require('path');

// windows(): { docks: BrowserWindow[], settings: BrowserWindow|null }, openSettings(section)
function debugServer({ windows, openSettings }) {
  const http = require('http');
  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const which = u.searchParams.get('w') || 'dock';
      const { docks, settings } = windows();
      const win = which === 'settings' ? settings : which.startsWith('dock') && which.length > 4 ? docks[Number(which.slice(4)) - 1] : docks[0];
      if (!win) throw new Error('no window ' + which);
      if (u.pathname === '/eval') {
        let body = ''; for await (const c of req) body += c;
        const r = await win.webContents.executeJavaScript(body || u.searchParams.get('js'), true);
        res.end(JSON.stringify(r ?? null));
      } else if (u.pathname === '/shot') {
        win.webContents.invalidate(); await new Promise((r) => setTimeout(r, 250));
        const img = await win.webContents.capturePage();
        const file = u.searchParams.get('file');
        fs.writeFileSync(file, img.toPNG());
        res.end(JSON.stringify({ file, size: img.getSize() }));
      } else if (u.pathname === '/frames') {
        // run a script, then capture n frames as fast as possible (for animation debugging)
        let body = ''; for await (const c of req) body += c;
        const n = Number(u.searchParams.get('n') || 12); const dir = u.searchParams.get('dir');
        win.webContents.executeJavaScript(body, true).catch(() => {});
        const t0 = Date.now(); const out = [];
        for (let i = 0; i < n; i++) { const img = await win.webContents.capturePage(); const file = path.join(dir, 'f' + String(i).padStart(2, '0') + '.png'); fs.writeFileSync(file, img.toPNG()); out.push(Date.now() - t0); }
        res.end(JSON.stringify(out));
      } else if (u.pathname === '/reload') {
        await win.webContents.session.clearCache();
        win.webContents.reloadIgnoringCache(); res.end('ok');
      } else if (u.pathname === '/settings') { openSettings(u.searchParams.get('s') || undefined); res.end('ok'); }
      else res.end('?');
    } catch (e) { res.statusCode = 500; res.end(String(e.stack || e)); }
  }).listen(39847, '127.0.0.1');
}

module.exports = { debugServer };
