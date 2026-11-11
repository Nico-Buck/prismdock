// Data hub: widgets subscribe to topics, the hub polls only the topics someone needs,
// at the interval configured under Performance. Unsubscribed topics stop immediately.

const SYS = ['cpu', 'mem', 'gpu', 'temps', 'net', 'disks', 'battery', 'wifi', 'radios', 'volume', 'brightness', 'recycle', 'media', 'audioDevices', 'audioSessions'];

export class Hub {
  constructor(api, getConfig) {
    this.api = api;
    this.getConfig = getConfig;
    this.topics = new Map(); // topic -> { subs:Set, timer, value, busy }
    this.paused = false;
    // values the main process pushes as they change (live volume): delivered at once, no poll needed
    // a service got a new key or setting: fetch it now (replaces sample data right away)
    api.onIntegrationsChanged?.((names) => { for (const n of names) this.refresh(`integ:${n}`); });
    api.onSysPush?.(({ topic, value }) => {
      const t = this.topics.get(topic);
      if (!t || !value || this.paused) return;
      t.value = value;
      for (const fn of t.subs) { try { fn(value); } catch (e) { console.error(topic, e); } }
    });
  }

  interval(topic) {
    const p = this.getConfig().performance;
    const k = p.powerSaver ? 2.5 : 1;
    const I = p.intervals;
    let ms;
    if (topic === 'clock') ms = 1000;
    else if (topic === 'net') ms = I.network;
    else if (topic === 'media') ms = this._mediaIdle() ? Math.max(4000, I.media * 2) : I.media; // paused or nothing playing: slower
    else if (topic === 'windows') ms = I.windows;
    else if (SYS.includes(topic)) ms = ['disks', 'battery', 'recycle', 'wifi', 'radios', 'brightness', 'audioDevices'].includes(topic) ? Math.max(5000, I.system * 3) : I.system;
    else if (topic === 'integ:weather') ms = I.weather * 1000;
    else if (topic === 'integ:spotify') ms = 3000; // only subscribed while the player panel is open
    else if (topic.startsWith('integ:') || topic.startsWith('custom:')) ms = I.online * 1000;
    else if (topic === 'aiLocal') ms = 60000;
    else if (topic === 'screentime') ms = 30000;
    else if (topic === 'recent') ms = 20000;
    else ms = 5000;
    return topic === 'clock' ? ms : ms * k;
  }

  async fetch(topic) {
    const a = this.api;
    if (topic === 'clock') return Date.now();
    if (SYS.includes(topic)) return a.sys(topic);
    if (topic === 'windows') return a.windows();
    if (topic === 'aiLocal') return a.aiLocal();
    if (topic === 'screentime') return a.screentime();
    if (topic === 'recent') return a.recent();
    if (topic === 'startApps') return a.startApps();
    if (topic.startsWith('integ:')) return a.integration(topic.slice(6));
    if (topic.startsWith('custom:')) return a.customJson(topic.slice(7), 60);
    throw new Error('unknown topic ' + topic);
  }

  subscribe(topic, fn) {
    let t = this.topics.get(topic);
    if (!t) { t = { subs: new Set(), timer: null, value: undefined, busy: false }; this.topics.set(topic, t); }
    t.subs.add(fn);
    if (t.value !== undefined) fn(t.value);
    if (!t.timer) this._tick(topic);
    return () => {
      t.subs.delete(fn);
      if (!t.subs.size) { clearTimeout(t.timer); this.topics.delete(topic); }
    };
  }

  async _tick(topic) {
    const t = this.topics.get(topic);
    if (!t) return;
    if (!this.paused && !t.busy) {
      t.busy = true;
      try {
        const v = await this.fetch(topic);
        t.value = v;
        for (const fn of t.subs) { try { fn(v); } catch (e) { console.error(topic, e); } }
      } catch (e) {
        if (topic !== 'clock') console.warn('hub', topic, e.message);
      } finally { t.busy = false; }
    }
    if (this.topics.get(topic) === t) t.timer = setTimeout(() => this._tick(topic), this.interval(topic));
  }

  refresh(topic) {
    const t = this.topics.get(topic);
    if (!t) return;
    clearTimeout(t.timer);
    if (topic.startsWith('integ:')) {
      t.busy = true;
      this.api.integration(topic.slice(6), { refresh: true }).then((v) => { t.value = v; for (const fn of t.subs) fn(v); }).finally(() => { t.busy = false; t.timer = setTimeout(() => this._tick(topic), this.interval(topic)); });
    } else this._tick(topic);
  }

  _mediaIdle() { const m = this.topics.get('media')?.value; return !m?.active || m.status !== 'Playing'; }
  peek(topic) { return this.topics.get(topic)?.value; }
  // paused while nothing of the dock is visible (show-on-hover hidden, full-screen app); resumes with fresh data
  setPaused(p) {
    if (p === this.paused) return;
    this.paused = p;
    if (!p) for (const [topic, t] of this.topics) { clearTimeout(t.timer); this._tick(topic); } // cached values for online services, no forced refresh
  }
}
