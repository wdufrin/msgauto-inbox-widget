"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { attachGeminiSearchRoute, getGeminiConfig } = require("./index.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT_DIR, "packages", "omnibar-wc", "dist");
const EXAMPLES_DIR = path.join(ROOT_DIR, "examples");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  loadEnvFile(path.join(__dirname, ".env"));
  loadEnvFile(path.join(ROOT_DIR, ".env"));
}

function applyCliFlags(argv = process.argv.slice(2)) {
  for (const arg of argv) {
    const [flag, ...rest] = arg.split("=");
    const val = rest.join("=").trim();
    if (!val) continue;
    if (flag === "--project" || flag === "--project-id") {
      process.env.GCP_PROJECT_ID = val;
    } else if (flag === "--location") {
      process.env.GCP_LOCATION = val;
    } else if (flag === "--engine" || flag === "--engine-id") {
      process.env.GE_ENGINE_ID = val;
    } else if (flag === "--widget-config-id" || flag === "--cid") {
      process.env.GE_WIDGET_CONFIG_ID = val;
    } else if (flag === "--port") {
      process.env.PORT = val;
    }
  }
}

applyCliFlags();

const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (attachGeminiSearchRoute(req, res, pathname)) {
    return;
  }

  if (pathname === "/" || pathname === "/index.html" || pathname === "/examples/static-intranet-demo.html") {
    serveStaticFile(res, path.join(EXAMPLES_DIR, "static-intranet-demo.html"));
    return;
  }

  if (pathname === "/gemini-omnibar.js" || pathname === "/dist/gemini-omnibar.js" || pathname === "/packages/omnibar-wc/dist/gemini-omnibar.js") {
    serveStaticFile(res, path.join(DIST_DIR, "gemini-omnibar.js"));
    return;
  }

  if (pathname === "/gemini-omnibar.js.map" || pathname === "/dist/gemini-omnibar.js.map") {
    serveStaticFile(res, path.join(DIST_DIR, "gemini-omnibar.js.map"));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    const cfg = getGeminiConfig();
    console.log(`Gemini Enterprise Omnibar Server listening on http://localhost:${PORT}`);
    console.log(`  Project: ${cfg.projectId || "(not set)"} | Location: ${cfg.location} | Engine: ${cfg.engineId || "(not set)"}`);
  });
}

module.exports = { server };
