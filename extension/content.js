// Content script for luma.com. It calls the same endpoint the site's map view
// uses (/discover/get-paginated-events) with a bounding box, which returns all
// public events in an area instead of the curated city list.
//
// The list lives at luma.com/<any page>#all-events?<state>, where <state> holds
// the area, radius, category, filters and sort. Event links open in the same
// tab; going back restores the list from a session cache and scroll position.

(() => {
  if (window.__lumaAllEvents) { window.__lumaAllEvents.open(); return; }

  const API = 'https://api.lu.ma';
  const HASH = '#all-events';
  const PAGE_DELAY_MS = 400;
  const MAX_PAGES = 60;
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const CATEGORIES = ['', 'tech', 'ai', 'arts', 'fitness', 'wellness', 'food', 'books', 'climate', 'family', 'games', 'running', 'crypto'];
  const RADII = [5, 15, 30, 60, 120];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const storage = (area) => ({
    get(k, d) { try { const v = area.getItem('lae:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { area.setItem('lae:' + k, JSON.stringify(v)); } catch {} },
  });
  const prefs = storage(localStorage);
  const session = storage(sessionStorage);

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

  // Keeps only the fields the list uses, so a full area fits in sessionStorage.
  function slim(e) {
    const ev = e.event;
    return {
      event: {
        api_id: ev.api_id, name: ev.name, url: ev.url, cover_url: ev.cover_url,
        start_at: ev.start_at, end_at: ev.end_at, timezone: ev.timezone,
        location_type: ev.location_type, waitlist_status: ev.waitlist_status,
        geo_address_info: { sublocality: ev.geo_address_info?.sublocality, city: ev.geo_address_info?.city },
      },
      calendar: e.calendar ? { name: e.calendar.name, is_personal: e.calendar.is_personal } : null,
      hosts: (e.hosts || []).map((h) => ({ name: h.name })),
      ticket_info: e.ticket_info || {},
      guest_count: e.guest_count || 0,
      registration_availability: e.registration_availability,
    };
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
    --bg:#fafafa; --card:#fff; --fg:#131517; --muted:#737577; --line:#e5e5e7; --accent:#ff6519; --chip:#f0f0f2; --on:#fff1ea; }
  @media (prefers-color-scheme: dark) { .wrap { --bg:#131517; --card:#1c1e20; --fg:#f2f2f3; --muted:#9a9c9e; --line:#2c2e30; --chip:#26282a; --on:#3a2216; } }
  header { padding:12px 16px 10px; border-bottom:1px solid var(--line); background:var(--card); display:grid; gap:8px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  h1 { font-size:17px; margin:0 6px 0 0; font-weight:700; letter-spacing:-.01em; }
  h1 b { color:var(--accent); font-weight:inherit; }
  input, select, button { font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:6px 10px; height:34px; }
  button { cursor:pointer; }
  button:hover, select:hover { border-color:var(--muted); }
  .icon { width:34px; padding:0; display:inline-grid; place-items:center; }
  .spacer { flex:1; }
  .search { flex:1 1 220px; min-width:160px; }
  .toggle { display:inline-flex; align-items:center; gap:6px; padding:0 12px; height:34px; border:1px solid var(--line); border-radius:999px; color:var(--muted); cursor:pointer; user-select:none; white-space:nowrap; }
  .toggle input { display:none; }
  .toggle:has(input:checked) { background:var(--on); border-color:var(--accent); color:var(--accent); }
  .min { display:inline-flex; align-items:center; gap:6px; color:var(--muted); white-space:nowrap; }
  .min input { width:72px; }
  .status { padding:6px 16px; color:var(--muted); font-size:12.5px; border-bottom:1px solid var(--line); }
  main { flex:1; overflow:auto; padding:0 16px 40px; }
  .day { margin:14px 0 6px; font-weight:650; font-size:15px; position:sticky; top:0; background:var(--bg); padding:8px 0 6px; z-index:1; }
  .day span { color:var(--muted); font-weight:400; margin-left:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:8px; }
  .grid.first { margin-top:12px; }
  a.ev { display:flex; gap:12px; padding:10px; background:var(--card); border:1px solid var(--line); border-radius:12px; text-decoration:none; color:inherit; }
  a.ev:hover { border-color:var(--accent); }
  a.ev img { width:72px; height:72px; border-radius:8px; object-fit:cover; flex:none; background:var(--chip); }
  .t { font-weight:600; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .m { color:var(--muted); font-size:12.5px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tags { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
  .tag { font-size:11.5px; padding:1px 6px; border-radius:6px; background:var(--chip); color:var(--muted); }
  .tag.hot { color:var(--accent); }
  .empty { color:var(--muted); text-align:center; padding:48px 0; }
  @media (max-width:600px) {
    header { padding:10px 12px 8px; }
    main { padding:0 12px 40px; }
    .grid { grid-template-columns:1fr; }
    h1 { width:100%; }
  }
</style>
<div class="wrap">
  <header>
    <div class="row">
      <h1>All <b>Luma</b> events</h1>
      <select id="place" title="Area"></select>
      <button id="near" title="Use my location">📍 Near me</button>
      <select id="radius" title="Radius">${RADII.map((r) => `<option value="${r}">${r} km</option>`).join('')}</select>
      <select id="cat" title="Category">${CATEGORIES.map((c) => `<option value="${c}">${c ? c[0].toUpperCase() + c.slice(1) : 'All categories'}</option>`).join('')}</select>
      <button id="refresh" class="icon" title="Reload events">↻</button>
      <span class="spacer"></span>
      <button id="close" class="icon" title="Close (Esc)">✕</button>
    </div>
    <div class="row">
      <input id="q" class="search" type="search" placeholder="Search name, host, calendar, neighborhood…">
      <select id="sort" title="Sort"><option value="date">By date</option><option value="pop">Most popular</option></select>
      <label class="toggle"><input type="checkbox" id="free">Free</label>
      <label class="toggle"><input type="checkbox" id="open">Open only</label>
      <label class="min">Min guests <input type="number" id="min" min="0" step="10" value="0"></label>
    </div>
  </header>
  <div class="status" id="status"></div>
  <main id="list"></main>
</div>`;
  const $ = (id) => root.getElementById(id);

  let events = [];
  const cardCache = new Map();
  let center = prefs.get('center', null); // {lat, lng, label}
  let loadToken = 0;
  let loadedKey = null;
  let placesPromise = null;
  let pageTitle = null;

  $('radius').value = String(prefs.get('radius', 30));
  $('cat').value = prefs.get('cat', '');

  // ---------- URL state ----------
  const isOurHash = () => location.hash === HASH || location.hash.startsWith(HASH + '?');

  function stateHash() {
    const p = new URLSearchParams();
    if (center) {
      p.set('at', `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`);
      p.set('place', center.label);
    }
    p.set('r', $('radius').value);
    if ($('cat').value) p.set('cat', $('cat').value);
    if ($('q').value.trim()) p.set('q', $('q').value.trim());
    if ($('sort').value !== 'date') p.set('sort', $('sort').value);
    if ($('free').checked) p.set('free', '1');
    if ($('open').checked) p.set('open', '1');
    if (Number($('min').value) > 0) p.set('min', $('min').value);
    return HASH + '?' + p.toString();
  }

  function applyHash() {
    const p = new URLSearchParams(location.hash.slice(HASH.length).replace(/^\?/, ''));
    const [lat, lng] = (p.get('at') || '').split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && p.get('at')) center = { lat, lng, label: p.get('place') || 'Custom area' };
    if (p.has('r') && RADII.includes(Number(p.get('r')))) $('radius').value = p.get('r');
    if (p.has('cat') && CATEGORIES.includes(p.get('cat'))) $('cat').value = p.get('cat');
    $('q').value = p.get('q') || '';
    $('sort').value = p.get('sort') === 'pop' ? 'pop' : 'date';
    $('free').checked = p.get('free') === '1';
    $('open').checked = p.get('open') === '1';
    $('min').value = p.get('min') || '0';
  }

  // Filter changes replace the current history entry; only opening the list adds one.
  function syncUrl() {
    if (!isShown()) return;
    const next = stateHash();
    if (location.hash !== next) history.replaceState(history.state, '', location.pathname + location.search + next);
    if (center) document.title = `All events · ${center.label}`;
  }

  // ---------- area ----------
  function loadPlaces() {
    placesPromise ??= api('/discover/bootstrap-page', {}).then(({ places }) => {
      const list = places.map((p) => p.place);
      if (!center) {
        const nearest = list[0]; // bootstrap-page lists places nearest-first
        center = { lat: nearest.coordinate.latitude, lng: nearest.coordinate.longitude, label: nearest.name };
      }
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }).catch((e) => {
      $('status').textContent = 'Could not load city list: ' + e.message;
      return [];
    });
    return placesPromise;
  }

  const placeValue = (c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;

  async function fillPlaces() {
    const places = await loadPlaces();
    const sel = $('place');
    sel.innerHTML = '';
    for (const p of places) {
      const o = new Option(p.name, placeValue({ lat: p.coordinate.latitude, lng: p.coordinate.longitude }));
      o.dataset.label = p.name;
      sel.add(o);
    }
    if (center && ![...sel.options].some((o) => o.value === placeValue(center))) {
      const o = new Option(center.label === 'Near me' ? '📍 Near me' : center.label, placeValue(center));
      o.dataset.label = center.label;
      sel.add(o, 0);
    }
    if (center) sel.value = placeValue(center);
  }

  $('place').onchange = () => {
    const o = $('place').selectedOptions[0];
    const [lat, lng] = o.value.split(',').map(Number);
    center = { lat, lng, label: o.dataset.label };
    syncUrl();
    load();
  };
  $('near').onclick = () => {
    $('status').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        center = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Near me' };
        fillPlaces();
        syncUrl();
        load();
      },
      (e) => { $('status').textContent = 'Location unavailable: ' + e.message; },
      { timeout: 10000 },
    );
  };
  $('radius').onchange = $('cat').onchange = () => { syncUrl(); load(); };
  $('refresh').onclick = () => load({ force: true });

  let urlTimer = null;
  const onFilter = () => { render(); clearTimeout(urlTimer); urlTimer = setTimeout(syncUrl, 300); };
  ['q', 'sort', 'free', 'open', 'min'].forEach((id) => { $(id).oninput = onFilter; $(id).onchange = onFilter; });

  $('close').onclick = () => close();
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.id !== 'q') close(); });

  // Remember where in the list the user was, for when they come back from an event.
  const saveScroll = () => {
    if (!isShown()) return;
    clearTimeout(urlTimer);
    syncUrl();
    session.set('scroll', { hash: location.hash, top: $('list').scrollTop });
  };
  $('list').addEventListener('click', (e) => { if (e.target.closest('a.ev')) saveScroll(); });
  window.addEventListener('pagehide', saveScroll);

  function restoreScroll() {
    const s = session.get('scroll', null);
    if (s && s.hash === location.hash) $('list').scrollTop = s.top;
  }

  // ---------- loading ----------
  async function load({ force = false } = {}) {
    if (!center) return;
    const km = Number($('radius').value);
    const slug = $('cat').value;
    const key = `${placeValue(center)}|${km}|${slug}`;
    prefs.set('center', center); prefs.set('radius', km); prefs.set('cat', slug);
    if (!force && key === loadedKey) return;

    const cached = session.get('cache', null);
    if (!force && cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS) {
      loadToken++;
      loadedKey = key;
      cardCache.clear();
      events = cached.events;
      render();
      restoreScroll();
      return;
    }

    const token = ++loadToken;
    loadedKey = key;
    const params = { ...bbox(center.lat, center.lng, km), pagination_limit: 50 };
    if (slug) params.slug = slug;
    cardCache.clear();
    const seen = new Map();
    let cursor = null;
    let pages = 0;
    events = [];
    $('status').textContent = 'Loading…';
    render(true);
    $('list').scrollTop = 0;
    try {
      do {
        const r = await api('/discover/get-paginated-events', cursor ? { ...params, pagination_cursor: cursor } : params);
        if (token !== loadToken) return;
        for (const e of r.entries || []) seen.set(e.event.api_id, slim(e));
        events = [...seen.values()];
        pages++;
        cursor = r.has_more ? r.next_cursor : null;
        $('status').textContent = `Loading… ${events.length} events`;
        render(true);
        if (cursor) await sleep(PAGE_DELAY_MS);
      } while (cursor && pages < MAX_PAGES);
      session.set('cache', { key, at: Date.now(), events });
      render();
    } catch (e) {
      if (token !== loadToken) return;
      loadedKey = null;
      $('status').textContent = `Stopped after ${events.length} events: ${e.message}. Try ↻ again in a minute.`;
    }
  }

  // ---------- rendering ----------
  function matches(e, q) {
    if (!q) return true;
    const ev = e.event;
    const hay = [ev.name, e.calendar?.name, ev.geo_address_info?.sublocality, ev.geo_address_info?.city, ...e.hosts.map((h) => h.name)].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  function render(loading) {
    const q = $('q').value.trim().toLowerCase();
    const free = $('free').checked, open = $('open').checked, min = Number($('min').value) || 0;
    const now = Date.now();
    const list = events.filter((e) => {
      const end = new Date(e.event.end_at || e.event.start_at).getTime();
      if (end < now) return false;
      if (free && !e.ticket_info.is_free) return false;
      if (open && (e.ticket_info.is_sold_out || e.event.waitlist_status === 'active' || e.registration_availability !== 'open')) return false;
      if (e.guest_count < min) return false;
      return matches(e, q);
    });
    const byPop = $('sort').value === 'pop';
    list.sort(byPop ? (a, b) => b.guest_count - a.guest_count : (a, b) => a.event.start_at.localeCompare(b.event.start_at));

    if (!loading) {
      const area = center ? `${center.label} · ${$('radius').value} km` : '';
      const cat = $('cat').value ? ` · ${$('cat').selectedOptions[0].text}` : '';
      $('status').textContent = list.length === events.length
        ? `${events.length} upcoming events · ${area}${cat}`
        : `${list.length} of ${events.length} upcoming events · ${area}${cat}`;
    }

    const frag = document.createDocumentFragment();
    const newGrid = (first) => frag.appendChild(Object.assign(document.createElement('div'), { className: first ? 'grid first' : 'grid' }));
    if (!list.length && !loading) {
      frag.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: events.length ? 'No events match these filters.' : 'No events found in this area.' }));
    } else if (byPop) {
      const grid = newGrid(true);
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
    const ev = e.event, t = e.ticket_info;
    const when = new Date(ev.start_at).toLocaleString(undefined, {
      ...(showDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit', timeZone: ev.timezone,
    });
    const where = ev.geo_address_info.sublocality || ev.geo_address_info.city || (ev.location_type === 'online' ? 'Online' : '');
    const who = e.calendar && !e.calendar.is_personal ? e.calendar.name : e.hosts.map((h) => h.name).slice(0, 2).join(', ');
    const tags = [];
    if (t.is_free) tags.push('<span class="tag">Free</span>');
    else if (t.price) tags.push(`<span class="tag">${esc(formatPrice(t.price))}</span>`);
    if (t.is_sold_out) tags.push('<span class="tag">Sold out</span>');
    else if (ev.waitlist_status === 'active') tags.push('<span class="tag">Waitlist</span>');
    else if (t.is_near_capacity) tags.push('<span class="tag hot">Almost full</span>');
    if (t.require_approval) tags.push('<span class="tag">Approval</span>');
    if (e.guest_count) tags.push(`<span class="tag${e.guest_count >= 200 ? ' hot' : ''}">${e.guest_count} going</span>`);
    return `<a class="ev" href="https://luma.com/${esc(ev.url)}">
      <img loading="lazy" src="${esc(ev.cover_url || '')}" alt="">
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
  const isShown = () => host.style.display === 'block';

  async function show() {
    if (isOurHash()) applyHash();
    if (!isShown()) {
      pageTitle = document.title;
      host.style.display = 'block';
      document.documentElement.style.overflow = 'hidden';
    }
    await loadPlaces();
    await fillPlaces();
    syncUrl();
    load();
  }

  function hide() {
    if (!isShown()) return;
    host.style.display = 'none';
    document.documentElement.style.overflow = '';
    if (pageTitle != null) document.title = pageTitle;
  }

  // Opening adds a history entry, so the browser's Back button closes the list.
  function open() {
    if (!isOurHash()) history.pushState({ lumaAllEvents: true }, '', location.pathname + location.search + HASH);
    show();
  }

  function close() {
    if (history.state?.lumaAllEvents) { history.back(); return; }
    history.replaceState(history.state, '', location.pathname + location.search);
    hide();
  }

  // Luma sets its own title after loading; keep ours while the list is shown.
  new MutationObserver(() => {
    if (isShown() && center && document.title !== `All events · ${center.label}`) document.title = `All events · ${center.label}`;
  }).observe(document.head, { subtree: true, childList: true, characterData: true });

  const onNavigate = () => (isOurHash() ? show() : hide());
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);
  // Restored from the back/forward cache: the list is already rendered and scrolled.
  window.addEventListener('pageshow', (e) => { if (e.persisted && isOurHash()) show(); });

  const btn = document.createElement('button');
  btn.textContent = 'All events';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483645;padding:10px 16px;border-radius:999px;border:0;background:#ff6519;color:#fff;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer';
  btn.onclick = open;

  document.body.append(host, btn);
  window.__lumaAllEvents = { open, close };

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => { if (msg === 'open-all-events') open(); });
  }
  if (isOurHash()) show();
})();
