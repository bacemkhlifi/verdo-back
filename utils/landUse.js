const { readFileSync } = require("node:fs");
const { gunzipSync } = require("node:zlib");
const path = require("node:path");
const { fetchJson } = require("./providerHttp");

// Bundled public-domain map: this check works even if Overpass is unavailable.
const ocean = JSON.parse(
  gunzipSync(
    readFileSync(path.join(__dirname, "../data/oceans-10m.geojson.gz")),
  ),
);
const oceanPolygons = ocean.features.flatMap((f) =>
  f.geometry.type === "MultiPolygon"
    ? f.geometry.coordinates
    : [f.geometry.coordinates],
);
function inRing(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [xj, yj] = ring[j];
    if (y > lat !== yj > lat && lon < ((xj - x) * (lat - y)) / (yj - y) + x)
      inside = !inside;
  }
  return inside;
}
function distanceToRing(ring, lat, lon) {
  const scaleX = 111320 * Math.cos((lat * Math.PI) / 180),
    scaleY = 111320;
  let nearest = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - lon) * scaleX,
      ay = (ring[i - 1][1] - lat) * scaleY;
    const bx = (ring[i][0] - lon) * scaleX,
      by = (ring[i][1] - lat) * scaleY;
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
    );
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}
function isOpenSea(lat, lon) {
  // Generalized coastlines are not parcel boundaries. Never block a point
  // within 1 km of a mapped coastline; use detailed OSM geometry there.
  return oceanPolygons.some(
    (rings) =>
      inRing(rings[0], lat, lon) &&
      !rings.slice(1).some((r) => inRing(r, lat, lon)) &&
      rings.every((r) => distanceToRing(r, lat, lon) > 1000),
  );
}
function closedRing(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 4) return null;
  const ring = geometry.map((p) => [p.lon, p.lat]);
  if (!ring.every((p) => p.every(Number.isFinite))) return null;
  return ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ? ring
    : null;
}
function elementContains(element, lat, lon) {
  const ring = closedRing(element.geometry);
  if (ring) return inRing(ring, lat, lon);
  // Assemble split OSM relation rings; respect islands/courtyards (inner rings).
  if (element.type !== "relation") return false;
  if (
    (element.members || []).some(
      (m) => m.type === "way" && !Array.isArray(m.geometry),
    )
  )
    return false;
  const rings = (role) => {
    const parts = (element.members || [])
      .filter(
        (m) =>
          m.type === "way" &&
          (m.role || "outer") === role &&
          Array.isArray(m.geometry),
      )
      .map((m) => [...m.geometry]);
    const joined = [];
    const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
    while (parts.length) {
      const line = parts.pop();
      if (!line.length) continue;
      while (!same(line[0], line.at(-1))) {
        const index = parts.findIndex(
          (p) =>
            p.length &&
            (same(line.at(-1), p[0]) || same(line.at(-1), p.at(-1))),
        );
        if (index < 0) break;
        const next = parts.splice(index, 1)[0];
        if (!same(line.at(-1), next[0])) next.reverse();
        line.push(...next.slice(1));
      }
      const r = closedRing(line);
      if (!r) return null;
      joined.push(r);
    }
    return joined;
  };
  const outer = rings("outer"),
    inner = rings("inner");
  return (
    !!outer &&
    !!inner &&
    outer.some((r) => inRing(r, lat, lon)) &&
    !inner.some((r) => inRing(r, lat, lon))
  );
}
function mapGeometry(payload) {
  const elements = payload.elements;
  const nodes = new Map(
    elements.filter((e) => e.type === "node").map((e) => [e.id, e]),
  );
  const ways = new Map(
    elements
      .filter((e) => e.type === "way")
      .map((e) => {
        const points = (e.nodes || []).map((id) => nodes.get(id));
        return [
          e.id,
          {
            ...e,
            geometry:
              points.length && points.every(Boolean)
                ? points.map((p) => ({ lat: p.lat, lon: p.lon }))
                : undefined,
          },
        ];
      }),
  );
  return {
    elements: elements.map((e) =>
      e.type === "way"
        ? ways.get(e.id)
        : e.type === "relation"
          ? {
              ...e,
              members: (e.members || []).map((m) => ({
                ...m,
                geometry: ways.get(m.ref)?.geometry,
              })),
            }
          : e,
    ),
  };
}
function classifyLandUse(payload, lat, lon) {
  const elements = payload?.elements || [];
  const overlapping = elements
    .filter((e) => elementContains(e, lat, lon))
    .map((e) => e.tags || {});
  const water = overlapping.some(
    (t) =>
      t.natural === "water" ||
      t.water ||
      ["reservoir", "basin", "salt_pond"].includes(t.landuse),
  );
  const building = overlapping.some((t) => t.building && t.building !== "no");
  const other = overlapping.some(
    (t) =>
      ["quarry", "landfill", "cemetery"].includes(t.landuse) ||
      (t.area === "yes" &&
        (t.highway || ["runway", "taxiway", "apron"].includes(t.aeroway))),
  );
  const classification = water
    ? "water"
    : building
      ? "built_up"
      : other
        ? "non_agricultural"
        : "unknown";
  return {
    classification,
    isAgricultureAvailable: water || building || other ? false : null,
    source: "openstreetmap",
    status: "available",
    nearbyBuildings: elements.filter(
      (e) => e.tags?.building && e.tags.building !== "no",
    ).length,
    nearbyWater: elements.some(
      (e) =>
        e.tags?.natural === "water" ||
        e.tags?.waterway ||
        e.tags?.natural === "coastline",
    ),
    summary:
      "Point containment screening only; unmarked areas and legal land availability require verification.",
  };
}
const cache = new Map();
async function checkLocation(lat, lon, request = fetchJson) {
  if (isOpenSea(lat, lon))
    return {
      classification: "sea",
      isAgricultureAvailable: false,
      status: "available",
      source: "natural-earth-10m",
      scope: "Selected point; 1 km coastal uncertainty buffer",
    };
  // Exact coordinates: rounding can misclassify points either side of a building.
  const key = `${lat},${lon}`,
    previous = cache.get(key);
  if (previous?.expires > Date.now()) return previous.value;
  const query = `[out:json][timeout:4];is_in(${lat},${lon})->.areas;(way(around:60,${lat},${lon})[building];way(around:60,${lat},${lon})[natural=water];way(around:60,${lat},${lon})[landuse];way(around:60,${lat},${lon})[area=yes][highway];way(around:60,${lat},${lon})[area=yes][aeroway];way(pivot.areas)[building];way(pivot.areas)[natural=water];way(pivot.areas)[landuse];relation(pivot.areas)[natural=water];relation(pivot.areas)[water];relation(pivot.areas)[building];);out tags geom;`;
  const options = {
    headers: {
      "User-Agent": "VerdOlive-GeoAI/1.0 (+https://verdolive.tn/geoai)",
    },
  };
  const box = [lon - 0.0015, lat - 0.0015, lon + 0.0015, lat + 0.0015].join(
    ",",
  );
  // The main OSM map API is a lightweight independent footprint source.
  // Query in parallel with Overpass, which also finds large containing areas.
  const results = await Promise.all(
    [
      {
        url: `https://www.openstreetmap.org/api/0.6/map.json?bbox=${box}`,
        normalize: mapGeometry,
      },
      {
        url: `https://overpass-api.de/api/interpreter?${new URLSearchParams({ data: query })}`,
        normalize: (p) => p,
      },
    ].map(async ({ url, normalize }) => {
      try {
        const payload = await request(url, options, 4000);
        if (!Array.isArray(payload?.elements) || payload.remark)
          throw new Error("INCOMPLETE_MAP_RESPONSE");
        return classifyLandUse(normalize(payload), lat, lon);
      } catch {
        return null;
      }
    }),
  );
  const value =
    results.find((r) => r?.isAgricultureAvailable === false) ||
    results.find(Boolean);
  if (value) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + 3600000 });
    return value;
  }
  return {
    classification: "unknown",
    isAgricultureAvailable: null,
    status: "unavailable",
    source: "openstreetmap",
  };
}
module.exports = {
  checkLocation,
  classifyLandUse,
  isOpenSea,
  elementContains,
  mapGeometry,
};
