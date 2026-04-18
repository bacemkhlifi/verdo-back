const OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const TIMEOUT_MS = 10000;

const fetchJson = async (url, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getElevationAtPoint = async (lat, lon) => {
  const url = new URL(OPEN_METEO_ELEVATION_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  const payload = await fetchJson(url.toString());
  const elevation = Array.isArray(payload?.elevation)
    ? payload.elevation[0]
    : payload?.elevation;
  return toNumber(elevation);
};

const metersPerDegreeLat = 111320;

const metersPerDegreeLon = (lat) =>
  111320 * Math.cos((Number(lat) * Math.PI) / 180);

const calculateSlopePercent = async (lat, lon, offsetDegrees = 0.002) => {
  const offsets = [
    [lat, lon],
    [lat + offsetDegrees, lon],
    [lat - offsetDegrees, lon],
    [lat, lon + offsetDegrees],
    [lat, lon - offsetDegrees],
  ];

  const results = await Promise.allSettled(
    offsets.map(([pointLat, pointLon]) => getElevationAtPoint(pointLat, pointLon))
  );

  const center = results[0].status === "fulfilled" ? results[0].value : null;
  const north = results[1].status === "fulfilled" ? results[1].value : null;
  const south = results[2].status === "fulfilled" ? results[2].value : null;
  const east = results[3].status === "fulfilled" ? results[3].value : null;
  const west = results[4].status === "fulfilled" ? results[4].value : null;

  if (center === null) {
    return {
      elevationMeters: null,
      slopePercent: null,
      slopeDegrees: null,
      aspect: null,
    };
  }

  const northSouthDistance = offsetDegrees * metersPerDegreeLat * 2;
  const eastWestDistance = offsetDegrees * metersPerDegreeLon(lat) * 2;

  const nsGradient =
    north !== null && south !== null && northSouthDistance > 0
      ? (north - south) / northSouthDistance
      : null;
  const ewGradient =
    east !== null && west !== null && eastWestDistance > 0
      ? (east - west) / eastWestDistance
      : null;

  const maxGradient = Math.max(
    Math.abs(nsGradient ?? 0),
    Math.abs(ewGradient ?? 0)
  );

  const slopeDegrees = Math.atan(maxGradient) * (180 / Math.PI);
  const slopePercent = maxGradient * 100;

  let aspect = null;
  if (nsGradient !== null || ewGradient !== null) {
    const x = ewGradient ?? 0;
    const y = nsGradient ?? 0;
    const radians = Math.atan2(x, y);
    aspect = (radians * (180 / Math.PI) + 360) % 360;
  }

  return {
    elevationMeters: center,
    slopePercent,
    slopeDegrees,
    aspect,
    provider: "open-meteo",
    free: true,
    dataSources: ["Open-Meteo Elevation"],
    notes: [
      `Estimated slope is ${slopePercent.toFixed(1)}% from surrounding elevation samples.`,
    ],
  };
};

module.exports = {
  getElevationAtPoint,
  calculateSlopePercent,
};
