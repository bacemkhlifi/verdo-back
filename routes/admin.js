const express = require("express");
const User = require("../models/User");
const Role = require("../models/Role");
const Land = require("../models/Land");
const Investment = require("../models/Investment");
const Visitor = require("../models/Visitor");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const roleNames = (roles = []) =>
  roles.map((role) => (typeof role === "object" && role.name ? role.name : String(role)));

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phoneNumber: user.phoneNumber,
  entityType: user.entityType,
  roles: roleNames(user.roles),
  role: roleNames(user.roles)[0] || "",
  active: user.active !== false,
  createdAt: user.createdAt,
});

router.get("/users", protect, authorize("admin"), async (req, res) => {
  const users = await User.find().populate("roles").sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: users.map(serializeUser) });
});

router.post("/users", protect, authorize("admin"), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phoneNumber = "00000000",
      password = "password123",
      entityType = "individual",
      role,
      active = true,
    } = req.body;
    const roleDoc = await Role.findOne({ name: String(role || "").toLowerCase() });

    const user = await User.create({
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      entityType,
      active,
      roles: roleDoc ? [roleDoc._id] : [],
    });

    const populatedUser = await User.findById(user._id).populate("roles");
    res.status(201).json({ success: true, data: serializeUser(populatedUser) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch("/users/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const update = {};
    ["firstName", "lastName", "email", "phoneNumber", "entityType", "active"].forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });

    if (req.body.role) {
      const roleDoc = await Role.findOne({ name: String(req.body.role).toLowerCase() });
      update.roles = roleDoc ? [roleDoc._id] : [];
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).populate("roles");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, data: serializeUser(user) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete("/users/:id", protect, authorize("admin"), async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  res.status(200).json({ success: true, data: {} });
});

router.get("/summary", protect, authorize("admin"), async (req, res) => {
  const [totalUsers, totalLands, lands, investments, uniqueVisitors, visitTotals] = await Promise.all([
    User.countDocuments(),
    Land.countDocuments(),
    Land.find().populate("owner", "firstName lastName email").sort({ createdAt: -1 }).limit(5),
    Investment.find(),
    Visitor.countDocuments(),
    Visitor.aggregate([{ $group: { _id: null, totalVisits: { $sum: "$visits" } } }]),
  ]);

  const totalInvestments = investments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const totalVisits = visitTotals[0]?.totalVisits || 0;
  const pendingLands = await Land.countDocuments({ status: "pending" });
  const approvedLands = await Land.countDocuments({ status: "approved" });

  const recentActivities = lands.map((land) => ({
    title: land.status === "pending" ? "New land submitted" : `Land ${land.status}`,
    type: "Land",
    description: `${land.name} by ${land.owner?.firstName || "Unknown"} ${land.owner?.lastName || ""}`.trim(),
    date: land.createdAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      totalLands,
      totalInvestments,
      totalVisits,
      uniqueVisitors,
      pendingLands,
      approvedLands,
      recentActivities,
    },
  });
});

module.exports = router;
