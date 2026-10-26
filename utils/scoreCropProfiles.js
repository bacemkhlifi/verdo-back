// Screening index is normalized over known measurements; confidence is separate.
function scoreCropProfiles(profiles, { form, result, apiInsights = {} }) {
  const num = (v) =>
    v === null || v === undefined || v === ""
      ? null
      : Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const indicators = result?.indicators || {},
    climate = apiInsights.nasaPower?.climate || {};
  const first = (...values) => values.map(num).find((v) => v !== null) ?? null;
  const context = {
    ph: first(form.soilPh, apiInsights.derivedInputs?.soilPh),
    slope: first(form.slopeMax, apiInsights.derivedInputs?.slopeMax),
    rain: first(indicators.annual_rainfall_mm_est, climate.annualRainMm),
    temp: first(indicators.mean_temp_c_est, climate.meanTempC),
    hot: first(indicators.hot_days_ge_35_per_year_est),
    frost: first(indicators.frost_days_le_0_per_year_est),
    salinity: num(form.waterSalinity),
  };
  const water =
    form.waterAccess === "true"
      ? true
      : form.waterAccess === "false"
        ? false
        : null;
  const lat = num(form.lat),
    region =
      lat === null
        ? "unknown"
        : lat >= 36
          ? "north"
          : lat >= 34.3
            ? "central"
            : "south";
  const labels = {
    ph: "soilPh",
    slope: "slope",
    rain: "annualRain",
    temp: "meanTemp",
    hot: "heatDays",
    frost: "frostDays",
    salinity: "waterSalinity",
  };
  return Object.entries(profiles)
    .map(([cropKey, profile]) => {
      let total = 0,
        weights = 0;
      const exclusions = [],
        missingInputs = [],
        reasons = [],
        requirements = [];
      const factors = [
        ["ph", profile.soilPh, 15],
        ["slope", profile.slope, 10],
        ["rain", profile.annualRain, 25],
        ["temp", profile.meanTemp, 25],
        ["hot", profile.hotDays35, 10],
        ["frost", profile.frostDays, 10],
      ];
      for (const [key, range, weight] of factors) {
        const value = context[key];
        if (value === null) {
          missingInputs.push(labels[key]);
          continue;
        }
        const ideal = value >= range.ideal[0] && value <= range.ideal[1];
        const accepted = value >= range.accept[0] && value <= range.accept[1];
        const irrigatedRain =
          key === "rain" && value < range.accept[0] && water === true;
        const points = ideal ? 100 : accepted ? 75 : irrigatedRain ? 55 : 0;
        total += points * weight;
        weights += weight;
        reasons.push({
          factor: key,
          value,
          status: ideal
            ? "ideal"
            : accepted
              ? "acceptable"
              : irrigatedRain
                ? "irrigation_required"
                : "outside_range",
        });
        if (!accepted && !irrigatedRain)
          exclusions.push(
            {
              rain: "annualRain",
              temp: "meanTemp",
              ph: "soilPh",
              hot: "hotDays",
              frost: "frost",
            }[key] || labels[key],
          );
        if (irrigatedRain) requirements.push("waterVolume");
      }
      if (context.salinity === null) missingInputs.push("waterSalinity");
      else {
        const ok = context.salinity <= profile.salinityMax;
        total += (ok ? 100 : 0) * 15;
        weights += 15;
        if (!ok) exclusions.push("salinity");
      }
      if (!profile.regionBands.includes(region)) exclusions.push("region");
      if (water === false && profile.waterNeed === "high")
        exclusions.push("noWater");
      if (water === null) missingInputs.push("waterAccess");
      if (profile.waterNeed !== "low") requirements.push("waterVolume");
      const climateKnown = context.rain !== null && context.temp !== null;
      const score =
        climateKnown && weights ? Math.round(total / weights) : null;
      const status = exclusions.length
        ? "not_suitable"
        : !climateKnown
          ? "insufficient_data"
          : "conditional";
      return {
        cropKey,
        activity: `${cropKey.replace("_", " ")} orchard`,
        score,
        status,
        fit:
          status === "not_suitable"
            ? "unsuitable"
            : score === null
              ? "unknown"
              : score >= 85
                ? "high"
                : score >= 65
                  ? "medium"
                  : "low",
        confidence: "low",
        exclusions: [...new Set(exclusions)],
        missingInputs: [...new Set(missingInputs)],
        factors: reasons,
        requirements: [...new Set(requirements)],
        reasons: [],
        tips: [],
        source: "local-agronomy-rules",
        profileVersion: "tn-screening-1",
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .map((crop, index) => ({ ...crop, rank: index + 1 }));
}
module.exports = { scoreCropProfiles };
