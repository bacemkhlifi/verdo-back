const NASA_POWER_CLIMATOLOGY_URL =
  "https://power.larc.nasa.gov/api/temporal/climatology/point";

const TIMEOUT_MS = 12000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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
  if (!Number.isFinite(number) || number <= -900) {
    return null;
  }
  return number;
};

const formatMonth = (monthKey) => monthKey.slice(0, 1) + monthKey.slice(1).toLowerCase();

const parseParameterSeries = (parameterMap, key) => {
  const values = parameterMap?.[key];
  if (!values || typeof values !== "object") {
    return [];
  }

  return MONTHS.map((month) => ({
    month,
    value: toNumber(values[month]),
  })).filter((entry) => entry.value !== null);
};

const average = (values) => {
  const list = values.map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
};

const sum = (values) => {
  const list = values.map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  return list.reduce((total, value) => total + value, 0);
};

const maxEntry = (entries) => {
  if (!entries.length) return null;
  return entries.reduce((best, entry) => (entry.value > best.value ? entry : best));
};

const minEntry = (entries) => {
  if (!entries.length) return null;
  return entries.reduce((best, entry) => (entry.value < best.value ? entry : best));
};

const classifyClimate = (annualRainMm, meanTempC) => {
  if (annualRainMm === null || meanTempC === null) return "unknown";
  if (annualRainMm < 200) return "arid";
  if (annualRainMm < 400) return "semi_arid";
  if (annualRainMm < 800) return "moderately_humid";
  return "humid";
};

const getNasaPowerSignals = async (lat, lon) => {
  const url = new URL(NASA_POWER_CLIMATOLOGY_URL);
  url.searchParams.set(
    "parameters",
    [
      "T2M",
      "T2M_MAX",
      "T2M_MIN",
      "PRECTOT",
      "RH2M",
      "ALLSKY_SFC_SW_DWN",
      "WS10M",
      "PS",
      "T2MDEW",
    ].join(",")
  );
  url.searchParams.set("community", "AG");
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("format", "JSON");
  url.searchParams.set("start", "2014");
  url.searchParams.set("end", "2024");
  url.searchParams.set("time-standard", "UTC");

  const payload = await fetchJson(url.toString());
  const parameterMap = payload?.properties?.parameter || {};

  const temperature = parseParameterSeries(parameterMap, "T2M");
  const temperatureMax = parseParameterSeries(parameterMap, "T2M_MAX");
  const temperatureMin = parseParameterSeries(parameterMap, "T2M_MIN");
  const rainfall = parseParameterSeries(parameterMap, "PRECTOT");
  const humidity = parseParameterSeries(parameterMap, "RH2M");
  const solar = parseParameterSeries(parameterMap, "ALLSKY_SFC_SW_DWN");
  const wind = parseParameterSeries(parameterMap, "WS10M");
  const pressure = parseParameterSeries(parameterMap, "PS");
  const dewPoint = parseParameterSeries(parameterMap, "T2MDEW");

  const annualRainMm = sum(rainfall.map((item) => item.value));
  const meanTempC = average(temperature.map((item) => item.value));
  const hottestMonth = maxEntry(temperatureMax);
  const coldestMonth = minEntry(temperatureMin);
  const wettestMonth = maxEntry(rainfall);
  const driestMonth = minEntry(rainfall);
  const humidMonth = maxEntry(humidity);
  const solarPeakMonth = maxEntry(solar);

  const dryMonths = rainfall.filter((item) => item.value < 10).length;
  const hotMonths = temperatureMax.filter((item) => item.value >= 35).length;

  return {
    provider: "nasa-power",
    free: true,
    dataSources: ["NASA POWER Climatology API"],
    climate: {
      classification: classifyClimate(annualRainMm, meanTempC),
      annualRainMm,
      meanTempC,
      dryMonths,
      hotMonths,
      temperatureMonthly: temperature,
      temperatureMaxMonthly: temperatureMax,
      temperatureMinMonthly: temperatureMin,
      rainfallMonthly: rainfall,
      humidityMonthly: humidity,
      solarMonthly: solar,
      windMonthly: wind,
      pressureMonthly: pressure,
      dewPointMonthly: dewPoint,
    },
    summary: {
      hottestMonth: hottestMonth ? { month: formatMonth(hottestMonth.month), value: hottestMonth.value } : null,
      coldestMonth: coldestMonth ? { month: formatMonth(coldestMonth.month), value: coldestMonth.value } : null,
      wettestMonth: wettestMonth ? { month: formatMonth(wettestMonth.month), value: wettestMonth.value } : null,
      driestMonth: driestMonth ? { month: formatMonth(driestMonth.month), value: driestMonth.value } : null,
      humidMonth: humidMonth ? { month: formatMonth(humidMonth.month), value: humidMonth.value } : null,
      solarPeakMonth: solarPeakMonth ? { month: formatMonth(solarPeakMonth.month), value: solarPeakMonth.value } : null,
      classification: classifyClimate(annualRainMm, meanTempC),
    },
    notes: [
      annualRainMm === null
        ? "NASA POWER climatology did not return rainfall for this point."
        : `Average annual rainfall is about ${annualRainMm.toFixed(0)} mm.`,
      meanTempC === null
        ? "NASA POWER climatology did not return temperature for this point."
        : `Mean annual temperature is about ${meanTempC.toFixed(1)}°C.`,
    ],
  };
};

module.exports = {
  getNasaPowerSignals,
};
