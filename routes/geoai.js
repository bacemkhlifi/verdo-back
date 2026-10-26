const express = require("express");
const jwt = require("jsonwebtoken");
const Analysis = require("../models/Analysis");
const { validateInput, analyzeSite } = require("../utils/siteAnalysis");
const { calculateEstimate } = require("../utils/investmentEstimate");

function identity(req) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.cookies?.token;
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (typeof decoded.id !== "string" || !/^[a-f0-9]{24}$/i.test(decoded.id))
    throw new Error("INVALID_IDENTITY");
  return decoded.id;
}
function createRouter(deps = {}) {
  const router = express.Router();
  const run = deps.analyzeSite || analyzeSite;
  const store = deps.Analysis || Analysis;
  const getIdentity = deps.identity || identity;
  const buckets = new Map();
  const limit = (req, res, next) => {
    const key = req.analysisUserId || req.ip || "unknown",
      now = Date.now();
    const bucket = buckets.get(key);
    if (bucket && now - bucket.start < 60000 && bucket.count >= 10)
      return res
        .status(429)
        .json({
          success: false,
          code: "RATE_LIMITED",
          message: "Please wait before running another analysis.",
        });
    if (!bucket || now - bucket.start >= 60000) {
      if (buckets.size >= 1000) buckets.delete(buckets.keys().next().value);
      buckets.set(key, { start: now, count: 1 });
    } else bucket.count++;
    next();
  };
  const auth = (required) => (req, res, next) => {
    try {
      req.analysisUserId = getIdentity(req);
      if (required && !req.analysisUserId)
        return res
          .status(401)
          .json({
            success: false,
            code: "AUTH_REQUIRED",
            message: "Please sign in to view your analyses.",
          });
      next();
    } catch {
      res
        .status(401)
        .json({
          success: false,
          code: "AUTH_REQUIRED",
          message: "Your session has expired. Please sign in again.",
        });
    }
  };
  router.post("/analyze", auth(false), limit, async (req, res) => {
    let input;
    try {
      input = validateInput(req.body);
    } catch (error) {
      return res
        .status(400)
        .json({
          success: false,
          code: error.message,
          message: "Please check the location, parcel and analysis inputs.",
        });
    }
    try {
      const result = await run(input);
      let analysisId = null,
        saveWarning = null;
      // Guests can explore without creating unowned persistent database records.
      if (req.analysisUserId) {
        try {
          const analysis = await store.create({
            userId: req.analysisUserId,
            lat: input.lat,
            lon: input.lon,
            constraints: input.constraints,
            soilTest: input.soil_test,
            result,
          });
          analysisId = analysis._id;
        } catch {
          saveWarning = "HISTORY_SAVE_FAILED";
        }
      }
      return res.json({ success: true, analysisId, saveWarning, result });
    } catch (error) {
      console.error("GeoAI analysis failed:", error.name);
      res
        .status(502)
        .json({
          success: false,
          code: "ANALYSIS_UNAVAILABLE",
          message: "The analysis could not be completed. Please try again.",
        });
    }
  });
  router.post("/estimate", limit, (req, res) => {
    try {
      res.json({ success: true, result: calculateEstimate(req.body) });
    } catch (error) {
      res
        .status(400)
        .json({
          success: false,
          code: error.message,
          message: "Complete the financial assumptions and quotation source.",
        });
    }
  });
  router.get("/history", auth(true), async (req, res) => {
    try {
      const page = Math.max(
        1,
        Math.min(10000, parseInt(req.query.page, 10) || 1),
      );
      const data = await store
        .find({ userId: req.analysisUserId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * 20)
        .limit(20)
        .lean();
      res.json({ success: true, data, page, pageSize: 20 });
    } catch {
      res
        .status(500)
        .json({
          success: false,
          code: "HISTORY_UNAVAILABLE",
          message: "Unable to load your saved analyses.",
        });
    }
  });
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.identity = identity;
