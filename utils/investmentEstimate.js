const limits = {
  areaHa: [0.01, 10000],
  usablePct: [1, 100],
  spacingRowM: [1, 30],
  spacingTreeM: [1, 30],
  establishmentPerHa: [0, 1000000],
  annualFixedPerHa: [0, 1000000],
  harvestPerKg: [0, 10000],
  yieldKgHa: [0, 100000],
  pricePerKg: [0, 10000],
  firstHarvestYear: [1, 20],
  matureYear: [1, 25],
  horizonYears: [5, 30],
  discountPct: [0, 50],
  annualWaterM3Ha: [0, 100000],
  waterCostM3: [0, 100],
  availableWaterM3: [0, 1000000000],
  contingencyPct: [0, 50],
};
function validateAssumptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_ESTIMATE_INPUT");
  const a = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (
      key === "availableWaterM3" &&
      (input[key] === null || input[key] === undefined || input[key] === "")
    ) {
      a[key] = null;
      continue;
    }
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error(`INVALID_ESTIMATE_${key}`);
    a[key] = value;
  }
  for (const key of ["firstHarvestYear", "matureYear", "horizonYears"])
    if (!Number.isInteger(a[key])) throw new Error(`INVALID_ESTIMATE_${key}`);
  if (a.matureYear < a.firstHarvestYear || a.horizonYears < a.matureYear)
    throw new Error("INVALID_ESTIMATE_YEARS");
  a.cropKey = String(input.cropKey || "").slice(0, 40);
  a.priceSource = String(input.priceSource || "")
    .trim()
    .slice(0, 240);
  a.quoteDate = String(input.quoteDate || "").slice(0, 10);
  if (
    ![
      "olive",
      "almond",
      "pistachio",
      "date_palm",
      "orange",
      "lemon",
      "fig",
      "pomegranate",
    ].includes(a.cropKey)
  )
    throw new Error("INVALID_ESTIMATE_CROP");
  if (
    !a.priceSource ||
    !/^\d{4}-\d{2}-\d{2}$/.test(a.quoteDate) ||
    Number.isNaN(Date.parse(a.quoteDate)) ||
    new Date(a.quoteDate).toISOString().slice(0, 10) !== a.quoteDate
  )
    throw new Error("ESTIMATE_SOURCE_REQUIRED");
  return a;
}
function calculateEstimate(input) {
  const a = validateAssumptions(input);
  const usableHa = (a.areaHa * a.usablePct) / 100;
  const investment =
    usableHa * a.establishmentPerHa * (1 + a.contingencyPct / 100);
  function project(yieldFactor, priceFactor, costFactor) {
    const rows = [
      {
        year: 0,
        revenue: 0,
        operatingCost: 0,
        cashFlow: -investment,
        cumulative: -investment,
      },
    ];
    let cumulative = -investment,
      paybackYear = null,
      npv = -investment,
      funding = investment;
    for (let year = 1; year <= a.horizonYears; year++) {
      const ramp =
        year < a.firstHarvestYear
          ? 0
          : a.matureYear === a.firstHarvestYear
            ? 1
            : Math.min(
                1,
                (year - a.firstHarvestYear + 1) /
                  (a.matureYear - a.firstHarvestYear + 1),
              );
      const yieldKg = usableHa * a.yieldKgHa * yieldFactor * ramp;
      const revenue = yieldKg * a.pricePerKg * priceFactor;
      const operatingCost =
        (usableHa * a.annualFixedPerHa +
          usableHa * a.annualWaterM3Ha * a.waterCostM3 +
          yieldKg * a.harvestPerKg) *
        costFactor;
      const cashFlow = revenue - operatingCost;
      cumulative += cashFlow;
      npv += cashFlow / (1 + a.discountPct / 100) ** year;
      funding = Math.max(funding, -cumulative);
      if (paybackYear === null && cumulative >= 0) paybackYear = year;
      rows.push({
        year,
        yieldKg,
        revenue,
        operatingCost,
        cashFlow,
        cumulative,
      });
    }
    // Conventional cash flows only: no ambiguous multi-root IRR is presented.
    let irrPct = null;
    const signs = rows.map((r) => Math.sign(r.cashFlow)).filter(Boolean);
    const changes = signs
      .slice(1)
      .filter((sign, index) => sign !== signs[index]).length;
    if (investment > 0 && changes === 1 && signs.at(-1) > 0) {
      const value = (r) =>
        rows.reduce((s, row) => s + row.cashFlow / (1 + r) ** row.year, 0);
      let lo = -0.95,
        hi = 10;
      if (value(lo) * value(hi) < 0) {
        for (let i = 0; i < 100; i++) {
          const mid = (lo + hi) / 2;
          if (value(mid) > 0) lo = mid;
          else hi = mid;
        }
        irrPct = (lo + hi) * 50;
      }
    }
    return {
      rows,
      npv,
      irrPct,
      paybackYear,
      fundingRequired: funding,
      roiPct: investment > 0 ? (cumulative / investment) * 100 : null,
    };
  }
  const annualWaterM3 = usableHa * a.annualWaterM3Ha;
  return {
    version: "scenario-1",
    currency: "TND",
    basis: "constant-price-unlevered",
    assumptions: a,
    usableHa,
    treeCount: Math.floor(
      (usableHa * 10000) / (a.spacingRowM * a.spacingTreeM),
    ),
    investment,
    annualWaterM3,
    waterStatus:
      a.availableWaterM3 === null
        ? "unknown"
        : a.availableWaterM3 < annualWaterM3
          ? "deficit"
          : "covered_by_entered_supply",
    scenarios: {
      low: project(0.75, 0.85, 1.15),
      base: project(1, 1, 1),
      high: project(1.15, 1.1, 1),
    },
    sensitivity: {
      low: { yieldFactor: 0.75, priceFactor: 0.85, operatingCostFactor: 1.15 },
      high: { yieldFactor: 1.15, priceFactor: 1.1, operatingCostFactor: 1 },
    },
    exclusions: [
      "Land purchase/rent, taxes, subsidies, debt, replacement capital, working capital and terminal value are excluded. Include relevant allowances in entered costs or commission a detailed business plan.",
    ],
    notice:
      "User-entered scenario, not a yield prediction or verified local quotation. Water demand is an entered planning assumption, not a computed irrigation prescription.",
  };
}
module.exports = { calculateEstimate, validateAssumptions };
