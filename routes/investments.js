const express = require("express");
const Investment = require("../models/Investment");
const Land = require("../models/Land");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.get("/", protect, authorize("admin"), async (req, res) => {
  const investments = await Investment.find()
    .populate("investor", "firstName lastName email")
    .sort({ date: -1, createdAt: -1 });
  res.status(200).json({ success: true, data: investments });
});

router.post("/", protect, authorize("admin"), async (req, res) => {
  try {
    const investment = await Investment.create({
      project: req.body.project,
      investorName: req.body.investorName || req.body.investor,
      investor: req.body.investorId || null,
      land: req.body.landId || null,
      amount: req.body.amount,
      date: req.body.date,
      status: req.body.status,
    });
    res.status(201).json({ success: true, data: investment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/my", protect, authorize("investor"), async (req, res) => {
  const investments = await Investment.find({ investor: req.user._id })
    .populate("land", "name location size status")
    .sort({ date: -1, createdAt: -1 });

  res.status(200).json({ success: true, data: investments });
});

router.post("/lands/:landId", protect, authorize("investor"), async (req, res) => {
  try {
    const land = await Land.findOne({ _id: req.params.landId, status: "approved" });

    if (!land) {
      return res.status(404).json({
        success: false,
        message: "Approved land opportunity not found",
      });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please add a valid investment amount",
      });
    }

    const investorName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim();
    const investment = await Investment.create({
      project: land.name,
      investorName: investorName || req.user.email,
      investor: req.user._id,
      land: land._id,
      amount,
      date: new Date(),
      status: "Pending",
    });

    const populatedInvestment = await Investment.findById(investment._id)
      .populate("investor", "firstName lastName email")
      .populate("land", "name location size status");

    res.status(201).json({ success: true, data: populatedInvestment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put("/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const investment = await Investment.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!investment) {
      return res.status(404).json({ success: false, message: "Investment not found" });
    }
    res.status(200).json({ success: true, data: investment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete("/:id", protect, authorize("admin"), async (req, res) => {
  const investment = await Investment.findByIdAndDelete(req.params.id);
  if (!investment) {
    return res.status(404).json({ success: false, message: "Investment not found" });
  }
  res.status(200).json({ success: true, data: {} });
});

module.exports = router;
