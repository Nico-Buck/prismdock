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
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', nativeFile('helper.ps1')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PRISM_PARENT_PID: String(process.pid) },
    });
    this.proc.stdout.setEncoding('utf8');
    // never block the app on the helper: give up after 20 s and let calls fail instead of hanging
    this.ready = new Promise((resolve, reject) => { this._resolveReady = resolve; setTimeout(() => reject(new Error('helper did not start')), 20000); });
    this.ready.catch(() => {});
    this.proc.on('error', (e) => { if (process.env.PRISM_DEBUG) console.error('[helper] spawn failed', e); });
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', (d) => { if (process.env.PRISM_DEBUG) console.error('[helper]', String(d)); });
    this.proc.on('exit', () => {
      this.proc = null;
      for (const p of this.pending.values()) p.reject(new Error('helper exited'));
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
      if (msg.ready) { this._resolveReady(); this.emit('ready'); continue; }
      if (msg.event) { this.emit(msg.event, msg); continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    }
  }

  async call(cmd, args = {}, timeout = 8000) {
    await this._start();
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${cmd}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() { if (this.proc) { this.proc.kill(); this.proc = null; } }
}

module.exports = new NativeBridge();
module.exports.nativeFile = nativeFile;
