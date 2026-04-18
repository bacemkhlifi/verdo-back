const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema({
  userId: {
    type: String,
    default: null,
  },
  lat: {
    type: Number,
    required: true,
  },
  lon: {
    type: Number,
    required: true,
  },
  constraints: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  soilTest: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Analysis", analysisSchema);
