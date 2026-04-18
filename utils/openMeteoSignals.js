const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
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

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const average = (values) => {
  const list = values.map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
};

const max = (values) => {
  const list = values.map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  return Math.max(...list);
};

const min = (values) => {
  const list = values.map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  return Math.min(...list);
};

const classifyMoisture = (value) => {
  if (value === null) return "unknown";
  if (value < 0.15) return "very_low";
  if (value < 0.22) return "low";
  if (value < 0.32) return "moderate";
  return "high";
};

const classifyRainfall = (value) => {
  if (value === null) return "unknown";
  if (value < 1) return "dry";
  if (value < 3) return "light";
  if (value < 8) return "moderate";
  return "wet";
};

const isPastOrToday = (isoDate) => {
  const today = new Date();
  const current = new Date(`${isoDate}T00:00:00Z`);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return current <= yesterday;
};

const buildSummary = ({ elevationMeters, current, history }) => {
  const moistureLabel = classifyMoisture(current?.soilMoistureTop);
  const rainfallLabel = classifyRainfall(history?.avgRainMm);
  const elevationLabel =
    elevationMeters === null
      ? "unknown"
      : elevationMeters >= 700
        ? "highland"
        : elevationMeters >= 250
          ? "midland"
          : "lowland";

  return {
    elevationLabel,
    moistureLabel,
    rainfallLabel,
    droughtPressure:
      current?.et0Mm !== null && history?.avgRainMm !== null
        ? Math.max(0, current.et0Mm - history.avgRainMm)
        : null,
  };
};

const buildHistoricalWindow = (days = 30) => {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  return {
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
  };
};

const buildArchiveUrl = (lat, lon, startDate, endDate) => {
  const url = new URL(OPEN_METEO_ARCHIVE_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("cell_selection", "nearest");
  url.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "rain_sum",
      "et0_fao_evapotranspiration",
      "soil_moisture_0_to_7cm",
      "soil_moisture_7_to_28cm",
    ].join(",")
  );
  url.searchParams.set(
    "hourly",
    [
      "precipitation",
      "rain",
    ].join(",")
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("precipitation_unit", "mm");
  return url;
};

const buildForecastUrl = (lat, lon) => {
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("cell_selection", "nearest");
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation",
      "rain",
      "wind_speed_10m",
      "soil_temperature_0_to_7cm",
      "soil_moisture_0_to_7cm",
      "et0_fao_evapotranspiration",
      "vapour_pressure_deficit",
    ].join(",")
  );
  url.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "rain_sum",
      "et0_fao_evapotranspiration",
      "soil_moisture_0_to_7cm",
      "soil_moisture_7_to_28cm",
    ].join(",")
  );
  url.searchParams.set(
    "hourly",
    [
      "precipitation",
      "rain",
    ].join(",")
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("past_days", "30");
  url.searchParams.set("forecast_days", "0");
  return url;
};

const buildHistoryFromDaily = (daily = {}) => {
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const validIndexes = dailyTimes
    .map((time, index) => ({ time, index }))
    .filter((item) => Boolean(item.time));

  const historicalDaily = {
    temperature_2m_max: validIndexes.map((item) => daily.temperature_2m_max?.[item.index]),
    temperature_2m_min: validIndexes.map((item) => daily.temperature_2m_min?.[item.index]),
    precipitation_sum: validIndexes.map((item) => daily.precipitation_sum?.[item.index]),
    rain_sum: validIndexes.map((item) => daily.rain_sum?.[item.index]),
    et0_fao_evapotranspiration: validIndexes.map((item) => daily.et0_fao_evapotranspiration?.[item.index]),
    soil_moisture_0_to_7cm: validIndexes.map((item) => daily.soil_moisture_0_to_7cm?.[item.index]),
    soil_moisture_7_to_28cm: validIndexes.map((item) => daily.soil_moisture_7_to_28cm?.[item.index]),
    time: validIndexes.map((item) => item.time),
  };

  const rainValues = historicalDaily.precipitation_sum || [];
  const rainOnlyValues = historicalDaily.rain_sum || [];
  const wetDays = rainValues.map(Number).filter((value) => Number.isFinite(value) && value > 0.2).length;
  const rainyDays = rainValues.map(Number).filter((value) => Number.isFinite(value) && value > 0).length;

  return {
    avgTempMaxC: average(historicalDaily.temperature_2m_max || []),
    avgTempMinC: average(historicalDaily.temperature_2m_min || []),
    avgRainMm: average(rainValues),
    totalRainMm: rainValues.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
    avgRainOnlyMm: average(rainOnlyValues),
    totalRainOnlyMm: rainOnlyValues.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
    avgEt0Mm: average(historicalDaily.et0_fao_evapotranspiration || []),
    avgSoilMoistureTop: average(historicalDaily.soil_moisture_0_to_7cm || []),
    avgSoilMoistureRoot: average(historicalDaily.soil_moisture_7_to_28cm || []),
    maxTempC: max(historicalDaily.temperature_2m_max || []),
    minTempC: min(historicalDaily.temperature_2m_min || []),
    rainyDays,
    wetDays,
    daysCollected: rainValues.filter((value) => Number.isFinite(Number(value))).length,
    recentPeriodDays: validIndexes.length,
  };
};

const buildHistoryFromHourly = (hourly = {}) => {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const rainValues = Array.isArray(hourly.rain) && hourly.rain.length ? hourly.rain : hourly.precipitation || [];
  const byDate = new Map();

  times.forEach((time, index) => {
    const day = String(time || "").slice(0, 10);
    if (!day) return;
    const raw = Number(rainValues?.[index]);
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    byDate.set(day, (byDate.get(day) || 0) + value);
  });

  const dailyTotals = [...byDate.values()];
  const totalRainMm = dailyTotals.reduce((sum, value) => sum + value, 0);
  const rainyDays = dailyTotals.filter((value) => value > 0).length;
  const wetDays = dailyTotals.filter((value) => value > 0.2).length;

  return {
    avgTempMaxC: null,
    avgTempMinC: null,
    avgRainMm: dailyTotals.length ? totalRainMm / dailyTotals.length : null,
    totalRainMm,
    avgRainOnlyMm: null,
    totalRainOnlyMm: totalRainMm,
    avgEt0Mm: null,
    avgSoilMoistureTop: null,
    avgSoilMoistureRoot: null,
    maxTempC: null,
    minTempC: null,
    rainyDays,
    wetDays,
    daysCollected: dailyTotals.length,
    recentPeriodDays: dailyTotals.length,
  };
};

const getOpenMeteoSignals = async (lat, lon) => {
  const elevationUrl = new URL(OPEN_METEO_ELEVATION_URL);
  elevationUrl.searchParams.set("latitude", String(lat));
  elevationUrl.searchParams.set("longitude", String(lon));

  const forecastUrl = buildForecastUrl(lat, lon);

  const { startDate, endDate } = buildHistoricalWindow(30);
  const archiveUrl = buildArchiveUrl(lat, lon, startDate, endDate);

  const [elevation, forecast, archive] = await Promise.allSettled([
    fetchJson(elevationUrl.toString()),
    fetchJson(forecastUrl.toString()),
    fetchJson(archiveUrl.toString()),
  ]);

  const elevationMeters =
    elevation.status === "fulfilled"
      ? toNumber(elevation.value?.elevation?.[0])
      : null;

  const current = forecast.status === "fulfilled" ? forecast.value?.current || {} : {};
  const daily = forecast.status === "fulfilled" ? forecast.value?.daily || {} : {};
  const hourly = forecast.status === "fulfilled" ? forecast.value?.hourly || {} : {};
  const history = buildHistoryFromDaily(daily);
  const forecastHourlyHistory = buildHistoryFromHourly(hourly);

  const archiveHistory = archive.status === "fulfilled"
    ? buildHistoryFromDaily(archive.value?.daily || {})
    : null;
  const archiveHourlyHistory = archive.status === "fulfilled"
    ? buildHistoryFromHourly(archive.value?.hourly || {})
    : null;

  const candidateHistories = [
    archiveHourlyHistory,
    archiveHistory,
    forecastHourlyHistory,
    history,
  ].filter((item) => item && Number.isFinite(item.totalRainMm));

  const resolvedHistory = candidateHistories.sort((left, right) => {
    const leftRain = Number(left.totalRainMm) || 0;
    const rightRain = Number(right.totalRainMm) || 0;
    if (rightRain !== leftRain) return rightRain - leftRain;
    return (Number(right.rainyDays) || 0) - (Number(left.rainyDays) || 0);
  })[0] || history;

  const currentSignals = {
    temperatureC: toNumber(current.temperature_2m),
    humidityPct: toNumber(current.relative_humidity_2m),
    precipitationMm: toNumber(current.precipitation),
    rainMm: toNumber(current.rain),
    windKph: toNumber(current.wind_speed_10m),
    soilTempC: toNumber(current.soil_temperature_0_to_7cm),
    soilMoistureTop: toNumber(current.soil_moisture_0_to_7cm),
    et0Mm: toNumber(current.et0_fao_evapotranspiration),
    vpdKpa: toNumber(current.vapour_pressure_deficit),
  };

  const summary = buildSummary({
    elevationMeters,
    current: currentSignals,
    history: resolvedHistory,
  });

  return {
    provider: "open-meteo",
    free: true,
    dataSources: [
      "Open-Meteo Elevation",
      "Open-Meteo Forecast",
      "Open-Meteo Historical Weather",
    ],
    elevationMeters,
    current: currentSignals,
    forecastDaily: {
      temperatureMaxC: daily.temperature_2m_max?.[0] ?? null,
      temperatureMinC: daily.temperature_2m_min?.[0] ?? null,
      precipitationSumMm: daily.precipitation_sum?.[0] ?? null,
      rainSumMm: daily.rain_sum?.[0] ?? null,
      et0Mm: daily.et0_fao_evapotranspiration?.[0] ?? null,
      soilMoistureTop: daily.soil_moisture_0_to_7cm?.[0] ?? null,
      soilMoistureRoot: daily.soil_moisture_7_to_28cm?.[0] ?? null,
    },
    history: resolvedHistory,
    archiveHistory,
    archiveHourlyHistory,
    summary,
    notes: [
      elevationMeters === null
        ? "Elevation data could not be loaded."
        : `Elevation is about ${Math.round(elevationMeters)} m.`,
      currentSignals.soilMoistureTop === null
        ? "Current surface soil moisture is unavailable."
        : `Surface soil moisture is ${currentSignals.soilMoistureTop.toFixed(3)} m3/m3.`,
      resolvedHistory.totalRainMm === null
        ? "Recent rainfall history is unavailable."
        : `Recent rainfall total over ${resolvedHistory.recentPeriodDays} days is ${resolvedHistory.totalRainMm.toFixed(1)} mm.`,
    ].filter(Boolean),
  };
};

module.exports = {
  getOpenMeteoSignals,
};
