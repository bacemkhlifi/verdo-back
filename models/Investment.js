const mongoose = require("mongoose");

const InvestmentSchema = new mongoose.Schema(
  {
    project: {
      type: String,
      required: [true, "Please add a project name"],
      trim: true,
    },
    investorName: {
      type: String,
      required: [true, "Please add an investor name"],
      trim: true,
    },
    investor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    land: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Land",
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "Please add an amount"],
      min: 0,
    },
    date: {
      type: Date,
      required: [true, "Please add an investment date"],
    },
    status: {
      type: String,
      enum: ["Completed", "Pending", "Cancelled"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", InvestmentSchema);
