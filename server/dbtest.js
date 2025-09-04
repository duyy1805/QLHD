const sql = require('mssql');
const Testconfig = {
    server: process.env.DB_SERVER_TEST,
    database: process.env.DB_DATABASE_TEST,
    user: process.env.DB_USER_TEST,
    password: process.env.DB_PASSWORD_TEST,
    port: parseInt(process.env.DB_PORT_TEST, 10),
    options: {
        encrypt: true, // Nếu sử dụng Azure, cần bật
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

// 🔥 Tạo pool riêng biệt hoàn toàn
const testPool = new sql.ConnectionPool(Testconfig);
const testpoolPromise = testPool.connect()
    .then(pool => {
        console.log('✅ Connected to Test DB:', process.env.DB_DATABASE_TEST);
        return pool;
    })
    .catch(err => {
        console.error('❌ Test DB connection failed:', err);
        throw err;
    });

module.exports = { testpoolPromise };
