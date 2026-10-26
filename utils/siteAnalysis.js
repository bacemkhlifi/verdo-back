const { fetchJson } = require("./providerHttp");
const { getOpenMeteoSignals } = require("./openMeteoSignals");
const { getNasaPowerSignals } = require("./nasaPowerSignals");
const { calculateSlopePercent } = require("./terrainSignals");
const { getSoilSignals } = require("./soilSignals");
const { getCropRecommendations } = require("./cropSuitability");
const { validatePoint, parcelFacts } = require("./parcel");

const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
function bounded(value, min, max, code) {
  if (value === undefined || value === null || value === "") return null;
  if (number(value) === null || value < min || value > max)
    throw new Error(code);
  return value;
}
function validateInput(body) {
  if (!body || typeof body !== "object") throw new Error("INVALID_REQUEST");
  const { lat, lon } = body;
  validatePoint(lat, lon);
  const c = body.constraints || {},
    s = body.soil_test || {};
  if (
    typeof c !== "object" ||
    Array.isArray(c) ||
    typeof s !== "object" ||
    Array.isArray(s)
  )
    throw new Error("INVALID_INPUTS");
  if (
    c.water_access !== undefined &&
    c.water_access !== null &&
    typeof c.water_access !== "boolean"
  )
    throw new Error("INVALID_WATER_ACCESS");
  const constraints = {
    country: "TN",
    water_access: c.water_access ?? null,
    slope_max: bounded(c.slope_max, 0, 100, "INVALID_SLOPE"),
    water_ec_dS_m: bounded(c.water_ec_dS_m, 0, 50, "INVALID_WATER_EC"),
  };
  const soil_test = {
    ph: bounded(s.ph, 3, 10.5, "INVALID_SOIL_PH"),
    ec_dS_m: bounded(s.ec_dS_m, 0, 50, "INVALID_SOIL_EC"),
    organic_matter: bounded(s.organic_matter, 0, 100, "INVALID_ORGANIC_MATTER"),
  };
  return {
    lat,
    lon,
    constraints,
    soil_test,
    parcel: parcelFacts(body.parcel, lat, lon),
  };
}
const caches = new Map();
async function cached(key, fetcher, ttl) {
  const old = caches.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = await fetcher();
  if (
    value &&
    !["unavailable", "partial"].includes(value.status) &&
    !(Object.hasOwn(value, "ph") && value.ph === null) &&
    !(Object.hasOwn(value, "slopePercent") && value.slopePercent === null) &&
    !(
      value.climate &&
      (value.climate.annualRainMm === null || value.climate.meanTempC === null)
    )
  ) {
    if (caches.size >= 128) caches.delete(caches.keys().next().value);
    caches.set(key, { value, expires: Date.now() + ttl });
  }
  return value;
}
function classifyLandUse(payload, lat, lon) {
  // Nearby map features are context, not evidence of parcel intersection.
  const tags = (payload?.elements || []).map((x) => x.tags || {});
  const contains = (element) => {
    const g = element.geometry;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Array.isArray(g) ||
      g.length < 4 ||
      g[0].lat !== g.at(-1).lat ||
      g[0].lon !== g.at(-1).lon
    )
      return false;
    let inside = false;
    for (let i = 0, j = g.length - 1; i < g.length; j = i++)
      if (
        g[i].lat > lat !== g[j].lat > lat &&
        lon <
          ((g[j].lon - g[i].lon) * (lat - g[i].lat)) / (g[j].lat - g[i].lat) +
            g[i].lon
      )
        inside = !inside;
    return inside;
  };
  const overlapping = (payload?.elements || [])
    .filter(contains)
    .map((e) => e.tags || {});
  const water = overlapping.some(
    (t) =>
      t.natural === "water" ||
      t.water ||
      ["reservoir", "basin", "salt_pond"].includes(t.landuse),
  );
  const building = overlapping.some(
    (t) =>
      (t.building && t.building !== "no") ||
      ["residential", "industrial", "commercial", "retail"].includes(t.landuse),
  );
  const classification = water ? "water" : building ? "built_up" : "unknown";
  return {
    classification,
    isAgricultureAvailable: water || building ? false : null,
    source: "openstreetmap",
    nearbyBuildings: tags.filter((t) => t.building && t.building !== "no")
      .length,
    nearbyWater: tags.some(
      (t) => t.natural === "water" || t.waterway || t.natural === "coastline",
    ),
    summary:
      "Nearby map features are contextual. Parcel land use and legal availability require verification.",
  };
}
async function getLandUse(lat, lon) {
  const query = `[out:json][timeout:5];is_in(${lat},${lon})->.areas;(way(around:80,${lat},${lon})[building];way(around:80,${lat},${lon})[natural=water];way(around:80,${lat},${lon})[landuse];way(pivot.areas)[landuse];way(pivot.areas)[building];way(pivot.areas)[natural=water];);out tags geom;`;
  return classifyLandUse(
    await fetchJson(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      },
      7000,
    ),
    lat,
    lon,
  );
}
function upstreamRequest(input) {
  return {
    site: { lat: input.lat, lon: input.lon, radius_m: 500 },
    constraints: {
      country: "TN",
      irrigation_available: input.constraints.water_access,
      water_ec_dS_m: input.constraints.water_ec_dS_m,
    },
    soil_test: { ph: input.soil_test.ph, ec_dS_m: input.soil_test.ec_dS_m },
  };
}
async function getExternal(input) {
  const result = await fetchJson(
    process.env.GEOAI_API_URL ||
      "https://geoai-ahao.onrender.com/v1/site-analysis",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamRequest(input)),
    },
    Math.max(
      5000,
      Math.min(30000, Number(process.env.GEOAI_TIMEOUT_MS) || 25000),
    ),
  );
  if (
    !result ||
    typeof result !== "object" ||
    !result.indicators ||
    !Array.isArray(result.recommendations)
  )
    throw new Error("INVALID_PROVIDER_RESPONSE");
  return result;
}
function assembleAnalysis(input, signals, statuses) {
  const { openMeteo, nasaPower, terrain, soil, external, landUse } = signals;
  const upstream = external?.indicators || {};
  const indicators = {
    ...upstream,
    annual_rainfall_mm_est:
      number(upstream.annual_rainfall_mm_est) ??
      number(nasaPower?.climate?.annualRainMm),
    mean_temp_c_est:
      number(upstream.avg_tmean_c) ??
      number(upstream.mean_temp_c_est) ??
      number(nasaPower?.climate?.meanTempC),
    aridity_class: String(
      upstream.aridity_class || nasaPower?.summary?.classification || "unknown",
    ).toLowerCase(),
    drought_risk: String(upstream.drought_risk || "unknown").toLowerCase(),
  };
  const ph = input.soil_test.ph ?? number(soil?.ph),
    slope = input.constraints.slope_max ?? number(terrain?.slopePercent);
  const apiInsights = {
    openMeteo,
    nasaPower,
    terrain,
    soil,
    derivedInputs: { soilPh: ph, slopeMax: slope },
    providerSummary: statuses
      .filter((s) => s.status === "available" || s.status === "partial")
      .map((s) => s.provider),
    sources: statuses,
    notes: [],
    provenance: {
      soilPh: input.soil_test.ph !== null ? "user-entered" : "modeled-topsoil",
      slopeMax:
        input.constraints.slope_max !== null
          ? "user-entered"
          : "estimated-point",
    },
  };
  let recommendations = getCropRecommendations({
    form: {
      lat: input.lat,
      soilPh: ph ?? "",
      slopeMax: slope ?? "",
      waterAccess:
        input.constraints.water_access === null
          ? "unknown"
          : String(input.constraints.water_access),
      waterSalinity: input.constraints.water_ec_dS_m ?? "",
      organicMatter: input.soil_test.organic_matter ?? "",
    },
    result: { indicators },
    apiInsights,
  });
  recommendations = recommendations.map((crop) => {
    const upstreamCrop = external?.recommendations.find(
      (r) =>
        r.crop_key === crop.cropKey ||
        String(r.activity).toLowerCase() === crop.activity.toLowerCase(),
    );
    const blocked =
      String(upstreamCrop?.fit).toLowerCase() === "unsuitable" ||
      upstreamCrop?.status === "not_suitable";
    const status = blocked
      ? "not_suitable"
      : crop.status === "recommended"
        ? "conditional"
        : crop.status;
    return {
      ...crop,
      status,
      exclusions: [
        ...crop.exclusions,
        ...(blocked ? ["provider_exclusion"] : []),
      ],
      confidence: "low",
      missingInputs: [
        ...new Set([
          ...crop.missingInputs,
          "rootZoneSoil",
          "waterVolume",
          "fieldVerification",
        ]),
      ],
      evidence: upstreamCrop?.evidence || [],
      requirements: [
        ...crop.requirements,
        ...(upstreamCrop?.requirements || []),
      ],
      provisional: ["fig", "pomegranate"].includes(crop.cropKey),
    };
  });
  const priority = {
    recommended: 0,
    conditional: 1,
    insufficient_data: 2,
    not_suitable: 3,
  };
  if (landUse?.isAgricultureAvailable === false)
    recommendations = recommendations.map((c) => ({
      ...c,
      status: "not_suitable",
      score: null,
      fit: "unsuitable",
      exclusions: [...c.exclusions, "landUse"],
    }));
  recommendations.sort(
    (a, b) =>
      priority[a.status] - priority[b.status] ||
      (b.score ?? -1) - (a.score ?? -1),
  );
  const hasClimate =
    number(indicators.annual_rainfall_mm_est) !== null &&
    number(indicators.mean_temp_c_est) !== null;
  return {
    version: "feasibility-1",
    generatedAt: new Date().toISOString(),
    site: { lat: input.lat, lon: input.lon },
    inputSnapshot: input,
    parcel: input.parcel,
    indicators,
    apiInsights,
    recommendations,
    externalRecommendations: external?.recommendations || [],
    landUseCheck: landUse || {
      classification: "unknown",
      isAgricultureAvailable: null,
    },
    siteAssessment: {
      isAgricultureAvailable: landUse?.isAgricultureAvailable ?? null,
      status:
        landUse?.isAgricultureAvailable === false
          ? "excluded"
          : hasClimate
            ? "preliminary"
            : "insufficient_data",
      confidence: "low",
    },
    analysisWarning: !external ? "EXTERNAL_UNAVAILABLE" : null,
    scope:
      "Point-based screening, not parcel certification. Suitability scores are rule indices, not success probabilities.",
    nextActions: [
      "rootZoneSoil",
      "waterVolume",
      "waterQuality",
      "fieldVerification",
    ],
    providerStatuses: statuses,
    risks: external?.risks || [],
  };
}
async function analyzeSite(input) {
  const point = `${input.lat.toFixed(4)},${input.lon.toFixed(4)}`;
  const jobs = {
    openMeteo: () =>
      cached(
        "weather:" + point,
        () => getOpenMeteoSignals(input.lat, input.lon),
        3600000,
      ),
    nasaPower: () =>
      cached(
        "climate:" + point,
        () => getNasaPowerSignals(input.lat, input.lon),
        86400000,
      ),
    terrain: () =>
      cached(
        "terrain:" + point,
        () => calculateSlopePercent(input.lat, input.lon),
        86400000,
      ),
    soil: () =>
      cached(
        "soil:" + point,
        () => getSoilSignals(input.lat, input.lon),
        86400000,
      ),
    external: () => getExternal(input),
    landUse: () =>
      cached(
        "landuse:" + point,
        () => getLandUse(input.lat, input.lon),
        86400000,
      ),
  };
  const signals = {},
    statuses = [];
  await Promise.all(
    Object.entries(jobs).map(async ([provider, run]) => {
      const started = Date.now();
      try {
        signals[provider] = await run();
        const value = signals[provider];
        const status =
          value?.status ||
          (provider === "soil" && value?.ph === null
            ? "partial"
            : provider === "terrain" && value?.slopePercent === null
              ? "partial"
              : provider === "nasaPower" &&
                  (value?.climate?.annualRainMm === null ||
                    value?.climate?.meanTempC === null)
                ? "partial"
                : "available");
        statuses.push({ provider, status, durationMs: Date.now() - started });
      } catch (error) {
        signals[provider] = null;
        statuses.push({
          provider,
          status: "unavailable",
          durationMs: Date.now() - started,
          code: error.name === "AbortError" ? "TIMEOUT" : "PROVIDER_ERROR",
        });
      }
    }),
  );
  return assembleAnalysis(input, signals, statuses);
}
module.exports = {
  validateInput,
  analyzeSite,
  assembleAnalysis,
  classifyLandUse,
  upstreamRequest,
};
