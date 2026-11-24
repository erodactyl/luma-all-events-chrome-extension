// ==UserScript==
// @name         Luma: All Events
// @namespace    luma-all-events
// @version      1.0
// @description  Browse every public Luma event in an area, not just the curated city list.
// @match        https://luma.com/*
// @match        https://lu.ma/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Runs on luma.com in your own browser session and calls the same endpoint the
// site's map view uses (/discover/get-paginated-events) with a bounding box,
// which returns all public events in the box instead of the curated city list.
// Can also be pasted into the browser console on any luma.com page.

(() => {
  if (window.__lumaAllEvents) { window.__lumaAllEvents.open(); return; }

  const API = 'https://api.lu.ma';
  const PAGE_DELAY_MS = 400;
  const MAX_PAGES = 60;
  const CATEGORIES = ['', 'tech', 'ai', 'arts', 'fitness', 'wellness', 'food', 'books', 'climate', 'family', 'games', 'running', 'crypto'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lae:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lae:' + k, JSON.stringify(v)); } catch {} },
  };

  async function api(path, params) {
    const r = await fetch(API + path + '?' + new URLSearchParams(params), { credentials: 'include' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || `HTTP ${r.status}`);
    return body;
  }

  function bbox(lat, lng, km) {
    const dLat = km / 111.32;
    const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng };
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap { position:fixed; inset:0; background:var(--bg); color:var(--fg); font:14px/1.4 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif; display:flex; flex-direction:column;
    --bg:#fafafa; --card:#fff; --fg:#131517; --muted:#737577; --line:#e5e5e7; --accent:#ff6519; --chip:#f0f0f2; }
  @media (prefers-color-scheme: dark) { .wrap { --bg:#131517; --card:#1c1e20; --fg:#f2f2f3; --muted:#9a9c9e; --line:#2c2e30; --chip:#26282a; } }
  header { padding:12px 16px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:var(--card); }
  header h1 { font-size:16px; margin:0 8px 0 0; font-weight:650; }
  input, select, button { font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
  button { cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  label.chk { display:flex; gap:4px; align-items:center; color:var(--muted); white-space:nowrap; }
  .grow { flex:1 1 180px; min-width:140px; }
  .status { padding:8px 16px; color:var(--muted); font-size:13px; border-bottom:1px solid var(--line); }
  main { flex:1; overflow:auto; padding:8px 16px 40px; }
  .day { margin:18px 0 6px; font-weight:650; font-size:15px; position:sticky; top:-8px; background:var(--bg); padding:6px 0; z-index:1; }
  .day span { color:var(--muted); font-weight:400; margin-left:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:8px; }
  a.ev { display:flex; gap:12px; padding:10px; background:var(--card); border:1px solid var(--line); border-radius:12px; text-decoration:none; color:inherit; }
  a.ev:hover { border-color:var(--accent); }
  a.ev img { width:72px; height:72px; border-radius:8px; object-fit:cover; flex:none; background:var(--chip); }
  .t { font-weight:600; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .m { color:var(--muted); font-size:12.5px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tags { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
  .tag { font-size:11.5px; padding:1px 6px; border-radius:6px; background:var(--chip); color:var(--muted); }
  .tag.hot { color:var(--accent); }
  .close { margin-left:auto; }
  @media (max-width:600px) { .grid { grid-template-columns:1fr; } }
</style>
<div class="wrap">
  <header>
    <h1>All Luma events</h1>
    <select id="place" title="Area"></select>
    <button id="near">📍 Near me</button>
    <select id="radius" title="Radius">
      <option value="5">5 km</option><option value="15">15 km</option><option value="30">30 km</option>
      <option value="60">60 km</option><option value="120">120 km</option>
    </select>
    <select id="cat" title="Category"></select>
    <button id="load" class="primary">Load</button>
    <input id="q" class="grow" placeholder="Filter by name, host, calendar, neighborhood…">
    <select id="sort"><option value="date">By date</option><option value="pop">Most popular</option></select>
    <label class="chk"><input type="checkbox" id="free"> Free</label>
    <label class="chk"><input type="checkbox" id="open"> Open only</label>
    <label class="chk">Min guests <input type="number" id="min" min="0" step="10" value="0" style="width:70px"></label>
    <button id="close" class="close" title="Close (Esc)">✕</button>
  </header>
  <div class="status" id="status">Pick an area and press Load.</div>
  <main id="list"></main>
</div>`;
  const $ = (id) => root.getElementById(id);

  let events = [];
  const cardCache = new Map();
  let center = store.get('center', null); // {lat,lng,label}
  let loadToken = 0;

  CATEGORIES.forEach((c) => $('cat').add(new Option(c ? c[0].toUpperCase() + c.slice(1) : 'All categories', c)));
  $('radius').value = String(store.get('radius', 30));
  $('cat').value = store.get('cat', '');

  async function loadPlaces() {
    try {
      const { places } = await api('/discover/bootstrap-page', {});
      const sel = $('place');
      sel.innerHTML = '';
      if (center && center.label === 'Near me') sel.add(new Option('📍 Near me', 'near'));
      const sorted = places.map((p) => p.place).sort((a, b) => a.name.localeCompare(b.name));
      sorted.forEach((p) => {
        const o = new Option(p.name, `${p.coordinate.latitude},${p.coordinate.longitude}`);
        o.dataset.label = p.name;
        sel.add(o);
      });
      if (!center) {
        const nearest = places[0].place; // bootstrap-page lists places nearest-first
        center = { lat: nearest.coordinate.latitude, lng: nearest.coordinate.longitude, label: nearest.name };
      }
      sel.value = center.label === 'Near me' ? 'near' : `${center.lat},${center.lng}`;
    } catch (e) {
      $('status').textContent = 'Could not load city list: ' + e.message;
    }
  }

  $('place').onchange = () => {
    const v = $('place').value;
    if (v === 'near') return;
    const [lat, lng] = v.split(',').map(Number);
    center = { lat, lng, label: $('place').selectedOptions[0].dataset.label };
    load();
  };
  $('near').onclick = () => {
    $('status').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        center = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Near me' };
        if (![...$('place').options].some((o) => o.value === 'near')) $('place').add(new Option('📍 Near me', 'near'), 0);
        $('place').value = 'near';
        load();
      },
      (e) => { $('status').textContent = 'Location unavailable: ' + e.message; },
      { timeout: 10000 },
    );
  };
  $('radius').onchange = $('cat').onchange = () => load();
  $('load').onclick = () => load();
  ['q', 'sort', 'free', 'open', 'min'].forEach((id) => ($(id).oninput = render));
  $('close').onclick = () => close();
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  async function load() {
    if (!center) return;
    const token = ++loadToken;
    const km = Number($('radius').value);
    const slug = $('cat').value;
    store.set('center', center); store.set('radius', km); store.set('cat', slug);
    const params = { ...bbox(center.lat, center.lng, km), pagination_limit: 50 };
    if (slug) params.slug = slug;
    cardCache.clear();
    const seen = new Map();
    let cursor = null;
    let pages = 0;
    events = [];
    render();
    try {
      do {
        const r = await api('/discover/get-paginated-events', cursor ? { ...params, pagination_cursor: cursor } : params);
        if (token !== loadToken) return;
        for (const e of r.entries || []) seen.set(e.event.api_id, e);
        events = [...seen.values()];
        pages++;
        cursor = r.has_more ? r.next_cursor : null;
        $('status').textContent = `Loading… ${events.length} events (page ${pages})`;
        render(true);
        if (cursor) await sleep(PAGE_DELAY_MS);
      } while (cursor && pages < MAX_PAGES);
      render();
    } catch (e) {
      if (token === loadToken) $('status').textContent = `Stopped after ${events.length} events: ${e.message}. Try again in a minute.`;
    }
  }

  function matches(e, q) {
    if (!q) return true;
    const ev = e.event;
    const hay = [ev.name, e.calendar?.name, ev.geo_address_info?.sublocality, ev.geo_address_info?.city, ...(e.hosts || []).map((h) => h.name)].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  function render(loading) {
    const q = $('q').value.trim().toLowerCase();
    const free = $('free').checked, open = $('open').checked, min = Number($('min').value) || 0;
    const now = Date.now();
    let list = events.filter((e) => {
      const end = new Date(e.event.end_at || e.event.start_at).getTime();
      if (end < now) return false;
      if (free && !e.ticket_info?.is_free) return false;
      if (open && (e.ticket_info?.is_sold_out || e.event.waitlist_status === 'active' || e.registration_availability !== 'open')) return false;
      if ((e.guest_count || 0) < min) return false;
      return matches(e, q);
    });
    const byPop = $('sort').value === 'pop';
    list.sort(byPop ? (a, b) => (b.guest_count || 0) - (a.guest_count || 0) : (a, b) => a.event.start_at.localeCompare(b.event.start_at));

    if (!loading) {
      const area = center ? `${center.label}, ${$('radius').value} km` : '';
      $('status').textContent = `${list.length} of ${events.length} upcoming events · ${area}${$('cat').value ? ' · ' + $('cat').value : ''}`;
    }

    const frag = document.createDocumentFragment();
    const newGrid = () => frag.appendChild(Object.assign(document.createElement('div'), { className: 'grid' }));
    if (byPop) {
      const grid = newGrid();
      for (const e of list) grid.appendChild(cardEl(e, true));
    } else {
      const dayOf = (e) => new Date(e.event.start_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: e.event.timezone });
      const counts = new Map();
      for (const e of list) counts.set(dayOf(e), (counts.get(dayOf(e)) || 0) + 1);
      let day = null, grid = null;
      for (const e of list) {
        const d = dayOf(e);
        if (d !== day) {
          const header = frag.appendChild(Object.assign(document.createElement('div'), { className: 'day', textContent: d }));
          header.appendChild(Object.assign(document.createElement('span'), { textContent: counts.get(d) }));
          grid = newGrid();
          day = d;
        }
        grid.appendChild(cardEl(e, false));
      }
    }
    $('list').replaceChildren(frag);
  }

  // Card elements are built once per event and reused across renders, so their
  // images stay loaded while the list is re-sorted, filtered or extended.
  function cardEl(e, showDate) {
    const key = e.event.api_id + (showDate ? ':d' : '');
    let el = cardCache.get(key);
    if (!el) {
      const t = document.createElement('template');
      t.innerHTML = card(e, showDate).trim();
      el = t.content.firstElementChild;
      cardCache.set(key, el);
    }
    return el;
  }

  function card(e, showDate) {
    const ev = e.event, t = e.ticket_info || {};
    const when = new Date(ev.start_at).toLocaleString(undefined, {
      ...(showDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit', timeZone: ev.timezone,
    });
    const where = ev.geo_address_info?.sublocality || ev.geo_address_info?.city || (ev.location_type === 'online' ? 'Online' : '');
    const who = e.calendar && !e.calendar.is_personal ? e.calendar.name : (e.hosts || []).map((h) => h.name).slice(0, 2).join(', ');
    const tags = [];
    if (t.is_free) tags.push('<span class="tag">Free</span>');
    else if (t.price) tags.push(`<span class="tag">${esc(formatPrice(t.price))}</span>`);
    if (t.is_sold_out) tags.push('<span class="tag">Sold out</span>');
    else if (ev.waitlist_status === 'active') tags.push('<span class="tag">Waitlist</span>');
    else if (t.is_near_capacity) tags.push('<span class="tag hot">Almost full</span>');
    if (t.require_approval) tags.push('<span class="tag">Approval</span>');
    if (e.guest_count) tags.push(`<span class="tag${e.guest_count >= 200 ? ' hot' : ''}">${e.guest_count} going</span>`);
    const img = ev.cover_url || '';
    return `<a class="ev" href="https://luma.com/${esc(ev.url)}" target="_blank" rel="noopener">
      <img loading="lazy" src="${esc(img)}" alt="">
      <div style="min-width:0">
        <div class="t">${esc(ev.name)}</div>
        <div class="m">${esc(when)}${where ? ' · ' + esc(where) : ''}</div>
        <div class="m">${esc(who)}</div>
        <div class="tags">${tags.join('')}</div>
      </div></a>`;
  }

  function formatPrice(p) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase() }).format(p.cents / 100); }
    catch { return ''; }
  }

  // ---------- open / close ----------
  let placesLoaded = false;
  function open() {
    host.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';
    if (!placesLoaded) { placesLoaded = true; loadPlaces().then(() => { if (!events.length) load(); }); }
  }
  function close() {
    host.style.display = 'none';
    document.documentElement.style.overflow = '';
    if (location.hash === '#all-events') history.replaceState(null, '', location.pathname + location.search);
  }

  const btn = document.createElement('button');
  btn.textContent = 'All events';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483645;padding:10px 16px;border-radius:999px;border:0;background:#ff6519;color:#fff;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer';
  btn.onclick = open;

  document.body.append(host, btn);
  window.__lumaAllEvents = { open, close };
  if (location.hash === '#all-events' || !window.GM_info) open();
})();
