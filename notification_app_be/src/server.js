const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const express = require("express");
const cors = require("cors");
const { createLogger } = require("../../logging_middleware/logMiddleware");

const app = express();
const port = Number(process.env.PORT || 4000);

const externalBase = (process.env.EXTERNAL_BASE_URL || "http://20.207.122.201/evaluation-service").replace(/\/$/, "");
const notificationsUrl = `${externalBase}/notifications`;
const logsUrl = `${externalBase}/logs`;

const logger = createLogger({
  endpoint: logsUrl,
  tokenProvider: () => process.env.EXTERNAL_API_TOKEN || "",
});

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

function toBearer(token) {
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function buildExternalHeaders(req) {
  const headers = {
    Accept: "application/json",
  };

  const incomingAuth = req.headers.authorization;
  if (incomingAuth && typeof incomingAuth === "string") {
    headers.Authorization = incomingAuth;
    return headers;
  }

  const envToken = process.env.EXTERNAL_API_TOKEN;
  if (envToken && envToken.trim()) {
    headers.Authorization = toBearer(envToken.trim());
  }

  return headers;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "notification_app_be" });
});

app.get("/api/notifications", async (req, res) => {
  try {
    const response = await fetch(notificationsUrl, {
      method: "GET",
      headers: buildExternalHeaders(req),
    });

    const rawText = await response.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : [];
    } catch {
      data = rawText;
    }

    if (!response.ok) {
      await logger.Log("backend", "error", "service", `Notifications API failed status=${response.status}`);
      return res.status(response.status).json({
        error: "Failed to fetch notifications from external API",
        details: data,
      });
    }

    await logger.Log("backend", "info", "service", "Notifications fetched successfully");
    return res.json(data);
  } catch (error) {
    await logger.Log("backend", "fatal", "service", `Notifications request crashed: ${error.message}`);
    return res.status(500).json({
      error: "Backend failed while fetching notifications",
      details: error.message,
    });
  }
});

app.post("/api/logs", async (req, res) => {
  const { stack, level, package: packageName, message } = req.body || {};

  const result = await logger.Log(stack, level, packageName, message);
  if (!result.ok) {
    return res.status(result.status || 400).json({
      error: result.error || "Failed to create log",
      data: result.data,
    });
  }

  return res.status(200).json(result.data || { message: "Log created successfully" });
});

app.listen(port, () => {
  console.log(`notification_app_be listening on http://localhost:${port}`);
});
