const test = require("node:test");
const assert = require("node:assert/strict");
const { getCropRecommendations } = require("../utils/cropSuitability");
const { assembleAnalysis, validateInput } = require("../utils/siteAnalysis");
const { summarizeHistory, historyWindow } = require("../utils/climateHistory");
const data = (extra = {}, form = {}) =>
  getCropRecommendations({
    form: { lat: 35, waterAccess: "unknown", ...form },
    result: {
      indicators: {
        annual_rainfall_mm_est: 250,
        mean_temp_c_est: 20,
        ...extra,
      },
    },
  });
test("screenshot regression: favourable annual rain and temperature cannot produce 100/100 pistachio", () => {
  const crop = data().find((c) => c.cropKey === "pistachio");
  assert.equal(crop.score, null);
  assert.equal(crop.rankingEligible, false);
  assert.equal(crop.evidenceCoverage.knownFactors, 2);
  assert.equal(crop.evidenceCoverage.totalFactors, 7);
  assert.ok(crop.criticalMissing.includes("winterChill"));
  assert.ok(crop.criticalMissing.includes("pollination"));
  assert.ok(crop.scoreBounds.lower < crop.scoreBounds.upper);
});
test("missing factors remain in uncertainty bounds and adding a known limitation cannot improve the upper bound", () => {
  const a = data().find((c) => c.cropKey === "olive");
  const b = data({}, { soilPh: 8.4 }).find((c) => c.cropKey === "olive");
  assert.equal(a.score, null);
  assert.equal(b.score, null);
  assert.equal(
    b.evidenceCoverage.knownFactors,
    a.evidenceCoverage.knownFactors + 1,
  );
  assert.ok(b.scoreBounds.upper <= a.scoreBounds.upper);
});
test("winter chill cannot be inferred from annual temperature or frost counts", () => {
  const crops = data(
    { hot_days_ge_35_per_year_est: 40, frost_days_le_0_per_year_est: 2 },
    { soilPh: 7.5, slopeMax: 1, waterAccess: "true", waterSalinity: 1 },
  );
  for (const key of ["almond", "pistachio"]) {
    const c = crops.find((c) => c.cropKey === key);
    assert.equal(c.score, null);
    assert.ok(c.missingInputs.includes("winterChill"));
  }
  assert.ok(crops.every((c) => c.rankingEligible === false));
});
test("fewer frost days never reduce almond or pistachio frost suitability", () => {
  for (const key of ["almond", "pistachio"]) {
    const zero = data({ frost_days_le_0_per_year_est: 0 })
      .find((c) => c.cropKey === key)
      .factors.find((f) => f.factor === "frost");
    assert.equal(zero.status, "ideal");
  }
});
test("unknown irrigation and low rain are a water-budget condition, not a confirmed impossible crop", () => {
  const c = data({ annual_rainfall_mm_est: 200 }).find(
    (c) => c.cropKey === "orange",
  );
  assert.ok(!c.exclusions.includes("annualRain"));
  assert.ok(c.missingInputs.includes("waterAccess"));
  assert.ok(c.requirements.includes("waterVolume"));
});
test("rainfed screening does not pretend irrigation-water EC was measured", () => {
  const c = data({}, { waterAccess: "false" }).find(
    (c) => c.cropKey === "olive",
  );
  assert.equal(c.evidenceCoverage.totalFactors, 6);
  assert.ok(!c.missingInputs.includes("waterSalinity"));
});
test("external outage uses valid daily fallback metrics, retains exclusions and establishes no winner", () => {
  const r = assembleAnalysis(
    validateInput({ lat: 35, lon: 10 }),
    {
      climateHistory: {
        indicators: {
          annual_rainfall_mm_est: 310,
          mean_temp_c_est: 19,
          hot_days_ge_35_per_year_est: 40,
          frost_days_le_0_per_year_est: 2,
          date_range: "2016-01-01..2025-12-31",
        },
      },
    },
    [],
  );
  assert.equal(r.indicators.annual_rainfall_mm_est, 310);
  assert.equal(r.indicators.frost_days_le_0_per_year_est, 2);
  assert.equal(r.ranking.winner, null);
  assert.equal(r.analysisWarning, "EXTERNAL_UNAVAILABLE");
  assert.ok(
    r.recommendations.every((c) => c.evidenceCoverage.knownFactors === 4),
  );
});
function history() {
  const time = [];
  for (
    let n = Date.parse("2020-01-01");
    n <= Date.parse("2021-12-31");
    n += 86400000
  )
    time.push(new Date(n).toISOString().slice(0, 10));
  return {
    daily: {
      time,
      precipitation_sum: time.map((d) => (d.startsWith("2020") ? 1 : 2)),
      temperature_2m_min: time.map(() => 10),
      temperature_2m_max: time.map(() => 30),
      temperature_2m_mean: time.map(() => 20),
    },
    daily_units: {
      precipitation_sum: "mm",
      temperature_2m_min: "°C",
      temperature_2m_max: "°C",
      temperature_2m_mean: "°C",
    },
  };
}
const window = { start: "2020-01-01", end: "2021-12-31" };
test("daily fallback uses calendar years including leap days and retains real year-to-year rainfall variation", () => {
  const r = summarizeHistory(history(), window);
  assert.equal(r.annual_rainfall_mm_est, 548);
  assert.equal(r.annual_rainfall_min_mm, 366);
  assert.equal(r.annual_rainfall_max_mm, 730);
  assert.equal(r.frost_days_le_0_per_year_est, 0);
  assert.equal(r.period_days, 731);
  assert.deepEqual(historyWindow(new Date("2026-10-27")), {
    start: "2016-01-01",
    end: "2025-12-31",
  });
});
test("partial, shifted, nonfinite or wrong-unit daily records cannot silently become zero or a complete climate record", () => {
  for (const mutate of [
    (d) => (d.daily.precipitation_sum[3] = null),
    (d) => (d.daily.time[3] = d.daily.time[2]),
    (d) => (d.daily.temperature_2m_mean[4] = NaN),
    (d) => (d.daily_units.precipitation_sum = "inch"),
    (d) => (d.daily.temperature_2m_min[2] = 40),
  ]) {
    const p = history();
    mutate(p);
    assert.throws(() => summarizeHistory(p, window));
  }
});

test("analysis fetches daily fallback when GeoAI fails, with validated units and no successful-score fabrication", async () => {
  const { analyzeSite } = require("../utils/siteAnalysis");
  const { historyWindow } = require("../utils/climateHistory");
  const previous = global.fetch;
  let historyRequests = 0;
  global.fetch = async (url) => {
    if (
      !String(url).includes("archive-api.open-meteo.com") ||
      !String(url).includes("temperature_2m_mean")
    )
      throw Error("simulated provider outage");
    historyRequests++;
    const w = historyWindow(),
      time = [];
    for (let n = Date.parse(w.start); n <= Date.parse(w.end); n += 86400000)
      time.push(new Date(n).toISOString().slice(0, 10));
    const p = history();
    p.daily = {
      time,
      precipitation_sum: time.map(() => 1),
      temperature_2m_min: time.map(() => 10),
      temperature_2m_max: time.map(() => 30),
      temperature_2m_mean: time.map(() => 20),
    };
    return { ok: true, json: async () => p };
  };
  try {
    const r = await analyzeSite(
      validateInput({ lat: 35.123, lon: 10.321 }),
      async () => ({
        classification: "unknown",
        isAgricultureAvailable: null,
        status: "available",
      }),
    );
    assert.equal(historyRequests, 1);
    assert.ok(
      r.providerStatuses.some(
        (p) => p.provider === "climateHistory" && p.status === "available",
      ),
    );
    assert.equal(r.indicators.frost_days_le_0_per_year_est, 0);
    assert.equal(r.indicators.mean_temp_c_est, 20);
    assert.equal(
      r.recommendations.find((c) => c.cropKey === "pistachio").score,
      null,
    );
    assert.equal(r.ranking.winner, null);
  } finally {
    global.fetch = previous;
  }
});
test("a complete external history does not cause redundant fallback downloads", async () => {
  const { analyzeSite } = require("../utils/siteAnalysis");
  const previous = global.fetch;
  let historyRequests = 0;
  global.fetch = async (url) => {
    if (String(url).includes("temperature_2m_mean")) historyRequests++;
    if (String(url).includes("site-analysis"))
      return {
        ok: true,
        json: async () => ({
          indicators: {
            annual_rainfall_mm_est: 300,
            avg_tmean_c: 20,
            hot_days_ge_35_per_year_est: 30,
            frost_days_le_0_per_year_est: 0,
          },
          recommendations: [],
        }),
      };
    throw Error("simulated provider outage");
  };
  try {
    const r = await analyzeSite(
      validateInput({ lat: 35.124, lon: 10.322 }),
      async () => ({
        classification: "unknown",
        isAgricultureAvailable: null,
        status: "available",
      }),
    );
    assert.equal(historyRequests, 0);
    assert.equal(r.analysisWarning, null);
  } finally {
    global.fetch = previous;
  }
});
