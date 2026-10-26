// Local-only preview. Intentionally never loads .env or connects to MongoDB.
const express = require("express");
const cors = require("cors");
const { createRouter } = require("../routes/geoai");
const app = express();
app.use(
  cors({
    origin: ["http://127.0.0.1:5179", "http://localhost:5179"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use("/api/geoai", createRouter({ identity: () => null }));
app.listen(5019, "127.0.0.1", () =>
  console.log(
    "GeoAI preview on http://127.0.0.1:5019 (no database connection)",
  ),
);
