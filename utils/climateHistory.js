const { fetchJson } = require("./providerHttp");
const DAY = 86400000;
function historyWindow(now = new Date()) {
  const year = now.getUTCFullYear() - 1;
  return { start: `${year - 9}-01-01`, end: `${year}-12-31` };
}
function summarizeHistory(payload, window) {
  const daily = payload?.daily,
    units = payload?.daily_units;
  const keys = [
    "precipitation_sum",
    "temperature_2m_min",
    "temperature_2m_max",
    "temperature_2m_mean",
  ];
  const days =
    Math.round((Date.parse(window.end) - Date.parse(window.start)) / DAY) + 1;
  if (
    !daily ||
    daily.time?.length !== days ||
    units?.precipitation_sum !== "mm" ||
    keys.slice(1).some((k) => units?.[k] !== "°C")
  )
    throw Error("INVALID_CLIMATE_COVERAGE");
  if (
    keys.some(
      (k) =>
        !Array.isArray(daily[k]) ||
        daily[k].length !== days ||
        daily[k].some((x) => typeof x !== "number" || !Number.isFinite(x)),
    )
  )
    throw Error("INCOMPLETE_CLIMATE_SERIES");
  const years = new Map();
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(window.start) + i * DAY)
      .toISOString()
      .slice(0, 10);
    if (
      daily.time[i] !== date ||
      daily.precipitation_sum[i] < 0 ||
      daily.temperature_2m_min[i] > daily.temperature_2m_mean[i] ||
      daily.temperature_2m_mean[i] > daily.temperature_2m_max[i]
    )
      throw Error("INVALID_CLIMATE_SERIES");
    const year = date.slice(0, 4);
    years.set(year, (years.get(year) || 0) + daily.precipitation_sum[i]);
  }
  const n = years.size,
    rain = [...years.values()];
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const annualRain = mean(rain);
  return {
    annual_rainfall_mm_est: annualRain,
    mean_temp_c_est: mean(daily.temperature_2m_mean),
    hot_days_ge_35_per_year_est:
      daily.temperature_2m_max.filter((x) => x >= 35).length / n,
    frost_days_le_0_per_year_est:
      daily.temperature_2m_min.filter((x) => x <= 0).length / n,
    annual_rainfall_min_mm: Math.min(...rain),
    annual_rainfall_max_mm: Math.max(...rain),
    annual_rainfall_cv: annualRain
      ? Math.sqrt(mean(rain.map((x) => (x - annualRain) ** 2))) / annualRain
      : null,
    date_range: `${window.start}..${window.end}`,
    period_days: days,
    coverage: Object.fromEntries(keys.map((k) => [k, 1])),
  };
}
async function getClimateHistory(
  lat,
  lon,
  request = fetchJson,
  now = new Date(),
) {
  const window = historyWindow(now);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: window.start,
    end_date: window.end,
    daily:
      "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum",
    timezone: "Africa/Tunis",
    models: "era5",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  }).toString();
  const payload = await request(url.toString(), {}, 15000);
  return {
    status: "available",
    provider: "open-meteo-era5",
    kind: "modeled-reanalysis",
    resolutionKm: 25,
    indicators: summarizeHistory(payload, window),
  };
}
module.exports = { getClimateHistory, summarizeHistory, historyWindow };
