const { fetchJson } = require("./providerHttp");
const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
const sum = (values) => {
  const known = values.map(number).filter(Number.isFinite);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};
async function getOpenMeteoSignals(lat, lon) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const forecast = new URL("https://api.open-meteo.com/v1/forecast");
  forecast.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    timezone: "auto",
    forecast_days: 1,
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
    hourly: "soil_moisture_0_to_7cm,soil_temperature_0_to_7cm",
    daily: "et0_fao_evapotranspiration",
  }).toString();
  const archive = new URL("https://archive-api.open-meteo.com/v1/archive");
  archive.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    timezone: "auto",
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration",
  }).toString();
  const [currentResponse, historyResponse] = await Promise.allSettled([
    fetchJson(forecast),
    fetchJson(archive),
  ]);
  const live =
    currentResponse.status === "fulfilled" ? currentResponse.value : null;
  const daily =
    historyResponse.status === "fulfilled" ? historyResponse.value.daily : null;
  const current = live?.current || {};
  const rain = daily?.precipitation_sum || [];
  const known = rain.map(number).filter(Number.isFinite);
  return {
    provider: "open-meteo",
    dataSources: ["Open-Meteo Forecast", "Open-Meteo Historical Weather"],
    status:
      live && daily ? "available" : live || daily ? "partial" : "unavailable",
    elevationMeters: number(live?.elevation),
    current: {
      temperatureC: number(current.temperature_2m),
      humidityPct: number(current.relative_humidity_2m),
      windKph: number(current.wind_speed_10m),
      precipitationMm: number(current.precipitation),
    },
    history: {
      totalRainMm: sum(rain),
      avgRainMm: known.length ? sum(rain) / known.length : null,
      daysCollected: known.length,
      recentPeriodDays: daily?.time?.length || 0,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      et0TotalMm: sum(daily?.et0_fao_evapotranspiration || []),
    },
    notes: [
      "Recent weather is operational context, not a long-term climate normal.",
    ],
  };
}
module.exports = { getOpenMeteoSignals };
