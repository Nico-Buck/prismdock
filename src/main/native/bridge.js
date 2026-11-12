// Talks to helper.ps1 over stdin/stdout (one JSON line per message).
// Started lazily on first request; restarted if it dies.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// PowerShell cannot read files inside app.asar, so packaged builds copy the helper out first.
function nativeFile(name) {
  const src = path.join(__dirname, name);
  if (!src.includes('app.asar')) return src;
  const { app } = require('electron');
  const dst = path.join(app.getPath('userData'), name);
  const body = fs.readFileSync(src, 'utf8');
  try { if (fs.readFileSync(dst, 'utf8') === body) return dst; } catch { /* first run */ }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, body);
  return dst;
}

// The helper is loaded as a script block instead of with -File: an execution policy set by Group Policy
// ("allow only signed scripts") outranks -ExecutionPolicy Bypass for files, but does not apply to script blocks.
function loader(file) {
  return `& ([scriptblock]::Create([IO.File]::ReadAllText('${file.replace(/'/g, "''")}', [Text.Encoding]::UTF8)))`;
}
// The C# compiler behind Add-Type cannot use a %TEMP% path outside the ANSI codepage (a Cyrillic or Chinese
// user name on a Western Windows): give the helper an ASCII temp folder then.
function asciiTemp() {
  const os = require('os');
  if (!/[^\x20-\x7e]/.test(os.tmpdir())) return {};
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'PrismDock', 'tmp');
  try { fs.mkdirSync(dir, { recursive: true }); return { TEMP: dir, TMP: dir }; } catch { return {}; }
}

// Besides replies, the helper pushes {"event": name, ...} lines; they are emitted as events,
// and 'ready' is emitted after every (re)start.
class NativeBridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.seq = 1;
    this.buf = '';
    this.ready = null;
  }

  _start() {
    if (this.proc) return this.ready;
    // a helper that keeps dying before it is ready (blocked by policy, broken install) is retried with a
    // growing pause (2 s, 4 s ... 5 min) instead of spawning PowerShell every 2 seconds
    if (Date.now() < (this.nextTry || 0)) return Promise.reject(new Error(this.lastError || 'helper restarting'));
    const p = this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', loader(nativeFile('helper.ps1'))], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...asciiTemp(), PRISM_PARENT_PID: String(process.pid) },
    });
    this.buf = ''; this.timeouts = 0; this.started = false; this.stderr = '';
    p.stdout.setEncoding('utf8');
    // never block the app on the helper: give up after 20 s (and start over on the next call)
    let startTimer;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = () => { clearTimeout(startTimer); resolve(); };
      this._rejectReady = reject;
      startTimer = setTimeout(() => { reject(new Error('helper did not start')); try { p.kill(); } catch { /* gone */ } }, 20000);
    });
    this.ready.catch(() => {});
    p.on('error', (e) => { if (process.env.PRISM_DEBUG) console.error('[helper] spawn failed', e); });
    p.stdin.on('error', () => { /* the helper died; 'exit' fails the pending calls */ });
    p.stdout.on('data', (chunk) => { if (this.proc === p) this._onData(chunk); });
    p.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); if (process.env.PRISM_DEBUG) console.error('[helper]', String(d)); });
    p.on('exit', () => {
      clearTimeout(startTimer);
      if (this.proc !== p) return; // an older helper we already replaced
      this.proc = null; this.lastExit = Date.now(); this.buf = '';
      if (this.started) { this.failures = 0; this.nextTry = Date.now() + 2000; } else {
        this.failures = (this.failures || 0) + 1;
        this.nextTry = Date.now() + Math.min(300000, 2000 * 2 ** (this.failures - 1));
        this.lastError = 'Windows integration could not start' + (this.stderr ? ': ' + this.stderr.trim().split('\n')[0].slice(0, 200) : '');
        console.warn(this.lastError);
      }
      this._rejectReady?.(new Error('helper exited'));
      for (const c of this.pending.values()) { clearTimeout(c.timer); c.reject(new Error('helper exited')); }
      this.pending.clear();
    });
    return this.ready;
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { this.started = true; this.failures = 0; this.lastError = null; this._resolveReady(); this.emit('ready'); continue; }
      if (msg.event) { this.emit(msg.event, msg); continue; } // pushed from other threads: says nothing about the request loop
      this.timeouts = 0;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    }
  }

  async call(cmd, args = {}, timeout = 8000) {
    if (this.stopped) throw new Error('helper stopped'); // quitting: never start a new helper
    await this._start();
    const p = this.proc;
    if (!p) throw new Error('helper exited');
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`timeout: ${cmd}`));
        // a helper that answers nothing for several calls in a row is stuck (e.g. a hung system call): restart it -
        // unless a known long command (guard compile, GPU scan, DDC brightness) is still running ahead of them
        const longRunning = [...this.pending.values()].some((c) => c.long);
        if (!longRunning && ++this.timeouts >= 5 && this.proc === p) { this.timeouts = 0; try { p.kill(); } catch { /* gone */ } }
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, long: timeout > 8000 });
      try { p.stdin.write(JSON.stringify({ id, cmd, args }) + '\n'); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  // closing stdin lets the helper leave its loop and run its cleanup (it gives the taskbar back);
  // it is killed only if it does not exit by itself
  stop() {
    this.stopped = true;
    const p = this.proc; if (!p) return;
    this.proc = null;
    try { p.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 3000).unref();
  }
}

module.exports = new NativeBridge();
module.exports.nativeFile = nativeFile;
