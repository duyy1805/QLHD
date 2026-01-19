const sql = require('mssql');
const TAGconfig = {
    server: process.env.DB_SERVER_PLP,
    database: process.env.DB_DATABASE_PLP,
    user: process.env.DB_USER_PLP,
    password: process.env.DB_PASSWORD_PLP,
    port: parseInt(process.env.DB_PORT_PLP, 10),
    options: {
        encrypt: true, // Nếu sử dụng Azure, cần bật
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

// 🔥 Tạo pool riêng biệt hoàn toàn
const tagPool_PLP = new sql.ConnectionPool(TAGconfig);
const tagpoolPromise_PLP = tagPool_PLP.connect()
    .then(pool => {
        console.log('✅ Connected to TAG DB:', process.env.DB_DATABASE_PLP);
        return pool;
    })
    .catch(err => {
        console.error('❌ TAG DB connection failed:', err);
        throw err;
    });

module.exports = { tagpoolPromise_PLP };
