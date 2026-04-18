const SOILGRIDS_WMS_URL = "https://maps.isric.org/mapserv";
const SOILGRIDS_MAP = "/map/phh2o.map";
const TIMEOUT_MS = 12000;

const fetchText = async (url, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const buildCapabilitiesUrl = () => {
  const url = new URL(SOILGRIDS_WMS_URL);
  url.searchParams.set("map", SOILGRIDS_MAP);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.1.1");
  url.searchParams.set("REQUEST", "GetCapabilities");
  return url;
};

const buildFeatureInfoUrl = ({ layerName, lat, lon }) => {
  const delta = 0.01;
  const minLon = clamp(lon - delta, -179.9999, 179.9999);
  const maxLon = clamp(lon + delta, -179.9999, 179.9999);
  const minLat = clamp(lat - delta, -89.9999, 89.9999);
  const maxLat = clamp(lat + delta, -89.9999, 89.9999);

  const url = new URL(SOILGRIDS_WMS_URL);
  url.searchParams.set("map", SOILGRIDS_MAP);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.1.1");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", layerName);
  url.searchParams.set("QUERY_LAYERS", layerName);
  url.searchParams.set("STYLES", "");
  url.searchParams.set("FORMAT", "image/png");
  url.searchParams.set("TRANSPARENT", "TRUE");
  url.searchParams.set("SRS", "EPSG:4326");
  url.searchParams.set("BBOX", [minLon, minLat, maxLon, maxLat].join(","));
  url.searchParams.set("WIDTH", "101");
  url.searchParams.set("HEIGHT", "101");
  url.searchParams.set("X", "51");
  url.searchParams.set("Y", "51");
  url.searchParams.set("INFO_FORMAT", "text/plain");
  url.searchParams.set("FEATURE_COUNT", "1");
  return url;
};

const parseLayerNames = (capabilitiesText) => {
  const layerMatches = [...capabilitiesText.matchAll(/<Layer[\s\S]*?<Name>([^<]+)<\/Name>/g)];
  return layerMatches.map((match) => match[1]).filter(Boolean);
};

const parseSoilValue = (text) => {
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const extractLineValue = (line) => {
    const matches = [...line.matchAll(/(-?\d+(?:\.\d+)?)/g)].map((match) => toNumber(match[1]));
    const candidates = matches.filter((value) => Number.isFinite(value) && value > 0 && value < 14);
    return candidates.length ? candidates[candidates.length - 1] : null;
  };

  for (const line of lines) {
    if (/value|mean|median|ph/i.test(line)) {
      const value = extractLineValue(line);
      if (value !== null && value >= 3 && value <= 10.5) {
        return value;
      }
    }
  }

  for (const line of lines) {
    const value = extractLineValue(line);
    if (value !== null && value >= 3 && value <= 10.5) {
      return value;
    }
  }

  return null;
};

const getCandidateLayers = (layerNames) => {
  const preferred = [
    "phh2o_0-5cm_mean",
    "phh2o_0-5cm_Q0.5",
    "phh2o_0-5cm_median",
    "phh2o_0-5cm_q0.5",
  ];

  const normalized = new Map(layerNames.map((name) => [String(name).toLowerCase(), name]));
  const matches = [];

  for (const desired of preferred) {
    const match = normalized.get(desired.toLowerCase());
    if (match) {
      matches.push(match);
    }
  }

  if (!matches.length) {
    matches.push(...layerNames.filter((name) => /phh2o/i.test(name) && /0-5cm/i.test(name)));
  }

  return [...new Set(matches)];
};

const getSoilSignals = async (lat, lon) => {
  const capabilitiesUrl = buildCapabilitiesUrl();
  const capabilitiesText = await fetchText(capabilitiesUrl.toString());
  const layerNames = parseLayerNames(capabilitiesText);
  const candidateLayers = getCandidateLayers(layerNames);

  const triedLayers = candidateLayers.length
    ? candidateLayers
    : ["phh2o_0-5cm_mean", "phh2o_0-5cm_Q0.5"];

  const errors = [];

  for (const layerName of triedLayers) {
    try {
      const featureInfoUrl = buildFeatureInfoUrl({ layerName, lat, lon });
      const responseText = await fetchText(featureInfoUrl.toString());
      const ph = parseSoilValue(responseText);

      if (ph !== null) {
        return {
          provider: "soilgrids",
          free: true,
          dataSources: ["SoilGrids WMS"],
          ph,
          layerName,
          depth: "0-5cm",
          notes: [
            `Soil pH at the topsoil layer is about ${ph.toFixed(1)}.`,
          ],
        };
      }
    } catch (error) {
      errors.push(`${layerName}: ${error.message}`);
    }
  }

  return {
    provider: "soilgrids",
    free: true,
    dataSources: ["SoilGrids WMS"],
    ph: null,
    depth: "0-5cm",
    notes: [
      "Soil pH could not be loaded from SoilGrids WMS.",
      ...(errors.length ? [`Tried: ${errors.slice(0, 2).join(" | ")}`] : []),
    ],
  };
};

module.exports = {
  getSoilSignals,
};
