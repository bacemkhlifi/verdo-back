const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkLocation,
  classifyLandUse,
  isOpenSea,
} = require("../utils/landUse");
const { analyzeSite, validateInput } = require("../utils/siteAnalysis");
const square = (x = 10, y = 35) => [
  { lon: x, lat: y },
  { lon: x + 0.01, lat: y },
  { lon: x + 0.01, lat: y + 0.01 },
  { lon: x, lat: y + 0.01 },
  { lon: x, lat: y },
];

test("ocean mask blocks offshore points but preserves mainland and islands", () => {
  assert.equal(isOpenSea(35, 11.9), true);
  for (const point of [
    [35.25, 10.25],
    [33.8, 10.85],
    [34.7, 11.15],
    [34.7406, 10.7603],
  ])
    assert.equal(isOpenSea(...point), false, String(point));
});
test("sea exclusion is immediate and does not call remote providers", async () => {
  const r = await checkLocation(35, 11.9, async () => {
    throw Error("Must not fetch");
  });
  assert.equal(r.classification, "sea");
  assert.equal(r.isAgricultureAvailable, false);
  const analysis = await analyzeSite(validateInput({ lat: 35, lon: 11.9 }));
  assert.equal(analysis.siteAssessment.status, "excluded");
  assert.equal(analysis.providerStatuses.length, 1);
  assert.equal(analysis.analysisWarning, null);
  assert.ok(
    analysis.recommendations.every(
      (c) => c.status === "not_suitable" && c.score === null,
    ),
  );
});
test("only containing building geometry blocks, not proximity or broad residential zoning", () => {
  assert.equal(
    classifyLandUse(
      { elements: [{ tags: { building: "yes" }, geometry: square() }] },
      35.005,
      10.005,
    ).classification,
    "built_up",
  );
  assert.equal(
    classifyLandUse(
      { elements: [{ tags: { building: "yes" }, geometry: square() }] },
      35.02,
      10.02,
    ).isAgricultureAvailable,
    null,
  );
  assert.equal(
    classifyLandUse(
      { elements: [{ tags: { landuse: "residential" }, geometry: square() }] },
      35.005,
      10.005,
    ).isAgricultureAvailable,
    null,
  );
});
test("multipolygon water respects split outer rings and island holes", () => {
  const outer = square(),
    inner = square(10.004, 35.004).map((p) => ({
      lon: 10.004 + (p.lon - 10.004) / 5,
      lat: 35.004 + (p.lat - 35.004) / 5,
    }));
  const e = {
    type: "relation",
    tags: { natural: "water" },
    members: [
      { type: "way", role: "outer", geometry: outer.slice(0, 3) },
      { type: "way", role: "outer", geometry: outer.slice(2) },
      { type: "way", role: "inner", geometry: inner },
    ],
  };
  assert.equal(
    classifyLandUse({ elements: [e] }, 35.002, 10.002).classification,
    "water",
  );
  assert.equal(
    classifyLandUse({ elements: [e] }, 35.005, 10.005).isAgricultureAvailable,
    null,
  );
});
test("quarries and mapped paved areas block, ordinary roads and farmland do not", () => {
  for (const tags of [
    { landuse: "quarry" },
    { area: "yes", highway: "pedestrian" },
  ])
    assert.equal(
      classifyLandUse(
        { elements: [{ tags, geometry: square() }] },
        35.005,
        10.005,
      ).classification,
      "non_agricultural",
    );
  for (const tags of [
    { landuse: "farmland" },
    { highway: "residential" },
    { building: "no" },
  ])
    assert.equal(
      classifyLandUse(
        { elements: [{ tags, geometry: square() }] },
        35.005,
        10.005,
      ).isAgricultureAvailable,
      null,
    );
});
test("mapping failures and incomplete Overpass responses never certify land or create exclusions", async () => {
  const r = await checkLocation(35.251, 10.251, async () => {
    throw Error("offline");
  });
  assert.equal(r.isAgricultureAvailable, null);
  assert.equal(r.status, "unavailable");
  const partial = await checkLocation(35.252, 10.252, async () => ({
    elements: [],
    remark: "timeout",
  }));
  assert.equal(partial.status, "unavailable");
});
test("full analysis stops before other providers when building containment is confirmed", async () => {
  const r = await analyzeSite(
    validateInput({ lat: 35.005, lon: 10.005 }),
    async () => ({
      classification: "built_up",
      isAgricultureAvailable: false,
      status: "available",
    }),
  );
  assert.equal(r.siteAssessment.status, "excluded");
  assert.equal(r.providerStatuses.length, 1);
});

test("official OSM node/way footprints are reconstructed; incomplete relation holes cannot exclude", () => {
  const { mapGeometry } = require("../utils/landUse");
  const nodes = square()
    .slice(0, -1)
    .map((p, i) => ({ ...p, id: i + 1, type: "node" }));
  const payload = mapGeometry({
    elements: [
      ...nodes,
      {
        id: 99,
        type: "way",
        nodes: [1, 2, 3, 4, 1],
        tags: { building: "yes" },
      },
    ],
  });
  assert.equal(
    classifyLandUse(payload, 35.005, 10.005).classification,
    "built_up",
  );
  const e = {
    type: "relation",
    tags: { natural: "water" },
    members: [
      { type: "way", role: "outer", geometry: square() },
      { type: "way", role: "inner" },
    ],
  };
  assert.equal(
    classifyLandUse({ elements: [e] }, 35.005, 10.005).isAgricultureAvailable,
    null,
  );
});
test("one working map source can block a building despite Overpass failure", async () => {
  const nodes = square(10.3, 35.3)
    .slice(0, -1)
    .map((p, i) => ({ ...p, id: i + 1, type: "node" }));
  const r = await checkLocation(35.305, 10.305, async (url) => {
    if (url.includes("overpass")) throw Error("offline");
    return {
      elements: [
        ...nodes,
        {
          id: 99,
          type: "way",
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "yes" },
        },
      ],
    };
  });
  assert.equal(r.classification, "built_up");
  assert.equal(r.isAgricultureAvailable, false);
});
test("location endpoint validates coordinates and never stores report records", async () => {
  const express = require("express");
  const { createRouter } = require("../routes/geoai");
  let checks = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/geoai",
    createRouter({
      checkLocation: async () => {
        checks++;
        return { classification: "sea", isAgricultureAvailable: false };
      },
      Analysis: {
        create: () => {
          throw Error("must not store");
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/geoai/location-check`;
  try {
    let r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 100, lon: 10 }),
    });
    assert.equal(r.status, 400);
    assert.equal(checks, 0);
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 35, lon: 11.9 }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result.classification, "sea");
    assert.equal(checks, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
