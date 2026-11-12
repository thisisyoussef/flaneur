// Google Maps Platform provider for Flâneur: Routes API (walking), Places API (New), Maps JS.
const K = () => window.FLANEUR_GKEY;
const H = (mask) => ({ "Content-Type": "application/json", "X-Goog-Api-Key": K(), "X-Goog-FieldMask": mask });

export function decodePolyline(str) {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

const wp = (c) => ({ location: { latLng: { latitude: c[1], longitude: c[0] } } });
export async function routes(coords) {
  const body = { origin: wp(coords[0]), destination: wp(coords[coords.length - 1]), travelMode: "WALK", polylineQuality: "HIGH_QUALITY" };
  if (coords.length > 2) body.intermediates = coords.slice(1, -1).map(wp);
  else body.computeAlternativeRoutes = true;
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST", headers: H("routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"), body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Routing failed (" + r.status + ")");
  const j = await r.json();
  if (!j.routes?.length) throw new Error("No walking route found.");
  return j.routes.map((rt) => ({ line: decodePolyline(rt.polyline.encodedPolyline), dur: parseInt(rt.duration), dist: rt.distanceMeters }));
}

export async function autocomplete(q, c) {
  const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": K() },
    body: JSON.stringify({ input: q, locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 30000 } } }),
  });
  const j = await r.json();
  return (j.suggestions || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => ({
    name: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text.text,
    sub: s.placePrediction.structuredFormat?.secondaryText?.text || "",
    id: s.placePrediction.placeId,
  }));
}
export async function placeLL(id) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${id}`, { headers: H("location") });
  const j = await r.json();
  return [j.location.longitude, j.location.latitude];
}
export async function geocode(q, c) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST", headers: H("places.location,places.displayName"),
    body: JSON.stringify({ textQuery: q, pageSize: 1, locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 30000 } } }),
  });
  const j = await r.json();
  const p = j.places?.[0];
  if (!p) throw new Error(`Couldn't find “${q}”`);
  return { name: q, ll: [p.location.longitude, p.location.latitude] };
}

const GROUPS = [
  { k: "green", types: ["park", "garden", "botanical_garden", "national_park", "hiking_area", "dog_park"], radius: 130, w: 3 },
  { k: "life", types: ["cafe", "coffee_shop", "bakery", "book_store", "ice_cream_shop", "tea_house", "dessert_shop"], radius: 40, w: 1.4 },
  { k: "life", types: ["restaurant", "market", "farmers_market", "plaza"], radius: 35, w: 1 },
  { k: "arch", types: ["historical_landmark", "monument", "tourist_attraction", "museum", "art_gallery", "church", "mosque", "synagogue", "hindu_temple", "cultural_landmark", "sculpture", "library", "performing_arts_theater"], radius: 60, w: 2 },
  { k: "water", types: ["marina", "beach", "fountain"], radius: 120, w: 2.5 },
];
async function nearby(group, c, radius) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST", headers: H("places.id,places.displayName,places.location,places.primaryType,places.rating,places.userRatingCount"),
    body: JSON.stringify({ includedTypes: group.types, maxResultCount: 20, rankPreference: "POPULARITY", locationRestriction: { circle: { center: { latitude: c[1], longitude: c[0] }, radius } } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("places " + r.status);
  const j = await r.json();
  return (j.places || []).map((p) => {
    const boost = p.rating ? Math.max(0.6, Math.min(1.5, (p.rating - 3) / 1.3)) * Math.min(1.3, 0.7 + Math.log10(1 + (p.userRatingCount || 0)) / 5) : 0.8;
    return { id: p.id, k: group.k, ll: [p.location.longitude, p.location.latitude], bb: null, name: p.displayName?.text || "", radius: group.radius, w: group.w * boost, kind: p.primaryType || group.types[0] };
  });
}
// sample circles along the start→end corridor
export async function pois(a, b, distM) {
  const n = distM < 1500 ? 1 : distM < 4000 ? 3 : 5;
  const radius = Math.min(50000, Math.max(600, distM / (n === 1 ? 1.4 : n - 0.5)));
  const centers = Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0.5 : i / (n - 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; });
  const jobs = centers.flatMap((c) => GROUPS.map((g) => nearby(g, c, radius).catch((e) => { console.info("places skipped", e.message); return []; })));
  const seen = new Set(), out = [];
  for (const p of (await Promise.all(jobs)).flat()) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
}

// ---- map adapter ----
export async function makeMap(el, start) {
  const s = document.createElement("script");
  await new Promise((res, rej) => {
    window.__flInit = res;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${K()}&v=weekly&libraries=marker&loading=async&callback=__flInit`;
    s.onerror = rej; document.head.appendChild(s);
    setTimeout(() => rej(new Error("maps timeout")), 12000);
  });
  const { Map } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const map = new Map(el, { center: { lat: start[0], lng: start[1] }, zoom: 13, mapId: "DEMO_MAP_ID", disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false });
  let lines = [];
  const g = (c) => ({ lat: c[1], lng: c[0] });
  return {
    kind: "google",
    center() { const c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; },
    marker(ll, html, o = {}) {
      const d = document.createElement("div"); d.innerHTML = html; const node = d.firstElementChild;
      node.style.transform = "translateY(50%)";
      const m = new AdvancedMarkerElement({ map, position: g(ll), content: node, zIndex: o.z || 0, title: o.title || "", gmpClickable: !!o.title });
      if (o.title) { const iw = new google.maps.InfoWindow({ content: `<div class="poi-pop">${o.titleHtml}</div>`, headerDisabled: true }); m.addEventListener("gmp-click", () => iw.open({ map, anchor: m })); }
      return { remove: () => (m.map = null) };
    },
    clearLines() { lines.forEach((l) => l.setMap(null)); lines = []; },
    line(coords, st, onClick) {
      const icons = st.dash ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeWeight: st.weight, strokeColor: st.color }, offset: "0", repeat: "12px" }] : null;
      const pl = new google.maps.Polyline({ map, path: coords.map(g), strokeColor: st.color, strokeWeight: st.weight, strokeOpacity: icons ? 0 : st.opacity, icons, zIndex: st.z || 0 });
      if (onClick) pl.addListener("click", onClick);
      lines.push(pl);
    },
    fit(coords, pad) {
      const b = new google.maps.LatLngBounds(); coords.forEach((c) => b.extend(g(c)));
      map.fitBounds(b, { top: pad.top, left: pad.left, right: pad.right, bottom: pad.bottom });
    },
    flyTo(ll, z) { map.panTo(g(ll)); map.setZoom(z); },
  };
}
