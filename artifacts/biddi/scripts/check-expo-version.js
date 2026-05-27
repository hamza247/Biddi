#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const expected = pkg.devDependencies?.["@expo/cli"];

if (!expected) {
  console.error("ERROR: @expo/cli is not listed in devDependencies in package.json");
  process.exit(1);
}

const installedPkgPath = path.join(root, "node_modules", "@expo", "cli", "package.json");
if (!fs.existsSync(installedPkgPath)) {
  console.error("ERROR: @expo/cli is not installed. Run: pnpm install");
  process.exit(1);
}

const installed = JSON.parse(fs.readFileSync(installedPkgPath, "utf-8")).version;

if (installed !== expected) {
  console.error(
    `ERROR: Installed @expo/cli version (${installed}) does not match the pinned version (${expected}).\n` +
    `Run: pnpm install\n` +
    `See artifacts/biddi/DEV_SETUP.md for upgrade instructions.`,
  );
  process.exit(1);
}

console.log(`@expo/cli version OK: ${installed}`);
