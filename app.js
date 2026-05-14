const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const { execFile } = require("child_process");
const { promisify } = require("util");
const authRoutes = require("./routes/auth");
const rolesRoutes = require("./routes/roles");
const geoAiRoutes = require("./routes/geoai");
const landsRoutes = require("./routes/lands");
const investmentsRoutes = require("./routes/investments");
const adminRoutes = require("./routes/admin");
const visitorsRoutes = require("./routes/visitors");

dotenv.config();
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
  ].filter(Boolean)
);

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Root route
app.get("/", (req, res) => {
  res.send("Verdolive API is running");
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/geoai", geoAiRoutes);
app.use("/api/lands", landsRoutes);
app.use("/api/investments", investmentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/visitors", visitorsRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Server error",
  });
});

const isSrvMongoUri = (uri) => uri.startsWith("mongodb+srv://");

const runPowerShellJson = async (script) => {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const text = stdout.trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
};

const expandSrvMongoUri = async (uri) => {
  if (!isSrvMongoUri(uri) || process.platform !== "win32") {
    return uri;
  }

  const parsed = new URL(uri);
  const srvName = `_mongodb._tcp.${parsed.hostname}`;
  const escapedSrvName = srvName.replace(/'/g, "''");
  const escapedHostName = parsed.hostname.replace(/'/g, "''");

  const srvRecords = await runPowerShellJson(
    `Resolve-DnsName '${escapedSrvName}' -Type SRV | Select-Object NameTarget,Port | ConvertTo-Json -Compress`
  );
  const txtRecords = await runPowerShellJson(
    `Resolve-DnsName '${escapedHostName}' -Type TXT | ForEach-Object { $_.Strings -join '' } | ConvertTo-Json -Compress`
  ).catch(() => []);

  if (!srvRecords.length) {
    throw new Error(`No SRV records were returned for ${srvName}.`);
  }

  const hosts = srvRecords.map((record) => {
    const nameTarget = String(record.NameTarget || "").replace(/\.$/, "");
    return `${nameTarget}:${record.Port}`;
  });

  const params = new URLSearchParams(parsed.search);

  for (const record of txtRecords) {
    if (typeof record !== "string") {
      continue;
    }

    for (const pair of record.split("&")) {
      const [key, value = ""] = pair.split("=");
      if (key && !params.has(key)) {
        params.set(key, value);
      }
    }
  }

  if (!params.has("tls")) {
    params.set("tls", "true");
  }

  if (!params.has("authSource")) {
    params.set("authSource", "admin");
  }

  const username = parsed.username
    ? encodeURIComponent(decodeURIComponent(parsed.username))
    : "";
  const password = parsed.password
    ? `:${encodeURIComponent(decodeURIComponent(parsed.password))}`
    : "";
  const authPart = username ? `${username}${password}@` : "";
  const pathname = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/";
  const query = params.toString();

  return `mongodb://${authPart}${hosts.join(",")}${pathname}${query ? `?${query}` : ""}`;
};

const connectMongo = async (uri, label) => {
  if (!uri) {
    throw new Error(`${label} is not defined.`);
  }

  const resolvedUri = await expandSrvMongoUri(uri);

  await mongoose.disconnect().catch(() => {});
  await mongoose.connect(resolvedUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  console.log(
    `Connected to MongoDB using ${label}${resolvedUri === uri ? "" : " (expanded from SRV)"}`
  );
};

const startServer = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MongoDB connection error: MONGO_URI is not defined.");
    process.exit(1);
  }

  try {
    await connectMongo(process.env.MONGO_URI, "MONGO_URI");

    if (process.env.NODE_ENV !== "production") {
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    }
  } catch (err) {
    const isAtlasHostIssue =
      err &&
      (err.code === "ENOTFOUND" ||
        err.code === "ECONNREFUSED" ||
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.code === "EAI_AGAIN");

    if (isAtlasHostIssue && process.env.MONGO_URI_FALLBACK) {
      console.warn(
        "Primary MongoDB connection failed, trying MONGO_URI_FALLBACK..."
      );

      try {
        await connectMongo(process.env.MONGO_URI_FALLBACK, "MONGO_URI_FALLBACK");

        if (process.env.NODE_ENV !== "production") {
          app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
          });
        }
        return;
      } catch (fallbackErr) {
        console.error("Fallback MongoDB connection error:", fallbackErr);
      }
    } else if (err.code === "ENOTFOUND" && err.hostname) {
      console.error(
        `MongoDB connection error: could not resolve "${err.hostname}". Check that your Atlas host in MONGO_URI is correct and still exists.`
      );
    } else {
      console.error("MongoDB connection error:", err);
    }

    process.exit(1);
  }
};

startServer();

// Export for Vercel
module.exports = app;
