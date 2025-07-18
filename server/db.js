const sql = require('mssql');
const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
    options: {
        encrypt: true, // Nếu sử dụng Azure, cần bật
        trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITHABORT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};


const poolPromise = sql.connect(config)
    .then(pool => {
        console.log('SQL Server TBPC is connected');
        return pool;
    })
    .catch(err => {
        console.error('Database Connection Failed! Bad Config: ', err);
        throw err;
    });

module.exports = { poolPromise };
