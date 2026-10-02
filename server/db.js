const sql = require('mssql');
const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 30000),
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 30000),
    options: {
        encrypt: true, // Nếu sử dụng Azure, cần bật
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

const retryCount = Math.max(1, Number(process.env.DB_CONNECT_RETRY_COUNT || 5));
const retryDelayMs = Math.max(0, Number(process.env.DB_CONNECT_RETRY_DELAY_MS || 3000));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connectWithRetry() {
    let lastError;
    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
        const pool = new sql.ConnectionPool(config);
        try {
            const connectedPool = await pool.connect();
            console.log(`SQL Server TBPC is connected (attempt ${attempt}/${retryCount})`);
            return connectedPool;
        } catch (error) {
            lastError = error;
            try { await pool.close(); } catch { /* Pool chưa mở hoàn chỉnh. */ }

            if (attempt === retryCount) break;
            console.warn(
                `SQL Server connection attempt ${attempt}/${retryCount} failed (${error.code || error.message}). ` +
                `Retrying in ${retryDelayMs}ms...`
            );
            await wait(retryDelayMs);
        }
    }

    console.error(`Database connection failed after ${retryCount} attempts.`, lastError);
    throw lastError;
}

const poolPromise = connectWithRetry();

module.exports = { poolPromise };
