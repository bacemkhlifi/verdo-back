const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const express = require("express");
const {
  validateInput,
  assembleAnalysis,
  upstreamRequest,
  classifyLandUse,
} = require("../utils/siteAnalysis");
const { getCropRecommendations } = require("../utils/cropSuitability");
const { parcelFacts } = require("../utils/parcel");
const { calculateEstimate } = require("../utils/investmentEstimate");
const { createRouter, identity } = require("../routes/geoai");
const input = () =>
  validateInput({
    lat: 34.74,
    lon: 10.76,
    constraints: { water_access: false, water_ec_dS_m: 1 },
    soil_test: { ph: 7, ec_dS_m: 2 },
  });
const assumptions = () => ({
  areaHa: 1,
  usablePct: 100,
  spacingRowM: 10,
  spacingTreeM: 10,
  establishmentPerHa: 1000,
  annualFixedPerHa: 100,
  harvestPerKg: 0,
  yieldKgHa: 1000,
  pricePerKg: 1,
  firstHarvestYear: 1,
  matureYear: 1,
  horizonYears: 5,
  discountPct: 0,
  annualWaterM3Ha: 0,
  waterCostM3: 0,
  availableWaterM3: 0,
  contingencyPct: 0,
  cropKey: "olive",
  priceSource: "Test fixture, not a market price",
  quoteDate: "2026-10-26",
});
function load(name, fetch, extra = "") {
  const context = {
    module: { exports: {} },
    require,
    fetch,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../utils", name), "utf8") + extra,
    context,
  );
  return context.module.exports;
}
test("validates bounds, nullable fields and input types before network work", () => {
  assert.throws(
    () => validateInput({ lat: 100, lon: 10 }),
    /INVALID_COORDINATES/,
  );
  assert.throws(
    () => validateInput({ lat: 50, lon: 10 }),
    /OUTSIDE_SUPPORTED_REGION/,
  );
  assert.throws(
    () =>
      validateInput({
        lat: 35,
        lon: 10,
        constraints: { water_access: "false" },
      }),
    /INVALID_WATER_ACCESS/,
  );
  assert.throws(
    () => validateInput({ lat: 35, lon: 10, soil_test: { ph: 0 } }),
    /INVALID_SOIL_PH/,
  );
});
test("maps irrigation false and keeps water and soil EC separate", () => {
  const request = upstreamRequest(input());
  assert.equal(request.constraints.irrigation_available, false);
  assert.equal(request.constraints.water_ec_dS_m, 1);
  assert.equal(request.soil_test.ec_dS_m, 2);
});
test("missing all evidence cannot become positive recommendation or zero climate", () => {
  const r = assembleAnalysis(validateInput({ lat: 35, lon: 10 }), {}, []);
  assert.equal(r.indicators.annual_rainfall_mm_est, null);
  assert.equal(r.siteAssessment.status, "insufficient_data");
  assert.ok(
    r.recommendations.every(
      (c) => c.status !== "conditional" && c.status !== "recommended",
    ),
  );
});
test("fallback indicators use local climate and retain unknown legal availability", () => {
  const r = assembleAnalysis(
    input(),
    {
      nasaPower: { climate: { annualRainMm: 300, meanTempC: 20 } },
      terrain: { slopePercent: 1 },
    },
    [],
  );
  assert.equal(r.indicators.annual_rainfall_mm_est, 300);
  assert.equal(r.indicators.mean_temp_c_est, 20);
  assert.equal(r.siteAssessment.isAgricultureAvailable, null);
  assert.equal(
    r.recommendations.find((c) => c.cropKey === "olive").status,
    "conditional",
  );
});
test("date palms with no water are excluded even with ideal climate", () => {
  const c = getCropRecommendations({
    form: {
      lat: 33,
      soilPh: 7,
      slopeMax: 0,
      waterAccess: "false",
      waterSalinity: 1,
    },
    result: {
      indicators: {
        annual_rainfall_mm_est: 100,
        mean_temp_c_est: 28,
        hot_days_ge_35_per_year_est: 100,
        frost_days_le_0_per_year_est: 0,
      },
    },
  }).find((c) => c.cropKey === "date_palm");
  assert.equal(c.status, "not_suitable");
  assert.ok(c.exclusions.includes("noWater"));
});
test("backend exclusion is retained while incomplete candidates cannot get a point score", () => {
  const r = assembleAnalysis(
    input(),
    {
      external: {
        indicators: { annual_rainfall_mm_est: 300, avg_tmean_c: 20 },
        recommendations: [{ activity: "Olive orchard", fit: "UNSUITABLE" }],
      },
      terrain: { slopePercent: 1 },
    },
    [],
  );
  assert.equal(
    r.recommendations.find((c) => c.cropKey === "olive").status,
    "not_suitable",
  );
  assert.ok(r.recommendations.every((c) => c.score === null));
  assert.equal(r.ranking.winner, null);
});
test("nearby buildings or water cannot establish point containment", () => {
  const result = classifyLandUse({
    elements: [{ tags: { building: "yes" } }, { tags: { natural: "water" } }],
  });
  assert.equal(result.isAgricultureAvailable, null);
  assert.equal(result.classification, "unknown");
});
test("only actual containing building/water geometry excludes the point", () => {
  const geometry = [
    { lat: 35, lon: 10 },
    { lat: 35, lon: 10.01 },
    { lat: 35.01, lon: 10.01 },
    { lat: 35.01, lon: 10 },
    { lat: 35, lon: 10 },
  ];
  assert.equal(
    classifyLandUse(
      { elements: [{ tags: { natural: "water" }, geometry }] },
      35.005,
      10.005,
    ).classification,
    "water",
  );
  assert.equal(
    classifyLandUse(
      { elements: [{ tags: { natural: "water" }, geometry }] },
      35.1,
      10.1,
    ).isAgricultureAvailable,
    null,
  );
  const result = assembleAnalysis(
    input(),
    { landUse: { classification: "water", isAgricultureAvailable: false } },
    [],
  );
  assert.ok(
    result.recommendations.every(
      (c) => c.status === "not_suitable" && c.score === null,
    ),
  );
});
test("parcel validates intersection, area, and point inclusion", () => {
  const parcel = {
    type: "Polygon",
    coordinates: [
      [
        [10, 35],
        [10.001, 35],
        [10.001, 35.001],
        [10, 35.001],
        [10, 35],
      ],
    ],
  };
  const result = parcelFacts(parcel, 35.0005, 10.0005);
  assert.ok(result.areaHa > 0.9 && result.areaHa < 1.1);
  assert.throws(() => parcelFacts(parcel, 35.1, 10.1), /POINT_OUTSIDE/);
  assert.throws(
    () =>
      parcelFacts(
        {
          type: "Polygon",
          coordinates: [
            [
              [10, 35],
              [10.001, 35.001],
              [10, 35.001],
              [10.001, 35],
              [10, 35],
            ],
          ],
        },
        35.0005,
        10.0005,
      ),
    /SELF_INTERSECTING/,
  );
});
test("missing neighbor elevation produces unknown slope", async () => {
  let count = 0;
  const terrain = load("terrainSignals.js", async () => {
    if (count++ === 0)
      return { ok: true, json: async () => ({ elevation: [100] }) };
    throw new Error("offline");
  });
  assert.equal(
    (await terrain.calculateSlopePercent(35, 10)).slopePercent,
    null,
  );
});
test("soil parser converts documented scale and rejects nodata/coordinate numbers", () => {
  const soil = load(
    "soilSignals.js",
    null,
    "\nmodule.exports.parseSoilValue=parseSoilValue;",
  );
  assert.equal(soil.parseSoilValue("value = 73"), 7.3);
  assert.equal(soil.parseSoilValue("value = -9999"), null);
  assert.equal(
    soil.parseSoilValue("Layer phh2o_0-5cm_mean\nx = 5\ny = 3"),
    null,
  );
});
test("NASA uses canonical rainfall key, units and month lengths", async () => {
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const payload = {
    parameters: { PRECTOTCORR: { units: "mm/day" } },
    properties: {
      parameter: { PRECTOTCORR: Object.fromEntries(months.map((m) => [m, 1])) },
    },
  };
  const nasa = load("nasaPowerSignals.js", async () => ({
    ok: true,
    json: async () => payload,
  }));
  assert.equal(
    (await nasa.getNasaPowerSignals(35, 10)).climate.annualRainMm,
    365.25,
  );
});
test("weather failure retains null rain and requests supported daily fields", async () => {
  const previous = global.fetch;
  global.fetch = async (url) => {
    const daily = new URL(url).searchParams.get("daily");
    assert.ok(!daily.includes("soil_moisture"));
    throw new Error("provider offline");
  };
  try {
    const { getOpenMeteoSignals } = require("../utils/openMeteoSignals");
    const result = await getOpenMeteoSignals(35, 10);
    assert.equal(result.history.totalRainMm, null);
    assert.equal(result.status, "unavailable");
  } finally {
    global.fetch = previous;
  }
});
test("financial example balances investment, payback, NPV, ROI and water", () => {
  const e = calculateEstimate(assumptions());
  assert.equal(e.treeCount, 100);
  assert.equal(e.investment, 1000);
  assert.equal(e.scenarios.base.rows[1].cashFlow, 900);
  assert.equal(e.scenarios.base.paybackYear, 2);
  assert.equal(e.scenarios.base.npv, 3500);
  assert.equal(e.scenarios.base.roiPct, 350);
  assert.equal(e.waterStatus, "covered_by_entered_supply");
  assert.ok(e.scenarios.base.irrPct > 0);
  assert.ok(e.scenarios.low.npv < e.scenarios.base.npv);
});
test("losing scenario has no payback, rejects incomplete assumptions, identifies water deficit", () => {
  const a = { ...assumptions(), pricePerKg: 0, annualWaterM3Ha: 100 };
  const e = calculateEstimate(a);
  assert.equal(e.scenarios.base.paybackYear, null);
  assert.equal(e.waterStatus, "deficit");
  assert.ok(e.scenarios.base.npv < 0);
  assert.throws(
    () => calculateEstimate({ ...a, yieldKgHa: null }),
    /INVALID_ESTIMATE/,
  );
  assert.throws(
    () => calculateEstimate({ ...a, priceSource: "" }),
    /SOURCE_REQUIRED/,
  );
});
test("identity ignores query and body impersonation", () => {
  assert.equal(
    identity({
      headers: {},
      body: { userId: "other" },
      query: { userId: "other" },
    }),
    null,
  );
});
test("history requires auth and scopes to verified identity; anonymous analyze never writes", async () => {
  let query,
    writes = 0;
  const app = express();
  app.use(express.json());
  const store = {
    create: async () => {
      writes++;
      return { _id: "x" };
    },
    find: (q) => {
      query = q;
      return {
        sort() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => [],
      };
    },
  };
  app.use(
    "/geoai",
    createRouter({
      Analysis: store,
      identity: (req) => req.headers["x-test-user"] || null,
      analyzeSite: async () => ({ version: "feasibility-1" }),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/geoai`;
  try {
    assert.equal((await fetch(url + "/history?userId=other")).status, 401);
    assert.equal(
      (
        await fetch(url + "/history?userId=other", {
          headers: { "x-test-user": "verified" },
        })
      ).status,
      200,
    );
    assert.deepEqual(query, { userId: "verified" });
    const r = await fetch(url + "/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 35, lon: 10, userId: "other" }),
    });
    assert.equal(r.status, 200);
    assert.equal(writes, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
