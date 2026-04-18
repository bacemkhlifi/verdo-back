const cropProfiles = {
  olive: {
    regionBands: ["north", "central", "south"],
    soilPh: { accept: [5.6, 8.5], ideal: [6.2, 8.0] },
    slope: { accept: [0, 25], ideal: [0, 12] },
    salinityMax: 4.0,
    annualRain: { accept: [150, 900], ideal: [220, 700] },
    meanTemp: { accept: [13, 26], ideal: [16, 24] },
    coldestMonthMin: { accept: [-5, 14], ideal: [0, 10] },
    hottestMonthMax: { accept: [24, 48], ideal: [26, 42] },
    hotDays35: { accept: [0, 120], ideal: [5, 80] },
    frostDays: { accept: [0, 10], ideal: [0, 4] },
    waterNeed: "low",
    baseScore: 62,
  },
  almond: {
    regionBands: ["north", "central"],
    soilPh: { accept: [6.0, 8.0], ideal: [6.4, 7.8] },
    slope: { accept: [0, 20], ideal: [0, 10] },
    salinityMax: 3.5,
    annualRain: { accept: [250, 700], ideal: [300, 550] },
    meanTemp: { accept: [10, 23], ideal: [12, 20] },
    coldestMonthMin: { accept: [-3, 12], ideal: [0, 8] },
    hottestMonthMax: { accept: [22, 46], ideal: [26, 40] },
    hotDays35: { accept: [0, 80], ideal: [5, 60] },
    frostDays: { accept: [0, 15], ideal: [2, 10] },
    waterNeed: "medium",
    baseScore: 60,
  },
  date_palm: {
    regionBands: ["south"],
    soilPh: { accept: [6.0, 8.8], ideal: [6.5, 7.8] },
    slope: { accept: [0, 8], ideal: [0, 4] },
    salinityMax: 7.0,
    annualRain: { accept: [0, 220], ideal: [0, 120] },
    meanTemp: { accept: [22, 38], ideal: [26, 34] },
    coldestMonthMin: { accept: [6, 20], ideal: [10, 16] },
    hottestMonthMax: { accept: [30, 48], ideal: [34, 44] },
    hotDays35: { accept: [35, 220], ideal: [50, 180] },
    frostDays: { accept: [0, 0], ideal: [0, 0] },
    waterNeed: "low",
    baseScore: 34,
  },
  pistachio: {
    regionBands: ["north", "central", "south"],
    soilPh: { accept: [7.0, 8.6], ideal: [7.2, 8.3] },
    slope: { accept: [0, 18], ideal: [0, 10] },
    salinityMax: 4.5,
    annualRain: { accept: [120, 450], ideal: [180, 320] },
    meanTemp: { accept: [13, 29], ideal: [16, 26] },
    coldestMonthMin: { accept: [-5, 12], ideal: [0, 8] },
    hottestMonthMax: { accept: [28, 48], ideal: [32, 44] },
    hotDays35: { accept: [20, 120], ideal: [30, 90] },
    frostDays: { accept: [0, 15], ideal: [2, 10] },
    waterNeed: "low",
    baseScore: 56,
  },
  orange: {
    regionBands: ["north", "central"],
    soilPh: { accept: [6.0, 7.5], ideal: [6.2, 7.0] },
    slope: { accept: [0, 12], ideal: [0, 6] },
    salinityMax: 2.0,
    annualRain: { accept: [400, 1200], ideal: [550, 1000] },
    meanTemp: { accept: [15, 26], ideal: [18, 24] },
    coldestMonthMin: { accept: [2, 14], ideal: [5, 10] },
    hottestMonthMax: { accept: [24, 36], ideal: [26, 32] },
    hotDays35: { accept: [0, 70], ideal: [0, 40] },
    frostDays: { accept: [0, 3], ideal: [0, 1] },
    waterNeed: "high",
    baseScore: 52,
  },
  lemon: {
    regionBands: ["north", "central"],
    soilPh: { accept: [6.0, 7.5], ideal: [6.2, 7.0] },
    slope: { accept: [0, 12], ideal: [0, 6] },
    salinityMax: 2.0,
    annualRain: { accept: [350, 1200], ideal: [500, 950] },
    meanTemp: { accept: [14, 26], ideal: [17, 23] },
    coldestMonthMin: { accept: [3, 14], ideal: [5, 10] },
    hottestMonthMax: { accept: [23, 35], ideal: [25, 31] },
    hotDays35: { accept: [0, 60], ideal: [0, 35] },
    frostDays: { accept: [0, 4], ideal: [0, 2] },
    waterNeed: "high",
    baseScore: 50,
  },
};

const cropKeys = Object.keys(cropProfiles);

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const toNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const pushReason = (reasons, value) => {
  if (value && !reasons.includes(value)) {
    reasons.push(value);
  }
};

const resolveFirstFinite = (...values) => {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
};

const getRegionBand = (lat) => {
  if (!Number.isFinite(lat)) return "unknown";
  if (lat >= 36) return "north";
  if (lat >= 34.3) return "central";
  return "south";
};

const getClimateBand = ({ annualRain, meanTemp }) => {
  if (Number.isFinite(annualRain) && annualRain < 200) return "desert";
  if (Number.isFinite(annualRain) && annualRain < 350) return "arid";
  if (Number.isFinite(annualRain) && annualRain < 550) return "semi_arid";
  if (Number.isFinite(annualRain) && annualRain < 800) return "semi_humid";
  if (Number.isFinite(annualRain)) return "humid";
  if (Number.isFinite(meanTemp) && meanTemp >= 24) return "hot";
  return "unknown";
};

const scoreWithinBand = (value, accept, ideal, weight, invert = false) => {
  if (!Number.isFinite(value)) return { score: 0, insideAccept: false, insideIdeal: false };

  const [acceptMin, acceptMax] = accept;
  const [idealMin, idealMax] = ideal;
  const insideAccept = value >= acceptMin && value <= acceptMax;
  const insideIdeal = value >= idealMin && value <= idealMax;

  if (!insideAccept) {
    return {
      score: invert ? -weight : -weight,
      insideAccept,
      insideIdeal,
    };
  }

  if (insideIdeal) {
    return {
      score: invert ? weight : weight,
      insideAccept,
      insideIdeal,
    };
  }

  const distanceToIdeal =
    value < idealMin ? idealMin - value : value > idealMax ? value - idealMax : 0;
  const acceptSpan = Math.max(acceptMax - acceptMin, 1);
  const closeness = clamp(1 - distanceToIdeal / acceptSpan, 0, 1);

  return {
    score: (invert ? weight : weight) * (0.35 + closeness * 0.4),
    insideAccept,
    insideIdeal,
  };
};

const getCropRecommendations = ({ form, result, apiInsights = {} }) => {
  const indicators = result?.indicators || {};
  const openMeteo = apiInsights.openMeteo || {};
  const nasa = apiInsights.nasaPower || {};

  const lat = toNumber(form?.lat);
  const ph = resolveFirstFinite(form?.soilPh, apiInsights.derivedInputs?.soilPh);
  const slope = resolveFirstFinite(form?.slopeMax, apiInsights.derivedInputs?.slopeMax);
  const salinity = form?.waterSalinity === "" ? null : toNumber(form?.waterSalinity);
  const organicMatter = form?.organicMatter === "" ? null : toNumber(form?.organicMatter);
  const water =
    form?.waterAccess === "true"
      ? true
      : form?.waterAccess === "false"
        ? false
        : null;

  const annualRain = resolveFirstFinite(
    indicators.annual_rainfall_mm_est,
    nasa?.climate?.annualRainMm,
  );
  const meanTemp = resolveFirstFinite(
    indicators.mean_temp_c_est,
    nasa?.climate?.meanTempC,
    openMeteo?.current?.temperatureC,
  );
  const hot35 = resolveFirstFinite(
    indicators.hot_days_ge_35_per_year_est,
    nasa?.climate?.hotDays35,
  );
  const frost = resolveFirstFinite(
    indicators.frost_days_le_0_per_year_est,
    nasa?.climate?.frostDays,
  );
  const coldestMonthMin = resolveFirstFinite(
    nasa?.summary?.coldestMonth?.value,
  );
  const hottestMonthMax = resolveFirstFinite(
    nasa?.summary?.hottestMonth?.value,
  );
  const dryMonths = resolveFirstFinite(
    nasa?.climate?.dryMonths,
  );
  const aridity = normalizeText(indicators.aridity_class || nasa?.summary?.classification);
  const droughtRisk = normalizeText(
    indicators.drought_risk_no_irrigation ||
      indicators.drought_risk ||
      openMeteo?.summary?.rainfallLabel,
  );

  const regionBand = getRegionBand(lat);
  const climateBand = getClimateBand({ annualRain, meanTemp });

  const context = {
    lat,
    ph,
    slope,
    salinity,
    organicMatter,
    water,
    annualRain,
    meanTemp,
    hot35,
    frost,
    coldestMonthMin,
    hottestMonthMax,
    dryMonths,
    aridity,
    droughtRisk,
    regionBand,
    climateBand,
    isNorth: regionBand === "north",
    isCentral: regionBand === "central",
    isSouth: regionBand === "south",
    isExtremeArid: aridity === "extreme_arid" || droughtRisk === "very_high",
    isArid: aridity === "arid",
    isSemiArid: aridity === "semi_arid",
  };

  const coreKnownCount = [
    context.ph,
    context.slope,
    context.annualRain,
    context.meanTemp,
    context.coldestMonthMin,
    context.hottestMonthMax,
  ].filter(Number.isFinite).length;

  const evaluate = (key) => {
    const profile = cropProfiles[key];
    const reasons = [];
    const tips = [];
    let score = profile.baseScore;
    const hardFails = [];

    const regionAllowed = profile.regionBands.includes(context.regionBand);
    if (!regionAllowed) {
      hardFails.push("region");
    } else if (profile.regionBands.length > 1) {
      score += context.regionBand === "north" ? 10 : context.regionBand === "central" ? 8 : 6;
    }

    const phFit = scoreWithinBand(context.ph, profile.soilPh.accept, profile.soilPh.ideal, 14);
    score += phFit.score;
    if (Number.isFinite(context.ph)) {
      pushReason(
        reasons,
        phFit.insideIdeal
          ? "Soil pH is in the preferred range."
          : phFit.insideAccept
            ? "Soil pH is acceptable, but not ideal."
            : "Soil pH is outside the acceptable range.",
      );
      if (!phFit.insideAccept) {
        hardFails.push("soilPh");
      }
    }

    const slopeFit = scoreWithinBand(context.slope, profile.slope.accept, profile.slope.ideal, 12);
    score += slopeFit.score;
    if (Number.isFinite(context.slope)) {
      pushReason(
        reasons,
        slopeFit.insideIdeal
          ? "Slope is manageable."
          : slopeFit.insideAccept
            ? "Slope is acceptable, but not ideal."
            : "Slope is too steep for a safe recommendation.",
      );
      if (!slopeFit.insideAccept) {
        hardFails.push("slope");
      }
      if (!slopeFit.insideIdeal) {
        tips.push("Consider terracing or contour planting.");
      }
    }

    if (Number.isFinite(context.salinity)) {
      if (context.salinity <= profile.salinityMax) {
        score += 8;
      } else {
        score -= 18;
        pushReason(reasons, "Salinity is above the preferred limit.");
        if (profile.waterNeed === "high" || profile.waterNeed === "medium") {
          hardFails.push("salinity");
        }
      }
    }

    if (Number.isFinite(context.organicMatter) && context.organicMatter >= 2) {
      score += 4;
    }

    const rainFit = scoreWithinBand(
      context.annualRain,
      profile.annualRain.accept,
      profile.annualRain.ideal,
      20,
    );
    score += rainFit.score;
    if (Number.isFinite(context.annualRain)) {
      pushReason(
        reasons,
        rainFit.insideIdeal
          ? "Annual rainfall fits the crop."
          : rainFit.insideAccept
            ? "Annual rainfall is acceptable, but not ideal."
            : "Annual rainfall is outside the acceptable range.",
      );
      if (!rainFit.insideAccept) {
        hardFails.push("annualRain");
      }
    }

    const tempFit = scoreWithinBand(
      context.meanTemp,
      profile.meanTemp.accept,
      profile.meanTemp.ideal,
      18,
    );
    score += tempFit.score;
    if (Number.isFinite(context.meanTemp)) {
      pushReason(
        reasons,
        tempFit.insideIdeal
          ? "Mean temperature matches the crop well."
          : tempFit.insideAccept
            ? "Mean temperature is acceptable, but not ideal."
            : "Mean temperature is outside the acceptable range.",
      );
      if (!tempFit.insideAccept) {
        hardFails.push("meanTemp");
      }
    }

    const coldFit = scoreWithinBand(
      context.coldestMonthMin,
      profile.coldestMonthMin.accept,
      profile.coldestMonthMin.ideal,
      12,
    );
    score += coldFit.score;
    if (Number.isFinite(context.coldestMonthMin)) {
      if (profile.regionBands.includes("south") && key === "date_palm" && context.coldestMonthMin < 6) {
        hardFails.push("coldWinter");
      }
      if (key === "almond" && context.coldestMonthMin > 12) {
        hardFails.push("notEnoughChill");
      }
      if (key === "orange" || key === "lemon") {
        if (context.coldestMonthMin < profile.coldestMonthMin.accept[0]) {
          hardFails.push("frostRisk");
        }
      }
    }

    const hotFit = scoreWithinBand(
      context.hottestMonthMax,
      profile.hottestMonthMax.accept,
      profile.hottestMonthMax.ideal,
      8,
    );
    score += hotFit.score;
    if (Number.isFinite(context.hottestMonthMax) && !hotFit.insideAccept) {
      hardFails.push("heat");
    }

    if (Number.isFinite(context.hot35)) {
      const hot35Fit = scoreWithinBand(
        context.hot35,
        profile.hotDays35.accept,
        profile.hotDays35.ideal,
        8,
      );
      score += hot35Fit.score;
      if (!hot35Fit.insideAccept) {
        hardFails.push("hotDays");
      }
    }

    if (Number.isFinite(context.frost)) {
      const frostFit = scoreWithinBand(
        context.frost,
        profile.frostDays.accept,
        profile.frostDays.ideal,
        8,
      );
      score += frostFit.score;
      if (!frostFit.insideAccept) {
        hardFails.push("frost");
      }
      if (context.frost > 0 && (key === "date_palm" || key === "orange" || key === "lemon")) {
        pushReason(reasons, "Frost risk is present.");
      }
      if (context.frost > 0 && key === "date_palm") {
        hardFails.push("datePalmFrost");
      }
    }

    if (context.water === true) {
      if (profile.waterNeed === "high") score += 6;
      else if (profile.waterNeed === "medium") score += 3;
    } else if (context.water === false) {
      if (profile.waterNeed === "high") {
        score -= 18;
        hardFails.push("noWater");
      } else if (profile.waterNeed === "medium") {
        score -= 10;
      } else {
        score -= 3;
      }
    }

    if (context.isExtremeArid && key !== "date_palm" && key !== "pistachio" && key !== "olive") {
      score -= 10;
      hardFails.push("tooArid");
    }

    if (context.isArid || context.isSemiArid) {
      if (key === "olive" || key === "pistachio") score += 4;
      if (key === "date_palm") score += 8;
    }

    if (key === "orange" || key === "lemon") {
      if (context.regionBand === "north") score += 8;
      if (context.climateBand === "humid" || context.climateBand === "semi_humid") score += 8;
      if (context.climateBand === "arid" || context.climateBand === "desert") hardFails.push("tooDry");
      if (context.hottestMonthMax !== null && context.hottestMonthMax < 24) hardFails.push("tooCool");
    }

    if (key === "almond") {
      if (context.regionBand === "north") score += 8;
      if (context.climateBand === "semi_arid" || context.climateBand === "semi_humid") score += 5;
      if (context.climateBand === "humid") score -= 6;
      if (Number.isFinite(context.coldestMonthMin) && context.coldestMonthMin > 12) {
        hardFails.push("tooWarmWinter");
      }
    }

    if (key === "olive") {
      if (context.climateBand === "semi_arid" || context.climateBand === "semi_humid") score += 6;
      if (context.climateBand === "humid") score -= 6;
    }

    if (key === "pistachio") {
      if (context.climateBand === "arid" || context.climateBand === "semi_arid") score += 8;
      if (context.climateBand === "humid") score -= 8;
    }

    if (context.regionBand === "south" && (key === "orange" || key === "lemon")) {
      hardFails.push("southernCitrus");
    }

    if (context.regionBand === "south" && key === "almond") {
      hardFails.push("southernAlmond");
    }

    if (context.regionBand !== "south" && key === "date_palm") {
      hardFails.push("datePalmRegion");
    }

    if (context.regionBand === "north" && key === "date_palm") {
      hardFails.push("datePalmNorth");
    }

    if (key === "date_palm" && Number.isFinite(context.annualRain) && context.annualRain > 220) {
      hardFails.push("tooWet");
    }

    if (coreKnownCount < 4) {
      hardFails.push("insufficientData");
    }

    score = clamp(score, 0, 100);

    let fit = "unsuitable";
    if (!hardFails.length) {
      if (score >= 86) {
        fit = "high";
      } else if (score >= 72) {
        fit = "medium";
      } else if (score >= 60) {
        fit = "low";
      }
    }

    if (fit === "unsuitable") {
      if (!reasons.length) {
        pushReason(reasons, "This crop does not meet the site requirements.");
      }
      if (!tips.length) {
        tips.push("Use a crop only if the site conditions improve or are verified by a local agronomist.");
      }
    } else if (!tips.length) {
      tips.push("This crop appears compatible with the current site conditions.");
    }

    return {
      cropKey: key,
      activity: `${key.replace("_", " ")} orchard`,
      fit,
      score,
      reasons: reasons.slice(0, 4),
      tips: tips.slice(0, 3),
      source: "local-agronomy-rules",
    };
  };

  return cropKeys
    .map((key) => evaluate(key))
    .sort((left, right) => right.score - left.score)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
};

module.exports = {
  cropProfiles,
  getCropRecommendations,
};
