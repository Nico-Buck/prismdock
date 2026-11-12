import { icon, ring, bar, esc, fmtDur, fmtClock, fmtDate, fmtTimeShort, relTime, C, WEEKDAYS, WEEKDAYS_LONG, MONTHS, MONTHS_LONG } from '../shared/ui.js';
import { barChart, sparkBars } from '../shared/graph.js';

// Pomodoro lengths from the widget settings, never 0 or empty (that would end every round at once)
const pnum = (ctx, k, d) => Math.max(1, Math.round(Number(ctx.s[k])) || d);
const id = () => Math.random().toString(36).slice(2, 10);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const P = (ctx, n) => Math.round(n * ctx.u);
const smallRing = (ctx, pct, color, label) => ring(pct, { size: P(ctx, 40), stroke: Math.max(3, P(ctx, 4)), color, label });

function beep() {
  try {
    const a = new AudioContext();
    [0, 0.22, 0.44].forEach((t) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, a.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + 0.18);
      o.connect(g).connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.2);
    });
  } catch { /* no audio */ }
}
function notify(title, body) { beep(); try { new Notification(title, { body, silent: true }); } catch { /* ignore */ } }

// Calendar: local events + iCal subscription. Colours for the vertical event bar.
const EV_COLORS = [C.orange, C.blue, C.green, C.purple, C.pink, C.teal];
function allEvents(ctx, ics) {
  const local = (ctx.store.get('events', []) || []).map((e) => ({ ...e, local: true }));
  const remote = ics?.connected ? ics.events.map((e, i) => ({ ...e, color: EV_COLORS[i % EV_COLORS.length] })) : [];
  return [...local, ...remote].sort((a, b) => a.start - b.start);
}
function nextEvent(events) { const now = Date.now(); return events.find((e) => (e.end || e.start) > now && !e.allDay) || events.find((e) => e.start >= new Date().setHours(0, 0, 0, 0)); }

function monthGrid(date, events) {
  const y = date.getFullYear(), m = date.getMonth();
  const first = new Date(y, m, 1); const offset = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - offset);
  const today = dayKey();
  const evDays = new Set(events.map((e) => dayKey(new Date(e.start))));
  let html = '<div class="cal-grid">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<div class="h">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dayKey(d);
    html += `<div class="d ${d.getMonth() !== m ? 'o' : ''} ${k === today ? 't' : ''} ${evDays.has(k) ? 'ev' : ''}">${d.getDate()}</div>`;
  }
  return html + '</div>';
}

// --- pomodoro / timer / stopwatch state (persisted so it survives restarts) ---
function pomoState(ctx) { return ctx.store.get('pomodoro', { phase: 'idle', endsAt: 0, remaining: 0, round: 1, paused: false }); }
function pomoRemaining(st, ctx) {
  if (st.phase === 'idle') return pnum(ctx, 'focus', 25) * 60;
  return st.paused ? st.remaining : Math.max(0, (st.endsAt - Date.now()) / 1000);
}
const dayTile = (now) => `<span class="glyph-tile" style="flex-direction:column;gap:calc(2px*var(--u))"><span class="t-cap red">${WEEKDAYS[now.getDay()]}</span><span style="font-size:calc(18px*var(--fu));font-weight:500;line-height:1" class="num">${now.getDate()}</span></span>`;

export default [
  {
    type: 'calendar', name: 'Calendar', cat: 'productivity', icon: 'calendar', desc: 'Your next event and how soon it starts. Local events plus Google/Outlook via iCal link.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock', 'integ:calendar'],
    tile(ctx, d) {
      const now = new Date();
      if (ctx.size === 's') return `<div class="tin sq">${dayTile(now)}</div>`;
      const ev = nextEvent(allEvents(ctx, d['integ:calendar']));
      if (!ev) return `<div class="tin wide">${dayTile(now)}<div class="col" style="width:calc(112px*var(--u));gap:calc(6px*var(--u))"><span class="t-title">No events</span><span class="t-sub">${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()}</span></div></div>`;
      const st = new Date(ev.start);
      const when = ev.start > Date.now() ? relTime(ev.start) : 'now';
      return `<div class="tin wide">${dayTile(now)}<div class="col" style="max-width:calc(150px*var(--u));gap:calc(6px*var(--u))">
        <div class="row" style="gap:calc(6px*var(--u))"><span style="width:3px;height:calc(12px*var(--u));border-radius:2px;background:${ev.color || C.orange};flex-shrink:0"></span><span class="t-title">${esc(ev.title || 'Event')}</span></div>
        <span class="t-sub num">${ev.allDay ? 'All day' : fmtClock(st, ctx.cfg.behavior.clock24)} · ${when}</span></div></div>`;
    },
    panel(ctx, d) {
      const ics = d['integ:calendar'];
      const events = allEvents(ctx, ics);
      const view = ctx.state.month || new Date();
      const upcoming = events.filter((e) => (e.end || e.start) >= Date.now()).slice(0, 8);
      const nextHour = String((new Date().getHours() + 1) % 24).padStart(2, '0');
      return `<div class="pn"><div class="pn-head"><h3>${MONTHS_LONG[view.getMonth()]} ${view.getFullYear()}</h3><button class="btn icon" data-a="prev" data-tip="Previous month">${icon('arrowLeft', 14)}</button><button class="btn icon" data-a="today" data-tip="Today">${icon('calendar', 14)}</button><button class="btn icon" data-a="next" data-tip="Next month">${icon('arrowRight', 14)}</button></div>
        ${monthGrid(view, events)}
        <div class="pn-sec"><h4>Upcoming</h4>${upcoming.length ? upcoming.map((e) => `<div class="pn-row"><span style="width:3px;height:26px;border-radius:2px;background:${e.color || C.orange}"></span><div class="grow"><b>${esc(e.title)}</b><div class="pn-muted num">${fmtDate(new Date(e.start))}${e.allDay ? '' : ' · ' + fmtClock(new Date(e.start), ctx.cfg.behavior.clock24)}${e.location ? ' · ' + esc(e.location) : ''}</div></div>${e.local ? `<button class="btn icon" data-a="del" data-v="${e.id}" data-tip="Delete">${icon('close', 13)}</button>` : ''}</div>`).join('') : '<div class="pn-muted">No upcoming events.</div>'}</div>
        <div class="pn-sec"><h4>New event</h4><input class="inp" placeholder="Title" data-k="title"><div class="row"><input class="inp" type="date" data-k="date" value="${dayKey()}"><input class="inp" type="time" data-k="time" value="${nextHour}:00"></div><button class="btn primary" data-a="add">${icon('plus', 14)} Add event</button></div>
        ${ics?.connected ? `<div class="pn-muted">${icon('link', 12)} iCal calendar connected · ${ics.events.length} events in the next 5 weeks</div>` : ics?.error ? `<div class="err-note">iCal: ${esc(ics.error)}</div>` : `<div class="pn-muted">Google/Outlook calendar: add its iCal link under Settings → Integrations. <a data-a="connect" style="color:var(--accent)">Connect</a></div>`}</div>`;
    },
    panelWidth: 340,
    on: {
      prev: (ctx) => { const v = ctx.state.month || new Date(); ctx.state.month = new Date(v.getFullYear(), v.getMonth() - 1, 1); ctx.rerender(true); },
      next: (ctx) => { const v = ctx.state.month || new Date(); ctx.state.month = new Date(v.getFullYear(), v.getMonth() + 1, 1); ctx.rerender(true); },
      today: (ctx) => { ctx.state.month = null; ctx.rerender(true); },
      add: (ctx, el) => {
        const p = el.closest('.pn-sec'); const v = (k) => p.querySelector(`[data-k=${k}]`).value;
        if (!v('title').trim()) return;
        const start = new Date(`${v('date')}T${v('time') || '09:00'}`).getTime();
        if (!Number.isFinite(start)) return; // date field cleared
        const events = [...ctx.store.get('events', []), { id: id(), title: v('title').trim(), start, end: start + 3600e3, color: EV_COLORS[Math.floor(Math.random() * EV_COLORS.length)] }];
        ctx.store.set('events', events); ctx.rerender(true);
      },
      del: (ctx, el) => { ctx.store.set('events', ctx.store.get('events', []).filter((e) => e.id !== el.dataset.v)); ctx.rerender(true); },
      connect: (ctx) => ctx.openSettings('integrations'),
    },
  },
  {
    type: 'todos', name: 'To-dos', cat: 'productivity', icon: 'check', desc: 'Your next open task with a progress ring – tick it off from the dock.',
    sizes: ['s', 'm'], size: 'm', topics: [],
    tile(ctx) {
      const list = ctx.store.get('todos', []);
      const done = list.filter((t) => t.done).length; const open = list.filter((t) => !t.done);
      const r = smallRing(ctx, list.length ? (done / list.length) * 100 : 0, C.green, `${done}/${list.length}`);
      if (ctx.size === 's') return `<div class="tin sq">${r}</div>`;
      const next = open[0];
      return `<div class="tin wide">${r}<div class="col" style="max-width:calc(150px*var(--u));gap:calc(6px*var(--u))"><span class="t-title">${next ? esc(next.text) : list.length ? 'All done 🎉' : 'No tasks'}</span><span class="t-sub">${open.length} open</span></div>${next ? `<button class="ico-btn" data-a="check" data-v="${next.id}" data-tip="Mark done" style="width:${P(ctx, 32)}px;height:${P(ctx, 32)}px"><span class="check"></span></button>` : ''}</div>`;
    },
    panel(ctx) {
      const list = ctx.store.get('todos', []);
      return `<div class="pn"><div class="pn-head"><h3>${icon('check', 18)} To-dos</h3><span class="sub">${list.filter((t) => !t.done).length} open</span>${list.some((t) => t.done) ? '<button class="btn" data-a="clear">Clear done</button>' : ''}</div>
        <input class="inp" placeholder="New task … (Enter)" data-enter="add" autofocus>
        <div class="pn-list">${list.length ? list.map((t) => `<div class="pn-item"><span class="check ${t.done ? 'on' : ''}" data-a="check" data-v="${t.id}">${t.done ? icon('checkSmall', 12) : ''}</span><div class="grow"><b class="${t.done ? 'done-text' : ''}">${esc(t.text)}</b></div><button class="btn icon" data-a="del" data-v="${t.id}" data-tip="Delete">${icon('close', 13)}</button></div>`).join('') : '<div class="empty">No tasks yet.</div>'}</div></div>`;
    },
    on: {
      add: (ctx, el) => { const v = el.value.trim(); if (!v) return; ctx.store.set('todos', [...ctx.store.get('todos', []), { id: id(), text: v, done: false, created: Date.now() }]); el.value = ''; ctx.rerender(true); setTimeout(() => ctx.panelEl()?.querySelector('[data-enter]')?.focus(), 0); },
      check: (ctx, el) => { ctx.store.set('todos', ctx.store.get('todos', []).map((t) => (t.id === el.dataset.v ? { ...t, done: !t.done } : t))); ctx.rerender(true); },
      del: (ctx, el) => { ctx.store.set('todos', ctx.store.get('todos', []).filter((t) => t.id !== el.dataset.v)); ctx.rerender(true); },
      clear: (ctx) => { ctx.store.set('todos', ctx.store.get('todos', []).filter((t) => !t.done)); ctx.rerender(true); },
    },
  },
  {
    type: 'notes', name: 'Notes', cat: 'productivity', icon: 'note', desc: 'Your latest note, one click from editing.',
    sizes: ['s', 'm'], size: 'm', topics: [],
    tile(ctx) {
      const notes = ctx.store.get('notes', []);
      const n = notes[0];
      const g = `<span class="glyph-tile" style="background:#ffd60a;color:#5a4500">${icon('note')}</span>`;
      if (ctx.size === 's') return `<div class="tin sq">${g}</div>`;
      const first = n ? n.text.split('\n')[0] : '';
      return `<div class="tin wide">${g}<div class="col" style="max-width:calc(150px*var(--u));gap:calc(6px*var(--u))"><span class="t-title">${n ? esc(first || 'New note') : 'Notes'}</span><span class="t-sub">${n ? fmtDate(new Date(n.updated), { month: 'short', day: 'numeric' }) + ' · ' + notes.length + (notes.length === 1 ? ' note' : ' notes') : 'Click to write'}</span></div></div>`;
    },
    panel(ctx) {
      const notes = ctx.store.get('notes', []);
      const cur = notes.find((n) => n.id === ctx.state.cur) || notes[0];
      return `<div class="pn"><div class="pn-head"><h3>${icon('note', 18)} Notes</h3><button class="btn" data-a="new">${icon('plus', 14)} New</button>${cur ? `<button class="btn icon danger" data-a="del" data-tip="Delete note">${icon('trash', 14)}</button>` : ''}</div>
        ${notes.length > 1 ? `<div class="seg" style="flex-wrap:wrap">${notes.slice(0, 6).map((n) => `<button class="${cur && n.id === cur.id ? 'on' : ''}" data-a="pick" data-v="${n.id}">${esc((n.text.split('\n')[0] || 'New').slice(0, 14))}</button>`).join('')}</div>` : ''}
        <textarea class="inp" data-input="edit" placeholder="Write something …" style="min-height:220px">${esc(cur?.text || '')}</textarea>
        <div class="pn-muted">Saved automatically on this PC.</div></div>`;
    },
    panelWidth: 360,
    on: {
      edit: (ctx, el) => {
        let notes = ctx.store.get('notes', []);
        let cur = notes.find((n) => n.id === ctx.state.cur) || notes[0];
        if (!cur) { cur = { id: id(), text: '', updated: Date.now() }; notes = [cur]; ctx.state.cur = cur.id; }
        cur = { ...cur, text: el.value, updated: Date.now() };
        notes = [cur, ...notes.filter((n) => n.id !== cur.id)];
        ctx.state.cur = cur.id;
        ctx.store.set('notes', notes); ctx.rerenderTile();
      },
      new: (ctx) => { const n = { id: id(), text: '', updated: Date.now() }; ctx.store.set('notes', [n, ...ctx.store.get('notes', [])]); ctx.state.cur = n.id; ctx.rerender(true); setTimeout(() => ctx.panelEl()?.querySelector('textarea')?.focus(), 0); },
      pick: (ctx, el) => { ctx.state.cur = el.dataset.v; ctx.rerender(true); },
      del: (ctx) => { const notes = ctx.store.get('notes', []); const cur = notes.find((n) => n.id === ctx.state.cur) || notes[0]; ctx.store.set('notes', notes.filter((n) => n !== cur)); ctx.state.cur = null; ctx.rerender(true); },
    },
  },
  {
    type: 'pomodoro', name: 'Pomodoro', cat: 'productivity', icon: 'timer', desc: 'Focus rounds and breaks you start and skip from the bar.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock'],
    settings: [{ key: 'focus', label: 'Focus (min)', type: 'number', default: 25, min: 1, max: 120 }, { key: 'brk', label: 'Short break (min)', type: 'number', default: 5, min: 1, max: 60 }, { key: 'longBrk', label: 'Long break (min)', type: 'number', default: 15, min: 1, max: 60 }, { key: 'rounds', label: 'Rounds before a long break', type: 'number', default: 4, min: 1, max: 12 }],
    tick(ctx) {
      const st = pomoState(ctx);
      if (st.phase !== 'idle' && !st.paused && Date.now() >= st.endsAt) {
        const focusDone = st.phase === 'focus';
        const long = focusDone && st.round % pnum(ctx, 'rounds', 4) === 0;
        const next = focusDone ? { phase: 'break', endsAt: Date.now() + (long ? pnum(ctx, 'longBrk', 15) : pnum(ctx, 'brk', 5)) * 60e3, round: st.round, paused: false }
          : { phase: 'focus', endsAt: Date.now() + pnum(ctx, 'focus', 25) * 60e3, round: st.round + 1, paused: false };
        ctx.store.set('pomodoro', next);
        if (focusDone && !st.skipped) { const log = ctx.store.get('pomodoroLog', {}); log[dayKey()] = (log[dayKey()] || 0) + 1; ctx.store.set('pomodoroLog', log); }
        notify(focusDone ? 'Focus round complete' : 'Break is over', focusDone ? `Time for a ${long ? 'long' : 'short'} break.` : `Round ${next.round} starts now.`);
      }
    },
    tile(ctx) {
      const st = pomoState(ctx); const rem = pomoRemaining(st, ctx);
      const total = (st.phase === 'break' ? (st.round % pnum(ctx, 'rounds', 4) === 0 ? pnum(ctx, 'longBrk', 15) : pnum(ctx, 'brk', 5)) : pnum(ctx, 'focus', 25)) * 60;
      const col = st.phase === 'break' ? C.green : C.red;
      const label = st.phase === 'idle' ? `<span style="display:flex">${icon('play', P(ctx, 13))}</span>` : st.paused ? `<span style="display:flex">${icon('pause', P(ctx, 12))}</span>` : `<span style="font-size:calc(9.5px*var(--fu))">${Math.ceil(rem / 60)}</span>`;
      const r = smallRing(ctx, st.phase === 'idle' ? 100 : (rem / total) * 100, col, label);
      if (ctx.size === 's') return `<div class="tin sq" data-a="toggle">${r}</div>`;
      return `<div class="tin wide"><span data-a="toggle" style="display:flex">${r}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-big">${fmtDur(rem)}</span><span class="t-sub">${st.phase === 'idle' ? 'Start focus' : st.phase === 'focus' ? `Focus · round ${st.round}` : 'Break'}${st.paused ? ' · paused' : ''}</span></div></div>`;
    },
    panel(ctx) {
      const st = pomoState(ctx); const rem = pomoRemaining(st, ctx);
      const log = ctx.store.get('pomodoroLog', {})[dayKey()] || 0;
      return `<div class="pn" style="align-items:center;text-align:center"><div class="pn-head" style="width:100%"><h3>${icon('timer', 18)} Pomodoro</h3><span class="sub">${log} ${log === 1 ? 'round' : 'rounds'} today</span></div>
        <div class="pn-big" style="font-size:52px">${fmtDur(rem)}</div><div class="pn-muted">${st.phase === 'idle' ? `${pnum(ctx, 'focus', 25)} min focus · ${pnum(ctx, 'brk', 5)} min break` : st.phase === 'focus' ? `Focus · round ${st.round}` : 'Break'}</div>
        <div class="btns center"><button class="btn round xl ${st.phase !== 'idle' && !st.paused ? '' : 'primary'}" data-a="toggle" data-tip="${st.phase !== 'idle' && !st.paused ? 'Pause' : 'Start'}">${icon(st.phase !== 'idle' && !st.paused ? 'pause' : 'play', 20)}</button><button class="btn round lg" data-a="skip" data-tip="Skip" ${st.phase === 'idle' ? 'disabled' : ''}>${icon('next', 16)}</button><button class="btn round lg" data-a="reset" data-tip="Reset">${icon('refresh', 16)}</button></div></div>`;
    },
    on: {
      toggle: (ctx) => {
        const st = pomoState(ctx);
        if (st.phase === 'idle') ctx.store.set('pomodoro', { phase: 'focus', endsAt: Date.now() + pnum(ctx, 'focus', 25) * 60e3, round: 1, paused: false });
        else if (st.paused) ctx.store.set('pomodoro', { ...st, paused: false, endsAt: Date.now() + st.remaining * 1000 });
        else ctx.store.set('pomodoro', { ...st, paused: true, remaining: Math.max(0, (st.endsAt - Date.now()) / 1000) });
        ctx.rerender(true);
      },
      skip: (ctx) => { const st = pomoState(ctx); ctx.store.set('pomodoro', { ...st, paused: false, endsAt: Date.now(), skipped: true }); ctx.widget.tick(ctx); ctx.rerender(true); },
      reset: (ctx) => { ctx.store.set('pomodoro', { phase: 'idle', round: 1 }); ctx.rerender(true); },
    },
  },
  {
    type: 'stopwatch', name: 'Stopwatch', cat: 'productivity', icon: 'stopwatch', desc: 'Start, pause and lap from the bar; the panel keeps every lap.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock'],
    tile(ctx) {
      const st = ctx.store.get('stopwatch', { running: false, elapsed: 0, laps: [] });
      const el = st.elapsed + (st.running ? (Date.now() - st.startedAt) / 1000 : 0);
      const btn = `<button class="ico-btn" data-a="toggle" data-tip="${st.running ? 'Pause' : 'Start'}" style="width:${P(ctx, 38)}px;height:${P(ctx, 38)}px;background:${st.running ? 'rgba(255,159,10,.22)' : 'rgba(48,209,88,.22)'};color:${st.running ? C.orange : C.green};border-radius:50%">${icon(st.running ? 'pause' : 'play', P(ctx, 15))}</button>`;
      if (ctx.size === 's') return `<div class="tin sq">${btn}</div>`;
      return `<div class="tin">${btn}<div class="col" style="gap:calc(6px*var(--u));width:calc(72px*var(--fu))"><span class="t-big" style="font-size:calc(17px*var(--fu))">${fmtDur(el)}</span><span class="t-sub">${st.laps.length ? st.laps.length + (st.laps.length === 1 ? ' lap' : ' laps') : 'Stopwatch'}</span></div></div>`;
    },
    panel(ctx) {
      const st = ctx.store.get('stopwatch', { running: false, elapsed: 0, laps: [] });
      const el = st.elapsed + (st.running ? (Date.now() - st.startedAt) / 1000 : 0);
      const cs = Math.floor((el % 1) * 100);
      return `<div class="pn" style="text-align:center"><div class="pn-head"><h3>${icon('stopwatch', 18)} Stopwatch</h3></div>
        <div class="pn-big" style="font-size:48px">${fmtDur(el)}<span style="font-size:24px;color:var(--text-2)">.${String(cs).padStart(2, '0')}</span></div>
        <div class="btns center"><button class="btn round lg" data-a="lap" data-tip="Lap" ${st.running ? '' : 'disabled'}>${icon('flag', 15)}</button><button class="btn round xl ${st.running ? '' : 'primary'}" data-a="toggle">${icon(st.running ? 'pause' : 'play', 20)}</button><button class="btn round lg" data-a="reset" data-tip="Reset">${icon('refresh', 15)}</button></div>
        ${st.laps.length ? `<div class="pn-list">${st.laps.map((l, i) => `<div class="pn-row" style="padding:0 6px"><span class="grow dim" style="text-align:left">Lap ${st.laps.length - i}</span><span class="val">${fmtDur(l)}</span></div>`).join('')}</div>` : ''}</div>`;
    },
    panelLive: 'fast',
    on: {
      toggle: (ctx) => { const st = ctx.store.get('stopwatch', { running: false, elapsed: 0, laps: [] }); ctx.store.set('stopwatch', st.running ? { ...st, running: false, elapsed: st.elapsed + (Date.now() - st.startedAt) / 1000 } : { ...st, running: true, startedAt: Date.now() }); ctx.rerender(true); },
      lap: (ctx) => { const st = ctx.store.get('stopwatch'); const el = st.elapsed + (Date.now() - st.startedAt) / 1000; const prev = st.lapBase || 0; ctx.store.set('stopwatch', { ...st, laps: [el - prev, ...st.laps], lapBase: el }); ctx.rerender(true); },
      reset: (ctx) => { ctx.store.set('stopwatch', { running: false, elapsed: 0, laps: [] }); ctx.rerender(true); },
    },
  },
  {
    type: 'countdown', name: 'Timer', cat: 'productivity', icon: 'hourglass', desc: 'A countdown that starts in one click.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock'],
    settings: [{ key: 'minutes', label: 'Default length (min)', type: 'number', default: 10, min: 1, max: 600 }],
    tick(ctx) { const st = ctx.store.get('timer'); if (st?.running && Date.now() >= st.endsAt) { ctx.store.set('timer', { running: false, remaining: 0, duration: st.duration }); notify('Timer finished', `${Math.round(st.duration / 60)} minutes are up.`); } },
    tile(ctx) {
      const st = ctx.store.get('timer', { running: false, duration: ctx.s.minutes * 60, remaining: ctx.s.minutes * 60 });
      const rem = st.running ? Math.max(0, (st.endsAt - Date.now()) / 1000) : st.remaining ?? st.duration;
      const r = smallRing(ctx, (rem / (st.duration || 1)) * 100, C.orange, `<span style="display:flex">${icon(st.running ? 'pause' : 'play', P(ctx, 13))}</span>`);
      if (ctx.size === 's') return `<div class="tin sq" data-a="toggle">${r}</div>`;
      return `<div class="tin wide"><span data-a="toggle" style="display:flex">${r}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-big">${fmtDur(rem)}</span><span class="t-sub">${st.running ? 'Running' : rem === 0 ? 'Finished' : 'Timer'}</span></div></div>`;
    },
    panel(ctx) {
      const st = ctx.store.get('timer', { running: false, duration: ctx.s.minutes * 60, remaining: ctx.s.minutes * 60 });
      const rem = st.running ? Math.max(0, (st.endsAt - Date.now()) / 1000) : st.remaining ?? st.duration;
      return `<div class="pn" style="text-align:center"><div class="pn-head"><h3>${icon('hourglass', 18)} Timer</h3></div>
        <div class="pn-big" style="font-size:52px">${fmtDur(rem)}</div>
        <div class="btns center" style="flex-wrap:wrap">${[1, 5, 10, 15, 25, 45, 60].map((m) => `<button class="btn" data-a="preset" data-v="${m}">${m}m</button>`).join('')}</div>
        <div class="btns center"><button class="btn round xl ${st.running ? '' : 'primary'}" data-a="toggle">${icon(st.running ? 'pause' : 'play', 20)}</button><button class="btn round lg" data-a="reset" data-tip="Reset">${icon('refresh', 15)}</button></div></div>`;
    },
    on: {
      toggle: (ctx) => {
        const st = ctx.store.get('timer', { running: false, duration: ctx.s.minutes * 60, remaining: ctx.s.minutes * 60 });
        if (st.running) ctx.store.set('timer', { ...st, running: false, remaining: Math.max(0, (st.endsAt - Date.now()) / 1000) });
        else { const rem = st.remaining > 0 ? st.remaining : st.duration; ctx.store.set('timer', { ...st, running: true, endsAt: Date.now() + rem * 1000 }); }
        ctx.rerender(true);
      },
      preset: (ctx, el) => { const d = Number(el.dataset.v) * 60; ctx.store.set('timer', { running: true, duration: d, remaining: d, endsAt: Date.now() + d * 1000 }); ctx.rerender(true); },
      reset: (ctx) => { const st = ctx.store.get('timer', {}); const d = st.duration || ctx.s.minutes * 60; ctx.store.set('timer', { running: false, duration: d, remaining: d }); ctx.rerender(true); },
    },
  },
  {
    type: 'screentime', name: 'Screen Time', cat: 'productivity', icon: 'eye', desc: 'Today’s time in front of the PC, hour by hour – and every app’s, by day and by week.',
    sizes: ['s', 'm'], size: 'm', topics: ['screentime'],
    tile(ctx, { screentime: st }) {
      const today = st?.[dayKey()];
      const total = today?.total || 0;
      if (ctx.size === 's') return `<div class="tin sq"><div class="col" style="align-items:center;gap:calc(4px*var(--u))"><span style="display:flex">${icon('eye', P(ctx, 16))}</span><span class="t-val">${fmtDur(total, true)}</span></div></div>`;
      const hrs = (today?.hours || Array(24).fill(0)).slice(6, 24);
      return `<div class="tin wide"><span class="glyph-tile" style="background:linear-gradient(#5e5ce6,#3634a3);color:#fff">${icon('screen')}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-sub">Screen Time</span><span class="t-big">${fmtDur(total, true)}</span></div>${sparkBars(hrs, { w: P(ctx, 56), h: P(ctx, 26), color: C.blue, gap: 1.5, highlight: new Date().getHours() - 6 })}</div>`;
    },
    panel(ctx, { screentime: st }) {
      const today = st?.[dayKey()];
      if (!ctx.cfg.performance.screenTime) return `<div class="pn"><div class="pn-head"><h3>${icon('eye', 18)} Screen Time</h3></div><div class="pn-muted">Tracking is turned off (Settings → Performance).</div></div>`;
      const apps = Object.entries(today?.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const week = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); week.push([WEEKDAYS[d.getDay()], st?.[dayKey(d)]?.total || 0]); }
      const max = apps[0]?.[1] || 1;
      return `<div class="pn"><div class="pn-head"><h3>${icon('eye', 18)} Screen Time</h3><span class="sub">${fmtDur(today?.total || 0, true)} today</span></div>
        <div class="pn-sec"><h4>Today by hour</h4>${barChart(today?.hours || Array(24).fill(0), { h: 60, color: C.blue, gap: 0.3, highlight: new Date().getHours() })}<div class="row" style="justify-content:space-between"><span class="kbd">0</span><span class="kbd">6</span><span class="kbd">12</span><span class="kbd">18</span><span class="kbd">24</span></div></div>
        <div class="pn-sec"><h4>Apps</h4>${apps.length ? apps.map(([n, s]) => `<div class="pn-row"><img data-icon="${esc(today.paths?.[n] || '')}" style="width:20px;height:20px"><span class="grow">${esc(n)}</span><span style="width:90px">${bar((s / max) * 100, C.blue)}</span><span class="val" style="width:52px;text-align:right">${fmtDur(s, true)}</span></div>`).join('') : '<div class="pn-muted">No data for today yet.</div>'}</div>
        <div class="pn-sec"><h4>This week</h4>${barChart(week.map((w) => w[1]), { h: 50, color: C.indigo, gap: 0.45, highlight: 6 })}<div class="row" style="justify-content:space-around">${week.map((w) => `<span class="kbd">${w[0]}</span>`).join('')}</div></div></div>`;
    },
    panelWidth: 350,
  },
  {
    type: 'daytimeline', name: 'Day Timeline', cat: 'productivity', icon: 'sunrise', desc: 'Your whole day on one line: active hours, events, sunrise and sunset.',
    sizes: ['m'], size: 'm', topics: ['clock', 'screentime', 'integ:weather', 'integ:calendar'],
    tile(ctx, d) {
      const now = new Date(); const pos = (now.getHours() * 60 + now.getMinutes()) / 1440;
      const hrs = d.screentime?.[dayKey()]?.hours || Array(24).fill(0);
      const w = d['integ:weather'];
      const sun = w?.connected ? [new Date(w.daily.sunrise[0]), new Date(w.daily.sunset[0])] : null;
      const sp = sun ? sun.map((x) => (x.getHours() * 60 + x.getMinutes()) / 1440) : null;
      const evs = allEvents(ctx, d['integ:calendar']).filter((e) => dayKey(new Date(e.start)) === dayKey() && !e.allDay);
      const W = P(ctx, 170), H = P(ctx, 34), mid = H / 2;
      return `<div class="tin wide"><div class="col" style="gap:calc(5px*var(--u))"><span class="t-cap red">${WEEKDAYS_LONG[now.getDay()]}</span><span class="t-title">${MONTHS[now.getMonth()]} ${now.getDate()}</span></div>
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible">
          ${sp ? `<rect x="${sp[0] * W}" y="${mid - 5}" width="${(sp[1] - sp[0]) * W}" height="10" rx="5" fill="#ffd60a" opacity=".16"/>` : ''}
          <rect x="0" y="${mid - 1}" width="${W}" height="2" rx="1" fill="var(--track)"/>
          ${hrs.map((s, h) => (s > 0 ? `<rect x="${(h / 24) * W + 0.5}" y="${mid - Math.min(9, s / 400)}" width="${W / 24 - 1}" height="${Math.min(9, s / 400) * 2}" rx="1.2" fill="${C.blue}" opacity="${0.35 + Math.min(0.65, s / 3600)}"/>` : '')).join('')}
          ${evs.map((e) => { const s = new Date(e.start); const x = ((s.getHours() * 60 + s.getMinutes()) / 1440) * W; return `<circle cx="${x}" cy="${mid}" r="3" fill="${e.color || C.orange}" stroke="rgba(0,0,0,.4)" stroke-width=".8"/>`; }).join('')}
          <line x1="${pos * W}" x2="${pos * W}" y1="${mid - 10}" y2="${mid + 10}" stroke="#ff453a" stroke-width="1.6" stroke-linecap="round"/>
        </svg></div>`;
    },
    panel(ctx, d) {
      const w = d['integ:weather'];
      const evs = allEvents(ctx, d['integ:calendar']).filter((e) => dayKey(new Date(e.start)) === dayKey());
      const today = d.screentime?.[dayKey()];
      const pomo = ctx.store.get('pomodoroLog', {})[dayKey()] || 0;
      const todos = ctx.store.get('todos', []);
      const now = new Date(); const dayPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
      const h24 = ctx.cfg.behavior.clock24;
      return `<div class="pn"><div class="pn-head"><h3>${WEEKDAYS_LONG[now.getDay()]}, ${MONTHS_LONG[now.getMonth()]} ${now.getDate()}</h3></div>
        <div class="pn-row"><span class="dim" style="width:34px">Day</span>${bar(dayPct, C.red)}<span class="val" style="width:36px;text-align:right">${Math.round(dayPct)}%</span></div>
        <div class="pn-grid c2"><div class="pn-stat"><b>${fmtDur(today?.total || 0, true)}</b><span>Screen time</span></div><div class="pn-stat"><b>${pomo}</b><span>Focus rounds</span></div>
        <div class="pn-stat"><b>${todos.filter((t) => t.done).length}/${todos.length}</b><span>Tasks done</span></div><div class="pn-stat"><b style="font-size:15px">${w?.connected ? `${fmtTimeShort(new Date(w.daily.sunrise[0]), h24)} – ${fmtTimeShort(new Date(w.daily.sunset[0]), h24)}` : '–'}</b><span>Daylight</span></div></div>
        <div class="pn-sec"><h4>Today’s events</h4>${evs.length ? evs.map((e) => `<div class="pn-row"><span style="width:3px;height:20px;border-radius:2px;background:${e.color || C.orange}"></span><span class="grow">${esc(e.title)}</span><span class="dim num">${e.allDay ? 'all day' : fmtClock(new Date(e.start), h24)}</span></div>`).join('') : '<div class="pn-muted">No events today.</div>'}</div></div>`;
    },
  },
  {
    type: 'progress', name: 'Progress', cat: 'productivity', icon: 'chart', desc: 'How much of the day, week, month or year is behind you.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock'],
    settings: [{ key: 'span', label: 'Period', type: 'select', options: [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']], default: 'month' }],
    tile(ctx) {
      const now = new Date(); let a, b, label;
      if (ctx.s.span === 'day') { a = new Date(now).setHours(0, 0, 0, 0); b = new Date(a).setDate(new Date(a).getDate() + 1); label = 'Today'; }
      else if (ctx.s.span === 'week') { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); a = d.getTime(); b = new Date(a).setDate(d.getDate() + 7); label = 'Week'; }
      else if (ctx.s.span === 'year') { a = new Date(now.getFullYear(), 0, 1).getTime(); b = new Date(now.getFullYear() + 1, 0, 1).getTime(); label = String(now.getFullYear()); }
      else { a = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); b = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(); label = MONTHS_LONG[now.getMonth()]; }
      const pct = ((now - a) / (b - a)) * 100;
      if (ctx.s.span === 'year' && ctx.size === 'm') {
        const weekN = Math.floor((now - a) / 864e5 / 7);
        const dot = `calc(4px*var(--u))`;
        let dots = ''; for (let i = 0; i < 52; i++) dots += `<i style="width:${dot};height:${dot};border-radius:1px;background:${i <= weekN ? 'var(--text)' : 'var(--track)'}"></i>`;
        return `<div class="tin wide"><div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${label}</span><span class="t-sub">${Math.round(pct)}%</span></div><div style="display:grid;grid-template-columns:repeat(13,${dot});gap:calc(2.5px*var(--u))">${dots}</div></div>`;
      }
      if (ctx.size === 's') return `<div class="tin sq">${ring(pct, { size: P(ctx, 46), stroke: Math.max(3, P(ctx, 4.5)), color: C.indigo, label: Math.round(pct) + '%', sub: label.slice(0, 3) })}</div>`;
      return `<div class="tin wide"><div class="col" style="gap:calc(7px*var(--u));width:calc(110px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-title">${label}</span><span class="t-val">${pct.toFixed(0)}%</span></div>${bar(pct, C.indigo)}</div></div>`;
    },
  },
];

export { dayKey };
