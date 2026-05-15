const express = require("express");
const Visitor = require("../models/Visitor");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const visitorId = String(req.body.visitorId || "").trim();

    if (!visitorId) {
      return res.status(400).json({
        success: false,
        message: "Visitor id is required",
      });
    }

    const visitor = await Visitor.findOneAndUpdate(
      { visitorId },
      {
        $set: {
          lastSeenAt: new Date(),
          lastPath: String(req.body.path || "").slice(0, 300),
          userAgent: String(req.get("user-agent") || "").slice(0, 500),
        },
        $setOnInsert: {
          visitorId,
          firstSeenAt: new Date(),
        },
        $inc: { visits: 1 },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    res.status(200).json({ success: true, data: { visitorId: visitor.visitorId } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
