import fs from "fs";
import path from "path";
import sql from "mssql";

function loadEnvFallback() {
  if (process.env.DB_SERVER) return;
  const envPath = path.join(process.cwd(), "..", "server", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFallback();

const config: sql.config = {
  server: process.env.DB_SERVER || "",
  database: process.env.DB_DATABASE || "",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: {
    encrypt: true,
    useUTC: false,
    trustedConnection: process.env.DB_TRUSTED_CONNECTION === "true",
    enableArithAbort: process.env.DB_ENABLE_ARITHABORT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config);
  }
  return poolPromise;
}

export { sql };
