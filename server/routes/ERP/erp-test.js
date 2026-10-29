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
    const checkApiKey = require('../../middleware/apiKey');
    const { createCraneDemoCallback, createCraneDemoLocationCallback } = require('./crane-demo-callback');
    const outboundRequest = require('../../utils/wmsOutboundRequest');
    const router = express.Router();
    router.post('/wms/outbound-callback', checkApiKey, async (req, res, next) => {
        if (req.body?.sourceType !== outboundRequest.SOURCE_TYPE &&
            !/^YCX-\d{8}-\d{6}$/.test(String(req.body?.orderCode || ''))) return next();
        try { return res.json(await outboundRequest.confirm(await testpoolPromise, req.body)); }
        catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
    });
    router.post('/wms/outbound-callback', checkApiKey, createCraneDemoCallback(testpoolPromise));
    router.post('/wms/location-callback', checkApiKey, createCraneDemoLocationCallback(testpoolPromise));
    router.use(createRouter(testpoolPromise, { isTest: true }));
    module.exports = router;
}
