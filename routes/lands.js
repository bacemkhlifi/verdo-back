const express = require("express");
const Land = require("../models/Land");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const serializeLand = (land) => ({
  _id: land._id,
  id: land._id,
  owner: land.owner,
  name: land.name,
  location: land.location,
  size: land.size,
  electricity: land.electricity,
  hasTrees: land.hasTrees,
  water: land.water,
  notes: land.notes,
  status: land.status,
  reviewedBy: land.reviewedBy,
  reviewedAt: land.reviewedAt,
  rejectionReason: land.rejectionReason,
  createdAt: land.createdAt,
  updatedAt: land.updatedAt,
});

router.post("/", protect, authorize("landowner"), async (req, res) => {
  try {
    const land = await Land.create({
      owner: req.user._id,
      name: req.body.name,
      location: req.body.location,
      size: req.body.size,
      electricity: Boolean(req.body.electricity),
      hasTrees: Boolean(req.body.hasTrees),
      water: Boolean(req.body.water),
      notes: req.body.notes,
    });

    res.status(201).json({ success: true, data: serializeLand(land) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/approved", async (req, res) => {
  try {
    const lands = await Land.find({ status: "approved" })
      .populate("owner", "firstName lastName email")
      .sort({ reviewedAt: -1, createdAt: -1 });
    res.status(200).json({ success: true, data: lands.map(serializeLand) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load approved lands" });
  }
});

router.get("/my", protect, authorize("landowner"), async (req, res) => {
  try {
    const lands = await Land.find({ owner: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: lands.map(serializeLand) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load lands" });
  }
});

router.get("/", protect, authorize("admin"), async (req, res) => {
  try {
    const lands = await Land.find()
      .populate("owner", "firstName lastName email phoneNumber entityType")
      .populate("reviewedBy", "firstName lastName email")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: lands.map(serializeLand) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load lands" });
  }
});

router.patch("/:id/status", protect, authorize("admin"), async (req, res) => {
  try {
    const { status, rejectionReason = "" } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid land status" });
    }

    const land = await Land.findByIdAndUpdate(
      req.params.id,
      {
        status,
        rejectionReason: status === "rejected" ? rejectionReason : "",
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
      },
      { new: true, runValidators: true }
    )
      .populate("owner", "firstName lastName email phoneNumber entityType")
      .populate("reviewedBy", "firstName lastName email");

    if (!land) {
      return res.status(404).json({ success: false, message: "Land not found" });
    }

    res.status(200).json({ success: true, data: serializeLand(land) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete("/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const land = await Land.findByIdAndDelete(req.params.id);
    if (!land) {
      return res.status(404).json({ success: false, message: "Land not found" });
    }
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete land" });
  }
});

module.exports = router;
