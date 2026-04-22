const express = require("express");
const jwt = require("jsonwebtoken");
const Analysis = require("../models/Analysis");
const { getOpenMeteoSignals } = require("../utils/openMeteoSignals");
const { getNasaPowerSignals } = require("../utils/nasaPowerSignals");
const { calculateSlopePercent } = require("../utils/terrainSignals");
const { getSoilSignals } = require("../utils/soilSignals");
const { getCropRecommendations } = require("../utils/cropSuitability");

const router = express.Router();

// ---------- Configuration ----------
const GEOAI_API_URL =
  process.env.GEOAI_API_URL ||
  "https://geoai-ahao.onrender.com/v1/site-analysis";
const GEOAI_TIMEOUT_MS = parseInt(process.env.GEOAI_TIMEOUT_MS, 10) || 15000;

const OVERPASS_API_URLS = (
  process.env.OVERPASS_API_URLS ||
  process.env.OVERPASS_API_URL ||
  [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
  ].join(",")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const REVERSE_GEOCODE_URLS = (
  process.env.REVERSE_GEOCODE_URLS ||
  [
    "https://nominatim.openstreetmap.org/reverse",
    "https://geocode.maps.co/reverse",
  ].join(",")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

// ---------- Constants for land‑use classification ----------
const BUILDING_LANDUSE_TAGS = new Set([
  "residential", "commercial", "industrial", "retail", "construction",
  "brownfield", "garages", "railway", "port", "military"
]);
const AGRICULTURAL_LANDUSE_TAGS = new Set([
  "farmland", "farmyard", "orchard", "vineyard",
  "greenhouse_horticulture", "plant_nursery", "meadow"
]);
const WATER_LANDUSE_TAGS = new Set(["basin", "reservoir", "salt_pond"]);
const WATER_NATURAL_TAGS = new Set(["water", "bay", "coastline", "wetland", "strait"]);
const WATERWAY_TAGS = new Set(["river", "stream", "canal", "drain", "wadi"]);
const URBAN_PLACE_TAGS = new Set([
  "city", "town", "suburb", "neighbourhood", "quarter", "borough", "village"
]);
const URBAN_AMENITY_TAGS = new Set([
  "school", "hospital", "clinic", "university", "college", "marketplace",
  "parking", "fuel", "bank", "restaurant", "cafe", "pharmacy",
  "bus_station", "police", "townhall", "courthouse"
]);
const URBAN_HIGHWAY_TAGS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "residential", "living_street", "service"
]);

const OVERPASS_RADIUS_METERS = 80;
const WATER_SCAN_RADIUS_METERS = 750;
const REQUEST_TIMEOUT_MS = 9000;

// ---------- Helper functions ----------
const toFiniteNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizeSoilPh = (value) => {
  const num = toFiniteNumber(value);
  return (num !== null && num >= 3 && num <= 10.5) ? num : null;
};

const sanitizeSlope = (value) => {
  const num = toFiniteNumber(value);
  return (num !== null && num >= 0 && num <= 90) ? num : null;
};

const resolveUserId = (req) => {
  if (req.body?.userId) return req.body.userId;
  if (req.query?.userId) return req.query.userId;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded.id;
    } catch (error) {
      return null;
    }
  }

  if (req.cookies?.token) {
    try {
      const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      return decoded.id;
    } catch (error) {
      return null;
    }
  }
  return null;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

// ---------- Overpass & reverse geocode land‑use ----------
const runOverpassQuery = async (lat, lon) => {
  const query = `
    [out:json][timeout:20];
    is_in(${lat},${lon})->.containingAreas;
    (
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["building"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["building"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["landuse"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["building"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["landuse"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["landuse"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["place"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["place"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["place"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["amenity"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["amenity"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["highway"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["highway"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["natural"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["natural"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["natural"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["water"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["water"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["water"];
      node(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["waterway"];
      way(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["waterway"];
      relation(around:${OVERPASS_RADIUS_METERS},${lat},${lon})["waterway"];
      way(pivot.containingAreas)["natural"="water"];
      relation(pivot.containingAreas)["natural"="water"];
      way(pivot.containingAreas)["water"];
      relation(pivot.containingAreas)["water"];
      way(pivot.containingAreas)["landuse"];
      relation(pivot.containingAreas)["landuse"];
      way(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["natural"="coastline"];
      relation(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["natural"="coastline"];
      way(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["natural"="water"];
      relation(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["natural"="water"];
      way(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["water"];
      relation(around:${WATER_SCAN_RADIUS_METERS},${lat},${lon})["water"];
    );
    out tags center;
  `.trim();

  let lastError;
  for (const endpoint of OVERPASS_API_URLS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`Overpass endpoint ${endpoint} failed:`, err.message);
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastError.message}`);
};

const runReverseGeocodeFallback = async (lat, lon) => {
  let lastError;
  for (const endpoint of REVERSE_GEOCODE_URLS) {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const url = `${endpoint}${separator}format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
      const response = await fetchWithTimeout(
        url,
        { headers: { "User-Agent": "Verdolive/1.0 GeoAI land-use fallback" } },
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`Reverse geocode endpoint ${endpoint} failed:`, err.message);
    }
  }
  throw new Error(`All reverse geocode endpoints failed. Last error: ${lastError.message}`);
};

const analyzeLandUse = (payload = {}) => {
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  let buildingCount = 0, urbanLanduseCount = 0, urbanPlaceCount = 0, urbanAmenityCount = 0;
  let urbanHighwayCount = 0, agriculturalCount = 0, waterCount = 0, coastlineCount = 0;
  const matchedTags = [];

  for (const element of elements) {
    const tags = element.tags || {};
    if (Object.keys(tags).length === 0) continue;
    matchedTags.push(tags);

    if (tags.building) buildingCount++;
    if (BUILDING_LANDUSE_TAGS.has(tags.landuse)) urbanLanduseCount++;
    if (URBAN_PLACE_TAGS.has(tags.place)) urbanPlaceCount++;
    if (URBAN_AMENITY_TAGS.has(tags.amenity)) urbanAmenityCount++;
    if (URBAN_HIGHWAY_TAGS.has(tags.highway)) urbanHighwayCount++;

    if (WATER_LANDUSE_TAGS.has(tags.landuse) ||
        WATER_NATURAL_TAGS.has(tags.natural) ||
        WATERWAY_TAGS.has(tags.waterway) ||
        tags.water) waterCount++;

    if (tags.natural === "coastline") coastlineCount++;
    if (AGRICULTURAL_LANDUSE_TAGS.has(tags.landuse) ||
        tags.crop || tags.irrigation === "yes") agriculturalCount++;
  }

  const urbanSignalScore = buildingCount * 5 + urbanLanduseCount * 4 + urbanPlaceCount * 3 +
                           urbanAmenityCount * 2 + urbanHighwayCount;
  const hasBuildings = buildingCount > 0 || urbanLanduseCount > 0 || urbanPlaceCount > 0 || urbanSignalScore >= 5;
  const onlyWaterSignals = !hasBuildings && agriculturalCount === 0 && urbanAmenityCount === 0 &&
                           urbanHighwayCount === 0 && urbanPlaceCount === 0 && urbanLanduseCount === 0;
  const looksLikeWater = onlyWaterSignals && (waterCount > 0 || coastlineCount > 0);
  const looksAgricultural = agriculturalCount > 0 && !hasBuildings;

  return {
    source: "overpass",
    radiusMeters: OVERPASS_RADIUS_METERS,
    hasBuildings,
    buildingCount,
    urbanLanduseCount,
    urbanPlaceCount,
    urbanAmenityCount,
    urbanHighwayCount,
    urbanSignalScore,
    agriculturalCount,
    waterCount,
    coastlineCount,
    isAgricultureAvailable: !hasBuildings && !looksLikeWater,
    classification: hasBuildings ? "built_up" : looksLikeWater ? "water" : looksAgricultural ? "agricultural" : "open_land",
    summary: hasBuildings
      ? "This coordinate appears to fall on buildings, roads, amenities, or urban land."
      : looksLikeWater
      ? "This coordinate appears to fall on sea or open water, not on agricultural land."
      : looksAgricultural
      ? "This coordinate appears open and suitable for agricultural analysis."
      : "No buildings were detected nearby. The land looks open enough for agricultural analysis.",
    matchedTags: matchedTags.slice(0, 8),
  };
};

const analyzeReverseGeocodeLandUse = (payload = {}) => {
  const category = String(payload.category || payload.class || "").toLowerCase();
  const type = String(payload.type || payload.addresstype || "").toLowerCase();
  const address = payload.address || {};
  const displayName = String(payload.display_name || "").toLowerCase();
  const addressValues = Object.values(address).map(v => String(v || "").toLowerCase());

  const isWater =
    (category === "natural" && ["water", "sea", "ocean", "bay", "coastline", "strait", "reservoir", "lake", "lagoon"].includes(type)) ||
    ["sea", "ocean"].includes(type) ||
    addressValues.some(v => ["mediterranean sea", "sea", "ocean", "gulf", "bay"].includes(v));

  const isUrban =
    ["building", "highway", "amenity", "landuse"].includes(category) ||
    (category === "place" && ["city", "town", "suburb", "quarter", "neighbourhood", "residential", "road", "house", "building", "amenity", "apartments", "commercial", "industrial"].includes(type)) ||
    Boolean(address.house_number) ||
    (Boolean(address.road) && Boolean(address.city || address.town || address.suburb || address.neighbourhood));

  if (isWater) {
    return {
      source: "reverse-geocode",
      isAgricultureAvailable: false,
      classification: "water",
      summary: "This coordinate appears to fall on sea or open water, not on agricultural land."
    };
  }
  if (isUrban) {
    return {
      source: "reverse-geocode",
      isAgricultureAvailable: false,
      classification: "built_up",
      summary: "This coordinate appears to fall on buildings, roads, amenities, or urban land."
    };
  }
  return {
    source: "reverse-geocode",
    isAgricultureAvailable: true,
    classification: "unknown",
    summary: "geoai.apiSummary.notes.reverseGeocodeNoDetection"
  };
};

// ---------- Main route ----------
router.post("/analyze", async (req, res) => {
  try {
    const { lat, lon, constraints = {}, soil_test = {} } = req.body;
    const userId = resolveUserId(req);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ success: false, message: "Latitude and longitude must be valid numbers." });
    }

    // 1. Fetch all local signals in parallel (they may fail individually)
    const [freeSignals, nasaSignals, terrainSignals, soilSignals] = await Promise.allSettled([
      getOpenMeteoSignals(lat, lon),
      getNasaPowerSignals(lat, lon),
      calculateSlopePercent(lat, lon),
      getSoilSignals(lat, lon),
    ]);

    const safeSignals = {
      openMeteo: freeSignals.status === "fulfilled" ? freeSignals.value : null,
      nasaPower: nasaSignals.status === "fulfilled" ? nasaSignals.value : null,
      terrain: terrainSignals.status === "fulfilled" ? terrainSignals.value : null,
      soil: soilSignals.status === "fulfilled" ? soilSignals.value : null,
    };

    // 2. Land‑use check (overpass → reverse geocode → fallback)
    let landUseCheck;
    try {
      const overpassPayload = await runOverpassQuery(lat, lon);
      landUseCheck = analyzeLandUse(overpassPayload);
    } catch (overpassError) {
      console.error("Overpass failed, trying reverse geocode:", overpassError.message);
      try {
        const reversePayload = await runReverseGeocodeFallback(lat, lon);
        landUseCheck = {
          radiusMeters: OVERPASS_RADIUS_METERS,
          hasBuildings: false,
          buildingCount: 0,
          urbanLanduseCount: 0,
          urbanPlaceCount: 0,
          urbanAmenityCount: 0,
          urbanHighwayCount: 0,
          urbanSignalScore: 0,
          agriculturalCount: 0,
          waterCount: 0,
          coastlineCount: 0,
          matchedTags: [],
          ...analyzeReverseGeocodeLandUse(reversePayload),
        };
      } catch (reverseError) {
        console.error("Reverse geocode also failed:", reverseError.message);
        landUseCheck = {
          source: "land-use-fallback",
          radiusMeters: OVERPASS_RADIUS_METERS,
          hasBuildings: false,
          buildingCount: 0,
          urbanLanduseCount: 0,
          urbanPlaceCount: 0,
          urbanAmenityCount: 0,
          urbanHighwayCount: 0,
          urbanSignalScore: 0,
          agriculturalCount: 0,
          waterCount: 0,
          coastlineCount: 0,
          isAgricultureAvailable: true,  // assume best if we can't verify
          classification: "unknown",
          summary: "Land-use verification is currently unavailable, so the result is based on GeoAI only.",
          matchedTags: [],
        };
      }
    }

    // 3. Fill missing user constraints with fetched data
    const derivedConstraints = { ...constraints };
    const derivedSoilTest = { ...soil_test };

    if (sanitizeSlope(derivedConstraints.slope_max) === null && safeSignals.terrain?.slopePercent !== undefined) {
      const slopeFromTerrain = safeSignals.terrain.slopePercent;
      if (Number.isFinite(slopeFromTerrain)) derivedConstraints.slope_max = slopeFromTerrain;
    }
    if (sanitizeSoilPh(derivedSoilTest.ph) === null && safeSignals.soil?.ph !== undefined) {
      const phFromSoil = safeSignals.soil.ph;
      if (Number.isFinite(phFromSoil) && phFromSoil >= 3 && phFromSoil <= 10.5) derivedSoilTest.ph = phFromSoil;
    }

    // 4. Build apiInsights (metadata about which local sources succeeded)
    const apiInsights = {
      providerSummary: [
        safeSignals.openMeteo ? "open-meteo" : null,
        safeSignals.nasaPower ? "nasa-power" : null,
        safeSignals.terrain ? "terrain" : null,
        safeSignals.soil ? "soilgrids" : null,
      ].filter(Boolean),
      sources: [
        ...(safeSignals.openMeteo?.dataSources || []),
        ...(safeSignals.nasaPower?.dataSources || []),
        ...(safeSignals.terrain?.dataSources || []),
        ...(safeSignals.soil?.dataSources || []),
      ],
      openMeteo: safeSignals.openMeteo,
      nasaPower: safeSignals.nasaPower,
      terrain: safeSignals.terrain,
      soil: safeSignals.soil,
      derivedInputs: {
        slopeMax: sanitizeSlope(derivedConstraints.slope_max),
        soilPh: sanitizeSoilPh(derivedSoilTest.ph),
      },
      notes: [
        ...(safeSignals.openMeteo?.notes || []),
        ...(safeSignals.nasaPower?.notes || []),
        ...(safeSignals.terrain?.notes || []),
        ...(safeSignals.soil?.notes || []),
      ],
    };

    // 5. If land is not available for agriculture, return early
    if (!landUseCheck.isAgricultureAvailable) {
      const isWater = landUseCheck.classification === "water";
      const result = {
        site: { lat, lon },
        constraints: derivedConstraints,
        soil_test: derivedSoilTest,
        landUseCheck,
        siteAssessment: {
          isAgricultureAvailable: false,
          status: landUseCheck.classification,
          headline: isWater
            ? "This coordinate is sea or open water, not agricultural land."
            : "This land is not available for agriculture.",
          summary: isWater
            ? "Water was detected at this coordinate, so tree planting is not possible here."
            : "A building or dense urban land was detected at this coordinate, so tree planting is not recommended here.",
        },
        recommendedCrops: [],
        apiInsights,
      };
      const analysis = await Analysis.create({ userId, lat, lon, constraints: derivedConstraints, soilTest: derivedSoilTest, result });
      return res.status(200).json({ success: true, analysisId: analysis._id, result });
    }

    // 6. Call external GeoAI (with timeout)
    let geoAiResult = null;
    let geoAiFailure = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEOAI_TIMEOUT_MS);
      const geoAiResponse = await fetch(GEOAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: {
            lat: lat,
            lon: lon,
            radius_m: 500
          },
          constraints: {
            country: "TN"
          },
          soil_test: derivedSoilTest?.ph ? {
            ph: parseFloat(derivedSoilTest.ph),
            ec_dS_m: derivedSoilTest?.ec ? parseFloat(derivedSoilTest.ec) : null
          } : null
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!geoAiResponse.ok) {
        throw new Error(`GeoAI responded with ${geoAiResponse.status}: ${await geoAiResponse.text()}`);
      }
      geoAiResult = await geoAiResponse.json();
    } catch (err) {
      geoAiFailure = err;
      console.error("External GeoAI failed, using local fallback:", err.message);
    }

    // 7. Generate local recommendations only if GeoAI failed
    let finalRecommendations = [];
    let analysisWarning = null;
    if (geoAiFailure) {
      analysisWarning = "The external GeoAI service was unavailable, so the analysis used local fallback signals for soil, slope, and weather.";
      // Build a minimal result object for the local recommender
      const fallbackIndicators = {
        annual_rainfall_mm_est: safeSignals.nasaPower?.climate?.annualRainMm,
        mean_temp_c_est: safeSignals.nasaPower?.climate?.meanTempC,
        hot_days_ge_35_per_year_est: safeSignals.nasaPower?.climate?.hotDays35,
        frost_days_le_0_per_year_est: safeSignals.nasaPower?.climate?.frostDays,
        aridity_class: safeSignals.nasaPower?.summary?.classification,
        drought_risk: safeSignals.openMeteo?.summary?.rainfallLabel,
      };
      // Assuming getCropRecommendations is async – if it's sync, remove await
      finalRecommendations = await getCropRecommendations({
        form: {
          waterAccess: constraints.water_access === undefined ? "unknown" : String(constraints.water_access),
          slopeMax: sanitizeSlope(derivedConstraints.slope_max) ?? "",
          waterSalinity: derivedConstraints.water_ec_dS_m ?? "",
          soilPh: sanitizeSoilPh(derivedSoilTest.ph) ?? "",
          organicMatter: derivedSoilTest.organic_matter ?? "",
          lat,
        },
        result: { indicators: fallbackIndicators, apiInsights },
        apiInsights,
      });
    } else {
      // Use external recommendations, but also keep local as a backup? Usually you trust the external.
      finalRecommendations = geoAiResult?.recommendations || [];
    }

    // 8. Assemble final result
    const result = {
      ...(geoAiResult || {}),           // spreads only if geoAiResult exists
      landUseCheck,
      apiInsights,
      recommendations: finalRecommendations,
      externalRecommendations: geoAiResult?.recommendations || [],
      siteAssessment: {
        isAgricultureAvailable: true,
        status: landUseCheck.classification,
        headline: geoAiResult?.siteAssessment?.headline || "This land looks available for agriculture.",
        summary: geoAiResult?.siteAssessment?.summary ||
          "No buildings were detected at this coordinate, so we can continue with agricultural suitability and crop recommendations.",
      },
      analysisWarning,
      indicators: geoAiResult?.indicators || {},
    };

    const analysis = await Analysis.create({
      userId,
      lat,
      lon,
      constraints: derivedConstraints,
      soilTest: derivedSoilTest,
      result,
    });

    res.status(200).json({ success: true, analysisId: analysis._id, result });
  } catch (error) {
    console.error("GeoAI analyze fatal error:", error);
    res.status(500).json({ success: false, message: "GeoAI request failed" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID required to load GeoAI history." });
    }
    const analyses = await Analysis.find({ userId }).sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, data: analyses });
  } catch (error) {
    console.error("GeoAI history error:", error);
    res.status(500).json({ success: false, message: "Failed to load GeoAI history" });
  }
});

module.exports = router;