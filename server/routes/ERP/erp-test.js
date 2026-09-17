const express = require('express');
const { createRouter } = require('./erp');

const testConfigured = ['DB_SERVER_TEST', 'DB_DATABASE_TEST', 'DB_USER_TEST',
    'DB_PASSWORD_TEST', 'DB_PORT_TEST'].every((name) => Boolean(process.env[name]));
const sameDatabase =
    String(process.env.DB_SERVER_TEST || '').toLowerCase() === String(process.env.DB_SERVER2 || '').toLowerCase() &&
    Number(process.env.DB_PORT_TEST) === Number(process.env.DB_PORT2) &&
    String(process.env.DB_DATABASE_TEST || '').toLowerCase() === String(process.env.DB_DATABASE2 || '').toLowerCase();

if (!testConfigured || sameDatabase) {
    const router = express.Router();
    router.use((_req, res) => res.status(503).json({
        ok: false,
        message: 'DB test chưa được cấu hình riêng với DB chính'
    }));
    module.exports = router;
} else {
    const { testpoolPromise } = require('../../dbtest');
    module.exports = createRouter(testpoolPromise);
}
