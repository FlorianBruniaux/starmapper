#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function readUrl() {
  if (process.env.DATABASE_URL_READONLY) return process.env.DATABASE_URL_READONLY;

  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const envPath = path.join(projectDir, file);
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL_READONLY\s*=\s*(.+)/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const url = readUrl();
if (!url) {
  console.error("ERROR: DATABASE_URL not found in .env.local or .env");
  process.exit(1);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, ["-y", "@modelcontextprotocol/server-postgres", url], {
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 0));
