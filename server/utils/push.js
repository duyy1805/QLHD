// utils/push.js
const { poolPromise } = require('../db');
const sql = require('mssql');
const axios = require('axios');

// TRẢ VỀ KẾT QUẢ => bên API approve sẽ log ra được
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
            console.log('⚠ Không có token active cho userIds:', userIds);
            return { success: false, tokens: [], message: 'No active tokens' };
        }

        const payload = {
            to: tokens,
            title,
            body,
            data,
        };

        // 📌 LUU Ý: Expo API push phải gửi **1 token / request**
        // Nên dùng Promise.all để gửi từng cái
        const responses = await Promise.all(
            tokens.map(token => axios.post('https://exp.host/--/api/v2/push/send', {
                to: token,
                title,
                body,
                data,
            }))
        );

        console.log('✔ Đã gửi push tới:', tokens);
        console.log('📬 Kết quả từ Expo:', responses.map(r => r.data));

        return { success: true, tokens, responses: responses.map(r => r.data) };
    } catch (err) {
        console.error('❌ Lỗi sendPushToUsers:', err);
        return { success: false, error: err?.message || err };
    }
}

module.exports = { sendPushToUsers };
