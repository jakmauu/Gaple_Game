"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const apiBaseUrl = normalizeApiBaseUrl(
  process.env.GAPLE_API_BASE_URL || process.env.VITE_API_BASE_URL || ""
);

if (!fs.existsSync(PUBLIC_DIR)) {
  throw new Error(`Public directory not found: ${PUBLIC_DIR}`);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
copyDirectory(PUBLIC_DIR, DIST_DIR);

fs.writeFileSync(
  path.join(DIST_DIR, "config.js"),
  `window.GAPLE_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`,
  "utf8"
);

console.log(`Frontend built to ${DIST_DIR}`);
console.log(`GAPLE_API_BASE_URL=${apiBaseUrl || "(same origin)"}`);

function normalizeApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.writeFileSync(targetPath, fs.readFileSync(sourcePath));
    }
  }
}
