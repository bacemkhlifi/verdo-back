const mongoose = require("mongoose");

const LandSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Please add a property name"],
      trim: true,
    },
    location: {
      type: String,
      required: [true, "Please add a location"],
      trim: true,
    },
    size: {
      type: String,
      default: "",
      trim: true,
    },
    electricity: {
      type: Boolean,
      default: false,
    },
    hasTrees: {
      type: Boolean,
      default: false,
    },
    water: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Land", LandSchema);
