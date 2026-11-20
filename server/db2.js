const sql = require('mssql');
const TAGconfig = {
    server: process.env.DB_SERVER2,
    database: process.env.DB_DATABASE2,
    user: process.env.DB_USER2,
    password: process.env.DB_PASSWORD2,
    port: parseInt(process.env.DB_PORT2, 10),
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS2 || 30000),
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS2 || 60000),
    options: {
        encrypt: true, // Nếu sử dụng Azure, cần bật
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

// 🔥 Tạo pool riêng biệt hoàn toàn
const tagPool = new sql.ConnectionPool(TAGconfig);
const tagpoolPromise = tagPool.connect()
    .then(pool => {
        console.log('✅ Connected to TAG DB:', process.env.DB_DATABASE2);
        return pool;
    })
    .catch(err => {
        console.error('❌ TAG DB connection failed:', err);
        throw err;
    });

module.exports = { tagpoolPromise };
