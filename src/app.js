const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { executeQuery } = require("./databricks");
const { uploadCsvToBlob, generateOnetimeUrl } = require("./blob");
const config = require("./config");

const app = express();
app.use(express.json());

const shortUrlStore = new Map();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Test Page"');
    return res.status(401).send("Authentication required");
  }
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
  const [user, pass] = decoded.split(":");
  if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) {
    return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Test Page"');
  res.status(401).send("Invalid credentials");
}

app.get("/test", basicAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

function createShortUrl(req, sasUrl, expiryMinutes) {
  const code = crypto.randomBytes(8).toString("hex");
  const expiresAt = Date.now() + expiryMinutes * 60 * 1000;
  shortUrlStore.set(code, { sasUrl, expiresAt, used: false });
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  console.log(`[ShortURL] Created: code=${code}, store size=${shortUrlStore.size}`);
  return `${baseUrl}/s/${code}`;
}

app.get("/s/:code", (req, res) => {
  const code = req.params.code;
  console.log(`[ShortURL] Access: code=${code}, store size=${shortUrlStore.size}, exists=${shortUrlStore.has(code)}`);
  const entry = shortUrlStore.get(code);
  if (!entry) {
    return res.status(404).json({ error: "URL not found" });
  }
  if (Date.now() > entry.expiresAt) {
    shortUrlStore.delete(code);
    return res.status(410).json({ error: "URL expired" });
  }
  if (entry.used) {
    shortUrlStore.delete(code);
    return res.status(410).json({ error: "URL already used (one-time)" });
  }
  entry.used = true;
  shortUrlStore.delete(code);
  res.redirect(entry.sasUrl);
});

app.post("/api/getOnetimeURL", async (req, res) => {
  const { query, id, useShortUrl } = req.body;
  const shortUrlEnabled = useShortUrl !== false;

  if (!query || !id) {
    return res.status(400).json({ error: "query and id are required" });
  }

  try {
    const csv = await executeQuery(query);
    const { location, blobPath } = await uploadCsvToBlob(id, csv);
    const sasUrl = await generateOnetimeUrl(blobPath);

    const response = { location, "sas-url": sasUrl };

    if (shortUrlEnabled) {
      response["short-url"] = createShortUrl(
        req,
        sasUrl,
        config.sas.expiryMinutes
      );
    }

    res.json(response);
  } catch (err) {
    console.error("Error processing request:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
