require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const config = require("./src/config");
const { connectDatabase } = require("./src/database/connect");
const { ensureSeedData } = require("./src/helpers/seed");
const { attachSocket } = require("./src/socket");
const { startScheduler } = require("./src/socket/scheduler");
const openRoutes = require("./src/routes/open.routes");
const adminRoutes = require("./src/routes/admin.routes");
const superAdminRoutes = require("./src/routes/super-admin.routes");
const { errorHandler } = require("./src/middelwares");

const app = express();

const isTrustedVercelPreviewOrigin = (origin) =>
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");

const { findClientByHostname } = require("./src/helpers/tenant");

const corsDelegate = async (req, callback) => {
  const requestOrigin = req.header("Origin");
  const allowedOrigins = config.corsOrigins;
  
  let isAllowed =
    !requestOrigin ||
    allowedOrigins.includes(requestOrigin) ||
    isTrustedVercelPreviewOrigin(requestOrigin);

  if (!isAllowed && requestOrigin) {
    try {
      const client = await findClientByHostname(requestOrigin);
      if (client) {
        isAllowed = true;
      }
    } catch (error) {
      // Ignore DB errors in CORS resolution
    }
  }

  callback(null, {
    origin: isAllowed,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
};

app.set("trust proxy", 1);
app.use(cors(corsDelegate));
app.options("*", cors(corsDelegate));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(cookieParser(config.authSecret));

app.get("/", (_req, res) => {
  res.json({
    status: true,
    message: "Trainup backend is running.",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: true,
    message: "OK",
  });
});

app.use(config.apiPrefix, openRoutes);
app.use(config.apiPrefix, adminRoutes);
app.use(config.apiPrefix, superAdminRoutes);

app.use(errorHandler);

app.all("*", (_req, res) => {
  res.status(404).json({
    status: false,
    message: "API not found.",
    data: {},
  });
});

const startServer = async () => {
  await connectDatabase();
  await ensureSeedData();

  const httpServer = http.createServer(app);
  const runtime = await attachSocket(httpServer, app);
  startScheduler(runtime);

  httpServer.listen(config.port, () => {
    console.log(`Trainup backend listening on port ${config.port} (HTTP + Socket.IO + scheduler)`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start Trainup backend.", error);
  process.exit(1);
});
