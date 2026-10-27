// Fixed evidence basis: unknown factors stay unknown, never disappear from the denominator.
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
        weights = 0,
        expectedWeight = 0,
        knownFactors = 0;
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
        expectedWeight += weight;
        const value = context[key];
        if (value === null) {
          missingInputs.push(labels[key]);
          reasons.push({ factor: key, value: null, status: "unknown" });
          continue;
        }
        const ideal = value >= range.ideal[0] && value <= range.ideal[1];
        const accepted = value >= range.accept[0] && value <= range.accept[1];
        const irrigatedRain =
          key === "rain" && value < range.accept[0] && water !== false;
        const points = ideal ? 100 : accepted ? 75 : irrigatedRain ? 55 : 0;
        total += points * weight;
        weights += weight;
        knownFactors++;
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
      if (water !== false) {
        expectedWeight += 15;
        if (context.salinity === null) {
          missingInputs.push("waterSalinity");
          reasons.push({ factor: "salinity", value: null, status: "unknown" });
        } else {
          const ok = context.salinity <= profile.salinityMax;
          total += (ok ? 100 : 0) * 15;
          weights += 15;
          knownFactors++;
          reasons.push({
            factor: "salinity",
            value: context.salinity,
            status: ok ? "acceptable" : "outside_range",
          });
          if (!ok) exclusions.push("salinity");
        }
      }
      // Latitude bands are contextual hints, not crop exclusion boundaries.
      if (!profile.regionBands.includes(region))
        missingInputs.push("localAdaptation");
      if (water === false && profile.waterNeed === "high")
        exclusions.push("noWater");
      if (water === null) missingInputs.push("waterAccess");
      const criticalMissing = [...(profile.criticalChecks || [])];
      missingInputs.push(...criticalMissing);
      if (profile.waterNeed !== "low" || profile.commercialWaterCheck)
        requirements.push("waterVolume");
      const climateKnown = context.rain !== null && context.temp !== null;
      const score =
        climateKnown &&
        weights === expectedWeight &&
        !exclusions.length &&
        !criticalMissing.length
          ? Math.round(total / expectedWeight)
          : null;
      const status = exclusions.length
        ? "not_suitable"
        : !climateKnown
          ? "insufficient_data"
          : "conditional";
      return {
        cropKey,
        activity: `${cropKey.replace("_", " ")} orchard`,
        score,
        scoreBounds:
          climateKnown && !exclusions.length
            ? {
                lower: Math.floor(total / expectedWeight),
                upper: Math.ceil(
                  (total + (expectedWeight - weights) * 100) / expectedWeight,
                ),
                scope:
                  "Unmeasured screening factors can take any value; not a confidence interval",
                excludesCriticalChecks: criticalMissing,
              }
            : null,
        evidenceCoverage: {
          knownFactors,
          totalFactors: water === false ? 6 : 7,
          weightedPct: Math.round((100 * weights) / expectedWeight),
        },
        criticalMissing,
        rankingEligible: false, // No field-calibrated crop comparison model yet.
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
        profileVersion: "tn-screening-2",
      };
    })
    .sort((a, b) => a.cropKey.localeCompare(b.cropKey));
}
module.exports = { scoreCropProfiles };
