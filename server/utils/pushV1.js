require("dotenv").config();
const { GoogleAuth } = require("google-auth-library");
const fetch = require("node-fetch"); // ⭐ Quan trọng! Node cần import fetch

async function sendFCM(deviceToken, title, body, data = {}) {
    try {
        // 1. Tạo Google Auth Client
        const auth = new GoogleAuth({
            credentials: {
                client_email: process.env.FCM_CLIENT_EMAIL,
                private_key: process.env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n"),
            },
            scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
        });

        // 2. Lấy access token
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        // 3. Cấu trúc payload FCM
        const message = {
            message: {
                token: deviceToken,
                notification: {
                    title,
                    body,
                },
                data: Object.fromEntries(
                    Object.entries(data).map(([k, v]) => [k, String(v)]) // ⭐ Convert tất cả về string
                ),
                android: {
                    priority: "high",
                }
            }
        };

        // 4. Gửi request
        const url = `https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken.token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
        });

        console.log("📨 FCM RESPONSE STATUS:", response.status);

        const text = await response.text();
        console.log("📩 FCM RESPONSE RAW:", text);

        // Convert JSON nếu có
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }

    } catch (err) {
        console.error("❌ FCM SEND ERROR:", err);
        return { error: err.message };
    }
}

module.exports = { sendFCM };
