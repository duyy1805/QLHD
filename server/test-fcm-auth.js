require("dotenv").config();
const { GoogleAuth } = require("google-auth-library");
const fetch = require("node-fetch"); // ← thêm dòng này

async function testSendFCM() {
    try {
        const projectId = process.env.FCM_PROJECT_ID;
        const clientEmail = process.env.FCM_CLIENT_EMAIL;
        const privateKey = process.env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n");

        console.log("🔧 PROJECT ID:", projectId);
        console.log("🔧 CLIENT EMAIL:", clientEmail);

        const auth = new GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
        });

        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        console.log("🔑 ACCESS TOKEN:", accessToken.token.substring(0, 40));

        const deviceToken = "ch8fvHWRTfK4TEo6iCnBOm:APA91bHOtqqmUHg85Q5mXogFtFkRV4RhsyQMz3rhbjfT4Qr-EFEpftrIUfk3j4ZWH2T1G3WaDDIjhIr2s-qx74RmIoVsrdIybPf0qX2DKCCtbELOk4QePQM";

        const message = {
            message: {
                token: deviceToken,
                notification: {
                    title: "Test FCM",
                    body: "This is test message through HTTP v1 API",
                },
                data: {
                    testKey: "hello123",
                },
            },
        };

        const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken.token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
        });

        console.log("📨 FCM RESPONSE STATUS:", response.status);

        const raw = await response.text();
        console.log("📩 RAW RESPONSE:", raw);

    } catch (err) {
        console.error("❌ TEST ERROR:", err);
    }
}

testSendFCM();
