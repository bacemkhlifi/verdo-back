const { fetchJson } = require("./providerHttp");
const { getOpenMeteoSignals } = require("./openMeteoSignals");
const { getNasaPowerSignals } = require("./nasaPowerSignals");
const { calculateSlopePercent } = require("./terrainSignals");
const { getSoilSignals } = require("./soilSignals");
const { getCropRecommendations } = require("./cropSuitability");
const { validatePoint, parcelFacts } = require("./parcel");
const { checkLocation, classifyLandUse } = require("./landUse");
const { getClimateHistory } = require("./climateHistory");

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
      Math.min(30000, Number(process.env.GEOAI_TIMEOUT_MS) || 12000),
    ),
  );
  if (
    !result ||
    typeof result !== "object" ||
    !result.indicators ||
    !Array.isArray(result.recommendations)
  )
    throw new Error("INVALID_PROVIDER_RESPONSE");
  if (
    result.indicators.coverage &&
    Object.values(result.indicators.coverage).some(
      (v) => typeof v !== "number" || v !== 1,
    )
  )
    throw new Error("INCOMPLETE_PROVIDER_HISTORY");
  return result;
}
function assembleAnalysis(input, signals, statuses) {
  const {
    openMeteo,
    nasaPower,
    terrain,
    soil,
    external,
    landUse,
    climateHistory,
  } = signals;
  const upstream = external?.indicators || {};
  const history = climateHistory?.indicators || {};
  const indicators = {
    ...history,
    ...upstream,
    annual_rainfall_mm_est:
      number(upstream.annual_rainfall_mm_est) ??
      number(history.annual_rainfall_mm_est) ??
      number(nasaPower?.climate?.annualRainMm),
    mean_temp_c_est:
      number(upstream.avg_tmean_c) ??
      number(upstream.mean_temp_c_est) ??
      number(history.mean_temp_c_est) ??
      number(nasaPower?.climate?.meanTempC),
    hot_days_ge_35_per_year_est:
      number(upstream.hot_days_ge_35_per_year_est) ??
      number(history.hot_days_ge_35_per_year_est),
    frost_days_le_0_per_year_est:
      number(upstream.frost_days_le_0_per_year_est) ??
      number(history.frost_days_le_0_per_year_est),
    date_range: upstream.date_range || history.date_range || null,
    aridity_class: String(
      upstream.aridity_class || nasaPower?.summary?.classification || "unknown",
    ).toLowerCase(),
    drought_risk: String(upstream.drought_risk || "unknown").toLowerCase(),
  };
  const ph = input.soil_test.ph ?? number(soil?.ph),
    slope = input.constraints.slope_max ?? number(terrain?.slopePercent);
  const apiInsights = {
    openMeteo,
    climateHistory,
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
      provisional: true,
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
      a.cropKey.localeCompare(b.cropKey),
  );
  const hasClimate =
    number(indicators.annual_rainfall_mm_est) !== null &&
    number(indicators.mean_temp_c_est) !== null;
  return {
    version: "feasibility-1",
    generatedAt: new Date().toISOString(),
    screeningModelVersion: "tn-screening-2",
    ranking: {
      status: "not_established",
      winner: null,
      reason: "UNCALIBRATED_PROFILES",
      scope:
        "Preliminary crop screening only; no validated best crop or return prediction",
    },
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
    analysisWarning:
      !external && landUse?.isAgricultureAvailable !== false
        ? "EXTERNAL_UNAVAILABLE"
        : null,
    scope:
      "Point-based screening, not parcel certification. Suitability scores are rule indices, not success probabilities.",
    nextActions:
      landUse?.isAgricultureAvailable === false
        ? ["selectDifferentLocation"]
        : ["rootZoneSoil", "waterVolume", "waterQuality", "fieldVerification"],
    providerStatuses: statuses,
    risks: external?.risks || [],
  };
}
async function analyzeSite(input, locationCheck = checkLocation) {
  const started = Date.now();
  const landUse = await locationCheck(input.lat, input.lon);
  const landStatus = {
    provider: "landUse",
    status: landUse.status || "available",
    durationMs: Date.now() - started,
  };
  // Stop before climate/soil/AI providers for confirmed non-land points.
  if (landUse.isAgricultureAvailable === false)
    return assembleAnalysis(input, { landUse }, [landStatus]);
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
  };
  const signals = { landUse },
    statuses = [landStatus];
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
  const externalIndicators = signals.external?.indicators || {};
  if (
    [
      externalIndicators.annual_rainfall_mm_est,
      externalIndicators.avg_tmean_c ?? externalIndicators.mean_temp_c_est,
      externalIndicators.hot_days_ge_35_per_year_est,
      externalIndicators.frost_days_le_0_per_year_est,
    ].some((v) => number(v) === null)
  ) {
    const started = Date.now();
    try {
      signals.climateHistory = await cached(
        "history:" + point,
        () => getClimateHistory(input.lat, input.lon),
        86400000,
      );
      statuses.push({
        provider: "climateHistory",
        status: "available",
        durationMs: Date.now() - started,
      });
    } catch {
      statuses.push({
        provider: "climateHistory",
        status: "unavailable",
        durationMs: Date.now() - started,
      });
    }
  }
  return assembleAnalysis(input, signals, statuses);
}
module.exports = {
  validateInput,
  analyzeSite,
  assembleAnalysis,
  classifyLandUse,
  upstreamRequest,
};
