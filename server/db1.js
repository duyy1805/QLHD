// db_hr.js
const sql = require('mssql');

const hrConfig = {
    server: process.env.DB_SERVER1,
    database: process.env.DB_DATABASE1,
    user: process.env.DB_USER1,
    password: process.env.DB_PASSWORD1,
    port: parseInt(process.env.DB_PORT1, 10),
    options: {
        encrypt: true,
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

// 🔥 Tạo pool riêng biệt hoàn toàn
const hrPool = new sql.ConnectionPool(hrConfig);
const hrpoolPromise = hrPool.connect()
    .then(pool => {
        console.log('✅ Connected to HR DB:', process.env.DB_DATABASE1);
        return pool;
    })
    .catch(err => {
        console.error('❌ HR DB connection failed:', err);
        throw err;
    });

module.exports = { hrpoolPromise };
