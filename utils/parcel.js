const EARTH = 6371008.8;
const rad = (value) => (value * Math.PI) / 180;
function validatePoint(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  )
    throw new Error("INVALID_COORDINATES");
  // Crop profiles and data assumptions in this release are Tunisia-specific.
  if (lat < 30 || lat > 38 || lon < 7 || lon > 12)
    throw new Error("OUTSIDE_SUPPORTED_REGION");
}
function intersects(a, b, c, d) {
  const cross = (p, q, r) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const on = (p, q, r) =>
    Math.abs(cross(p, q, r)) < 1e-12 &&
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}
function parcelFacts(geometry, lat, lon) {
  if (!geometry) return null;
  if (
    geometry.type !== "Polygon" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length !== 1
  )
    throw new Error("INVALID_PARCEL");
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 101)
    throw new Error("INVALID_PARCEL");
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2)
      throw new Error("INVALID_PARCEL");
    validatePoint(point[1], point[0]);
  }
  if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
    throw new Error("UNCLOSED_PARCEL");
  for (let i = 0; i < ring.length - 1; i++)
    for (let j = i + 1; j < ring.length - 1; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 2)) continue;
      if (intersects(ring[i], ring[i + 1], ring[j], ring[j + 1]))
        throw new Error("SELF_INTERSECTING_PARCEL");
    }
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > lat !== b[1] > lat &&
      lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  if (!inside) throw new Error("POINT_OUTSIDE_PARCEL");
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1];
    area += rad(b[0] - a[0]) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }
  const areaHa = Math.abs((area * EARTH * EARTH) / 2) / 10000;
  if (areaHa < 0.01 || areaHa > 10000)
    throw new Error("PARCEL_AREA_OUT_OF_RANGE");
  return {
    geometry,
    areaHa,
    method: "spherical-polygon",
    scope:
      "Point-based environmental estimates; boundary area is calculated, not a cadastral survey.",
  };
}
module.exports = { validatePoint, parcelFacts };
