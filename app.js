// Flâneur: take the scenic route.
// Open data only: OpenFreeMap tiles, Photon geocoding, FOSSGIS OSRM foot routing, Overpass POIs.

const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const PHOTON = "https://photon.komoot.io/api/";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const COLORS = ["#1F3D2B", "#F2A541", "#E4572E", "#7A9E7E"];
const FAST_COLOR = "#9C9A90";

const $ = (s) => document.querySelector(s);
const state = { from: null, to: null, routes: [], sel: 0, pois: [], prefs: new Set(["green", "life", "arch", "water"]) };

// ---------- map ----------
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-83.1497, 42.5803],
  zoom: 13,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
const markers = { from: null, to: null };
let poiMarkers = [];

// ---------- geo helpers ----------
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// distance from point p to polyline (approx, local equirectangular)
function distToLine(p, line) {
  const k = Math.cos(rad(p[1]));
  const P = [p[0] * k, p[1]];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const A = [line[i - 1][0] * k, line[i - 1][1]], B = [line[i][0] * k, line[i][1]];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = A[0] + t * dx - P[0], qy = A[1] + t * dy - P[1];
    const d = Math.sqrt(qx * qx + qy * qy) * 111320;
    if (d < best) best = d;
  }
  return best;
}

// ---------- geocoding ----------
function setupSuggest(inputId, listId, key) {
  const input = $(inputId), list = $(listId);
  let t, items = [], act = -1;
  input.addEventListener("input", () => {
    clearTimeout(t);
    state[key] = null;
    const q = input.value.trim();
    if (q.length < 3) { list.innerHTML = ""; return; }
    t = setTimeout(async () => {
      const c = map.getCenter();
      try {
        const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=5&lat=${c.lat}&lon=${c.lng}`);
        const j = await r.json();
        items = j.features.map((f) => ({
          name: f.properties.name || f.properties.street || q,
          sub: [f.properties.housenumber && f.properties.street ? `${f.properties.housenumber} ${f.properties.street}` : f.properties.street, f.properties.city, f.properties.state].filter(Boolean).join(", "),
          ll: f.geometry.coordinates,
        }));
        act = -1;
        render();
      } catch { /* offline */ }
    }, 250);
  });
  function render() {
    list.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${i === act ? "act" : ""}">${esc(it.name)}<small>${esc(it.sub)}</small></li>`).join("");
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.name;
    state[key] = { name: it.name, ll: it.ll };
    list.innerHTML = "";
    placeMarker(key);
  }
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) pick(+li.dataset.i); });
  input.addEventListener("keydown", (e) => {
    if (!items.length || !list.innerHTML) return;
    if (e.key === "ArrowDown") { act = Math.min(items.length - 1, act + 1); render(); e.preventDefault(); }
    if (e.key === "ArrowUp") { act = Math.max(0, act - 1); render(); e.preventDefault(); }
    if (e.key === "Enter" && act >= 0) { pick(act); e.preventDefault(); }
  });
  input.addEventListener("blur", () => setTimeout(() => (list.innerHTML = ""), 150));
}
async function geocodeOnce(q) {
  const c = map.getCenter();
  const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=1&lat=${c.lat}&lon=${c.lng}`);
  const j = await r.json();
  if (!j.features.length) throw new Error(`Couldn't find “${q}”`);
  return { name: q, ll: j.features[0].geometry.coordinates };
}
function placeMarker(key) {
  if (markers[key]) markers[key].remove();
  const el = document.createElement("div");
  el.style.cssText = `width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);background:${key === "from" ? "#1F3D2B" : "#E4572E"}`;
  markers[key] = new maplibregl.Marker({ element: el }).setLngLat(state[key].ll).addTo(map);
  if (state.from && state.to) fitTo([state.from.ll, state.to.ll]);
  else map.flyTo({ center: state[key].ll, zoom: 15 });
}
function fitTo(coords) {
  const b = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  const mobile = innerWidth < 700;
  map.fitBounds(b, { padding: mobile ? { top: 60, bottom: innerHeight * 0.6, left: 30, right: 30 } : { top: 60, bottom: 60, left: 450, right: 60 }, duration: 700 });
}

$("#locate").addEventListener("click", () => {
  if (!navigator.geolocation) return;
  status("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.from = { name: "My location", ll: [p.coords.longitude, p.coords.latitude] };
      $("#from").value = "My location";
      status("");
      placeMarker("from");
    },
    () => status("Location is off. Type a starting point instead."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---------- prefs ----------
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  b.classList.toggle("on");
  b.classList.contains("on") ? state.prefs.add(b.dataset.k) : state.prefs.delete(b.dataset.k);
  if (state.routes.length) rerank();
});
const alive = $("#alive");
const maxDetour = () => 0.05 + (alive.value / 100) * 0.35; // 5%..40% extra time
function updateDetourLabel() {
  $("#detour-label").textContent = alive.value < 5 ? "fastest only" : `up to +${Math.round(maxDetour() * 100)}% time`;
}
alive.addEventListener("input", updateDetourLabel);
alive.addEventListener("change", () => state.routes.length && rerank());
updateDetourLabel();

// ---------- data ----------
async function osrm(coords) {
  const path = coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(";");
  const alt = coords.length === 2 ? "&alternatives=3" : "";
  const r = await fetch(`${OSRM}${path}?overview=full&geometries=geojson&continue_straight=false${alt}`);
  if (!r.ok) throw new Error("Routing is busy. Try again in a moment.");
  const j = await r.json();
  if (j.code !== "Ok") throw new Error("No walking route found.");
  return j.routes.map((rt) => ({ line: rt.geometry.coordinates, dur: rt.duration, dist: rt.distance }));
}

async function overpass(bbox) {
  const [s, w, n, e] = bbox;
  const b = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:25];
(
  nwr["leisure"~"^(park|garden|nature_reserve|playground)$"](${b});
  nwr["landuse"~"^(forest|meadow|village_green|recreation_ground)$"](${b});
  nwr["natural"~"^(wood|water|beach)$"](${b});
  way["waterway"~"^(river|stream|canal)$"](${b});
  node["amenity"~"^(cafe|restaurant|bar|pub|ice_cream|marketplace|library|theatre|cinema|arts_centre|fountain)$"](${b});
  node["shop"~"^(bakery|books|florist|deli|coffee|art|gift|clothes|antiques|music)$"](${b});
  nwr["historic"](${b});
  nwr["tourism"~"^(artwork|attraction|museum|gallery|viewpoint)$"](${b});
  nwr["amenity"="place_of_worship"](${b});
  nwr["heritage"](${b});
  way["highway"~"^(pedestrian|footway|path|living_street)$"]["name"](${b});
  way["highway"~"^(trunk|primary|motorway)$"](${b});
);
out center bb tags qt 4000;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      return j.elements.map(classify).filter(Boolean);
    } catch (e) { lastErr = e; }
  }
  console.warn("overpass failed", lastErr);
  return [];
}

function classify(el) {
  const t = el.tags || {};
  const ll = el.type === "node" ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
  if (!ll) return null;
  const name = t.name || "";
  let k = null, radius = 40, w = 1;
  if (/^(park|garden|nature_reserve)$/.test(t.leisure) || /^(forest|meadow|village_green|recreation_ground)$/.test(t.landuse) || t.natural === "wood") { k = "green"; radius = 140; w = name ? 3 : 1.5; }
  else if (t.leisure === "playground") { k = "green"; radius = 50; w = 0.6; }
  else if (t.natural === "water" || t.natural === "beach" || t.waterway) { k = "water"; radius = 160; w = 2.5; }
  else if (t.amenity === "fountain") { k = "water"; radius = 40; w = 1; }
  else if (t.historic || t.heritage || /^(artwork|attraction|museum|gallery|viewpoint)$/.test(t.tourism) || t.amenity === "place_of_worship") { k = "arch"; radius = 55; w = name ? 2 : 1; }
  else if (t.amenity || t.shop) { k = "life"; radius = 35; w = t.amenity === "cafe" || t.shop === "bakery" || t.shop === "books" ? 1.4 : 1; }
  else if (/^(pedestrian|footway|path|living_street)$/.test(t.highway)) { k = "quiet"; radius = 25; w = 1.2; }
  else if (/^(trunk|primary|motorway)$/.test(t.highway)) { k = "loud"; radius = 30; w = 1; }
  if (!k) return null;
  const bb = el.bounds ? [el.bounds.minlon, el.bounds.minlat, el.bounds.maxlon, el.bounds.maxlat] : null;
  if (bb && (k === "green" || k === "water")) radius = 35;
  return { k, ll, bb, name, radius, w, kind: t.amenity || t.shop || t.leisure || t.historic || t.tourism || t.natural || t.waterway || t.landuse || t.highway };
}

// ---------- scoring ----------
function scoreRoute(rt, pois) {
  const near = { green: [], life: [], arch: [], water: [], quiet: [], loud: [] };
  // cheap prefilter by bbox
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const c of rt.line) { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
  const pad = 0.002;
  const line = simplify(rt.line);
  for (const p of pois) {
    if (p.ll[0] < w - pad || p.ll[0] > e + pad || p.ll[1] < s - pad || p.ll[1] > n + pad) continue;
    if (p.bb && touchesBox(line, p.bb, p.radius)) near[p.k].push(p);
    else if (!p.bb && distToLine(p.ll, line) <= p.radius) near[p.k].push(p);
  }
  const km = Math.max(0.3, rt.dist / 1000);
  const sum = (arr) => arr.reduce((a, p) => a + p.w, 0);
  const sub = {
    green: Math.min(1, sum(near.green) / (4 * km)),
    life: Math.min(1, sum(near.life) / (10 * km)),
    arch: Math.min(1, sum(near.arch) / (4 * km)),
    water: Math.min(1, sum(near.water) / (2.5 * km)),
    quiet: Math.min(1, sum(near.quiet) / (3 * km)),
  };
  const loud = Math.min(1, near.loud.length / (6 * km));
  rt.near = near;
  rt.sub = sub;
  rt.loud = loud;
  return rt;
}
function touchesBox(line, bb, m) {
  const dLat = m / 111320, dLon = dLat / Math.cos(rad(bb[1]));
  // ignore giant areas (whole-city landuse) to avoid false positives
  if ((bb[2] - bb[0]) * (bb[3] - bb[1]) > 0.0004) return false;
  return line.some((c) => c[0] >= bb[0] - dLon && c[0] <= bb[2] + dLon && c[1] >= bb[1] - dLat && c[1] <= bb[3] + dLat);
}
function aliveness(rt) {
  const keys = [...state.prefs];
  if (!keys.length) return 0;
  let s = keys.reduce((a, k) => a + rt.sub[k], 0) / keys.length;
  s -= (state.prefs.has("quiet") ? 0.35 : 0.15) * rt.loud;
  // variety bonus: serendipity loves a mix
  const variety = ["green", "life", "arch", "water"].filter((k) => rt.near[k].length).length;
  s += variety * 0.04;
  return Math.max(0, Math.min(1, s));
}
function simplify(line) {
  if (line.length < 200) return line;
  const step = Math.ceil(line.length / 200);
  return line.filter((_, i) => i % step === 0 || i === line.length - 1);
}

// ---------- candidate generation ----------
function pickWaypoints(pois, a, b, base, limit) {
  const direct = dist(a, b);
  const budget = Math.max(direct, base.dist) * (1 + limit) * 1.05;
  const cands = [];
  const seen = [];
  const anchors = pois.filter((p) => p.k !== "loud" && p.k !== "quiet" && (p.name || p.k === "green" || p.k === "water"));
  // life clusters: group cafes into hotspots
  const life = pois.filter((p) => p.k === "life");
  for (const p of anchors) {
    const da = dist(a, p.ll), db = dist(p.ll, b);
    if (da + db > budget || da < 80 || db < 80) continue;
    let val = p.w;
    if (p.k === "life") val += life.filter((q) => dist(q.ll, p.ll) < 120).length * 0.5;
    if (!state.prefs.has(p.k) && p.k !== "life") val *= 0.3;
    if (p.k === "life" && !state.prefs.has("life")) val *= 0.3;
    const offLine = distToLine(p.ll, base.line);
    if (offLine < 30) continue; // already on fastest path
    val = val / (1 + (da + db - direct) / 400);
    cands.push({ p, val });
  }
  cands.sort((x, y) => y.val - x.val);
  const out = [];
  for (const c of cands) {
    if (seen.some((s) => dist(s, c.p.ll) < Math.max(150, direct * 0.12))) continue;
    seen.push(c.p.ll);
    out.push(c.p);
    if (out.length >= 6) break;
  }
  return out;
}

function overlap(a, b) {
  const sa = simplify(a.line), sb = simplify(b.line);
  let hit = 0;
  for (const p of sa) if (distToLine(p, sb) < 25) hit++;
  return hit / sa.length;
}

// ---------- main search ----------
let poiCache = { key: "", pois: [] };
async function search() {
  try {
    $("#go").disabled = true;
    if (!state.from) state.from = await geocodeOnce($("#from").value);
    if (!state.to) state.to = await geocodeOnce($("#to").value);
    placeMarker("from"); placeMarker("to");
    const a = state.from.ll, b = state.to.ll;
    if (dist(a, b) > 15000) throw new Error("Flâneur is built for walks. Try somewhere under 15 km.");
    status("Finding the fastest way…");
    const base = await osrm([a, b]);
    const fastest = base[0];
    status("Looking for parks, cafés and beautiful streets nearby…");
    const pad = Math.max(0.004, dist(a, b) / 111320 * 0.35);
    const bbox = [Math.min(a[1], b[1]) - pad, Math.min(a[0], b[0]) - pad / Math.cos(rad(a[1])), Math.max(a[1], b[1]) + pad, Math.max(a[0], b[0]) + pad / Math.cos(rad(a[1]))];
    const key = bbox.map((x) => x.toFixed(3)).join(",");
    if (poiCache.key !== key) poiCache = { key, pois: await overpass(bbox) };
    state.pois = poiCache.pois;

    status("Walking the options for you…");
    const routes = base.map((r, i) => ({ ...r, via: null, alt: i }));
    const wps = pickWaypoints(state.pois, a, b, fastest, 0.4);
    for (const p of wps) {
      try {
        const [r] = await osrm([a, p.ll, b]);
        if (r.dur <= fastest.dur * 1.45) routes.push({ ...r, via: p });
      } catch { /* skip */ }
    }
    // two-stop combo through the two best anchors, ordered along the way
    if (wps.length >= 2) {
      const [p1, p2] = wps.slice(0, 2).sort((x, y) => dist(a, x.ll) - dist(a, y.ll));
      try {
        const [r] = await osrm([a, p1.ll, p2.ll, b]);
        if (r.dur <= fastest.dur * 1.45) routes.push({ ...r, via: p1, via2: p2 });
      } catch {}
    }
    state.all = routes.map((r) => scoreRoute(r, state.pois));
    state.fastest = state.all[0];
    rerank(true);
    if (!state.pois.length) status("Map details are slow right now, so scores may be rough. Try again soon for a better pick.");
    else status("");
    const u = new URL(location);
    u.searchParams.set("from", `${a[1].toFixed(5)},${a[0].toFixed(5)}`);
    u.searchParams.set("to", `${b[1].toFixed(5)},${b[0].toFixed(5)}`);
    u.searchParams.set("fromName", $("#from").value);
    u.searchParams.set("toName", $("#to").value);
    history.replaceState(null, "", u);
  } catch (e) {
    status(e.message || "Something went wrong.");
  } finally {
    $("#go").disabled = false;
  }
}

function rerank(fit) {
  const limit = maxDetour();
  const f = state.fastest;
  const pool = state.all.filter((r) => r !== f && !r.dropped && (r.dur - f.dur) / f.dur <= limit + 0.001);
  const weight = alive.value / 100; // how much the user trades time for life
  for (const r of [f, ...pool]) {
    r.alive = aliveness(r);
    const extra = (r.dur - f.dur) / f.dur;
    r.rank = r.alive - (1 - weight) * extra * 1.5 - extra * 0.4;
  }
  pool.sort((x, y) => y.rank - x.rank);
  const picks = [];
  for (const r of pool) {
    if (r.alive <= f.alive + 0.005) continue;
    if (picks.some((p) => overlap(p, r) > 0.85) || overlap(f, r) > 0.92) continue;
    picks.push(r);
    if (picks.length === 3) break;
  }
  state.routes = alive.value < 5 ? [f] : [...picks, f];
  if (alive.value >= 5 && !picks.length) setTimeout(() => status("The fastest way is already the most alive one here. Slide right for longer wanders."), 0);
  state.sel = 0;
  draw(fit);
  list();
}

// ---------- render ----------
function describe(r) {
  const n = r.near;
  const named = (arr) => arr.filter((p) => p.name).sort((x, y) => y.w - x.w);
  const bits = [];
  const park = named(n.green)[0];
  if (park) bits.push(`past ${park.name}`);
  else if (r.via && r.via.name) bits.push(`via ${r.via.name}`);
  const cafes = n.life.filter((p) => /cafe|coffee|bakery/.test(p.kind)).length;
  const life = n.life.length;
  if (cafes) bits.push(`${cafes} café${cafes > 1 ? "s" : ""}`);
  if (life - cafes > 2) bits.push(`${life - cafes} shops & spots`);
  const arch = named(n.arch)[0];
  if (arch) bits.push(arch.name);
  else if (n.arch.length) bits.push(`${n.arch.length} landmark${n.arch.length > 1 ? "s" : ""}`);
  const water = named(n.water)[0];
  if (water) bits.push(`along ${water.name}`);
  return bits.slice(0, 3).join(" · ") || (r === state.fastest ? "the direct way" : "a calmer way through quieter streets");
}
function title(r, i) {
  if (r === state.fastest) return "The fastest way";
  const s = r.sub;
  const top = Object.entries(s).filter(([k]) => state.prefs.has(k)).sort((x, y) => y[1] - x[1])[0];
  const names = { green: "The green way", life: "The lively way", arch: "The beautiful way", water: "The waterside way", quiet: "The quiet way" };
  return i === 0 ? "The scenic route" : names[top?.[0]] || "The wander";
}
function fmtMin(s) { return Math.max(1, Math.round(s / 60)); }

function list() {
  const f = state.fastest;
  $("#routes").innerHTML = state.routes.map((r, i) => {
    const extra = fmtMin(r.dur) - fmtMin(f.dur);
    const color = r === f ? FAST_COLOR : COLORS[i % COLORS.length];
    const tags = [];
    if (r.near.green.length) tags.push(`🌳 ${r.near.green.length}`);
    if (r.near.life.length) tags.push(`☕ ${r.near.life.length}`);
    if (r.near.arch.length) tags.push(`🏛 ${r.near.arch.length}`);
    if (r.near.water.length) tags.push(`💧 ${r.near.water.length}`);
    const gmaps = gmapsLink(r);
    return `<li class="route ${i === state.sel ? "sel" : ""}" data-i="${i}">
      <div class="top"><h3><span class="swatch" style="background:${color}"></span>${esc(title(r, i))}</h3>
      <span class="time">${fmtMin(r.dur)} min ${r !== f && extra > 0 ? `<span class="extra">+${extra}</span>` : r !== f ? `<span class="extra">same time</span>` : ""}</span></div>
      <p class="why">${esc(describe(r))}</p>
      <div class="bar" title="Aliveness"><i style="width:${Math.round(r.alive * 100)}%"></i></div>
      <div class="tags">${tags.map((t) => `<span>${t}</span>`).join("")}<span>${(r.dist / 1000).toFixed(1)} km</span></div>
      ${i === state.sel ? `<a class="open" href="${gmaps}" target="_blank" rel="noopener">Walk it with turn-by-turn →</a>` : ""}
    </li>`;
  }).join("");
}
$("#routes").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const li = e.target.closest(".route");
  if (!li) return;
  state.sel = +li.dataset.i;
  draw(false);
  list();
});

function gmapsLink(r) {
  const a = state.from.ll, b = state.to.ll;
  const wp = [r.via, r.via2].filter(Boolean).map((p) => `${p.ll[1]},${p.ll[0]}`).join("|");
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("origin", `${a[1]},${a[0]}`);
  u.searchParams.set("destination", `${b[1]},${b[0]}`);
  u.searchParams.set("travelmode", "walking");
  if (wp) u.searchParams.set("waypoints", wp);
  return u.toString();
}

function draw(fit) {
  const feats = state.routes.map((r, i) => ({
    type: "Feature",
    properties: { i, sel: i === state.sel ? 1 : 0, color: r === state.fastest ? FAST_COLOR : COLORS[i % COLORS.length] },
    geometry: { type: "LineString", coordinates: r.line },
  }));
  feats.sort((x, y) => x.properties.sel - y.properties.sel);
  const data = { type: "FeatureCollection", features: feats };
  if (map.getSource("routes")) map.getSource("routes").setData(data);
  else {
    map.addSource("routes", { type: "geojson", data });
    map.addLayer({ id: "routes-casing", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": ["case", ["==", ["get", "sel"], 1], 10, 6] } });
    map.addLayer({ id: "routes-line", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], 6, 3], "line-opacity": ["case", ["==", ["get", "sel"], 1], 1, 0.55] } });
    map.on("click", "routes-line", (e) => {
      state.sel = e.features[0].properties.i;
      draw(false); list();
    });
  }
  // POIs on selected route
  poiMarkers.forEach((m) => m.remove());
  poiMarkers = [];
  const r = state.routes[state.sel];
  const icons = { green: "🌳", life: "☕", arch: "🏛", water: "💧" };
  const shown = ["green", "arch", "water", "life"].flatMap((k) => r.near[k].filter((p) => p.name).slice(0, k === "life" ? 6 : 4));
  for (const p of shown) {
    const el = document.createElement("div");
    el.textContent = icons[p.k];
    el.style.cssText = "font-size:16px;background:#FBF6EC;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer";
    poiMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(p.ll).setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(`<div class="poi-pop">${esc(p.name)}</div>`)).addTo(map));
  }
  if (fit) fitTo(state.routes.flatMap((r) => r.line));
}

function status(msg) { const s = $("#status"); s.hidden = !msg; s.textContent = msg; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

$("#form").addEventListener("submit", (e) => { e.preventDefault(); search(); });
setupSuggest("#from", "#from-s", "from");
setupSuggest("#to", "#to-s", "to");

// mobile sheet toggle
$("#grab").addEventListener("click", () => $("#panel").classList.toggle("min"));

// deep links: ?from=lat,lon&to=lat,lon
const qs = new URLSearchParams(location.search);
function parseLL(v) { const m = v && v.split(",").map(Number); return m && m.length === 2 && m.every(Number.isFinite) ? [m[1], m[0]] : null; }
const qf = parseLL(qs.get("from")), qt = parseLL(qs.get("to"));
map.on("load", () => {
  if (qf && qt) {
    state.from = { name: "Start", ll: qf }; state.to = { name: "Destination", ll: qt };
    $("#from").value = qs.get("fromName") || "Start";
    $("#to").value = qs.get("toName") || "Destination";
    search();
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
