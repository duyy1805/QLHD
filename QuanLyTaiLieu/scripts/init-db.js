const fs = require("fs");
const path = require("path");
const sql = require("mssql");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function splitBatches(script) {
  return script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

loadEnv(path.join(__dirname, "..", ".env.local"));
loadEnv(path.join(__dirname, "..", "..", "server", ".env"));

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: {
    encrypt: true,
    trustedConnection: process.env.DB_TRUSTED_CONNECTION === "true",
    enableArithAbort: process.env.DB_ENABLE_ARITHABORT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
};

async function main() {
  const pool = await sql.connect(config);
  const migration = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  for (const batch of splitBatches(migration)) {
    await pool.request().batch(batch);
  }
  await pool.close();
  console.log("doc schema initialized");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
