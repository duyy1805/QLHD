const { poolPromise } = require('../db');
const sql = require('mssql');
const { sendFCM } = require('./pushV1');

async function sendPushToUsers(userIds = [], title, body, data = {}) {
    if (!userIds.length) return { success: false, message: 'No userIds provided' };

    try {
        const pool = await poolPromise;

        const rs = await pool.request().query(`
            SELECT DISTINCT PushToken
            FROM SS_DeviceToken
            WHERE UserId IN (${userIds.join(',')})
              AND IsActive = 1
              AND PushToken IS NOT NULL
        `);

        const tokens = rs.recordset.map(r => r.PushToken).filter(Boolean);
        if (!tokens.length) {
            return { success: false, tokens: [], message: 'No active tokens' };
        }

        console.log("📌 Gửi FCM tới:", tokens);

        const results = await Promise.all(
            tokens.map(t => sendFCM(t, title, body, data))
        );

        return { success: true, tokens, results };
    } catch (err) {
        console.error("❌ FCM SEND ERROR:", err);
        return { success: false, error: err };
    }
}

module.exports = { sendPushToUsers };
