const crypto = require('crypto');
const axios = require('axios');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const TELEGRAM_LINK_TTL_SECONDS = 5 * 60;
const TRUSTED_DEVICE_SECONDS = 7 * 24 * 60 * 60;
const TRUSTED_COOKIE = 'z76_trusted_device';

function getPool() {
    return require('../db').poolPromise;
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function legacyMd5Password(value) {
    const text = String(value || '');
    const asciiBytes = Buffer.alloc(text.length);
    for (let index = 0; index < text.length; index += 1) {
        const codeUnit = text.charCodeAt(index);
        asciiBytes[index] = codeUnit <= 0x7f ? codeUnit : 0x3f;
    }
    return crypto.createHash('md5').update(asciiBytes).digest('hex');
}

function maskEmail(value) {
    const [local, domain] = String(value || '').split('@');
    if (!local || !domain) return '***';
    const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function requiredSecret(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function encryptionKey() {
    const raw = requiredSecret('OTP_ENCRYPTION_KEY').trim();
    const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('OTP_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex characters');
    return key;
}

function hmac(value) {
    return crypto.createHmac('sha256', requiredSecret('OTP_HASH_SECRET')).update(String(value)).digest('hex');
}

function otpHash(challengeId, otp) {
    return hmac(`${challengeId}:${otp}`);
}

function safeEqualHex(left, right) {
    if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function encryptJson(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptJson(value) {
    const packed = Buffer.from(value, 'base64');
    if (packed.length < 29) throw new Error('Invalid encrypted payload');
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
}

function parseCookies(header) {
    return String(header || '').split(';').reduce((result, part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return result;
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (key) result[key] = decodeURIComponent(value);
        return result;
    }, {});
}

function trustedCookie(token, maxAge = TRUSTED_DEVICE_SECONDS) {
    const secure = process.env.COOKIE_SECURE !== 'false';
    return [
        `${TRUSTED_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/auth',
        `Max-Age=${maxAge}`,
        'HttpOnly',
        secure ? 'Secure' : null,
        secure ? 'SameSite=None' : 'SameSite=Lax',
    ].filter(Boolean).join('; ');
}

function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

function authLog(level, event, details = {}) {
    const entry = { time: new Date().toISOString(), scope: 'erp-otp-auth', event, ...details };
    const writer = console[level] || console.log;
    writer(`[AUTH] ${JSON.stringify(entry)}`);
}

function safeErrorDetails(error) {
    const upstreamMessage = error?.response?.data?.message;
    return {
        errorName: error?.name,
        errorCode: error?.code,
        errorMessage: error?.message,
        upstreamStatus: error?.response?.status,
        upstreamMessage: typeof upstreamMessage === 'string' ? upstreamMessage.slice(0, 300) : undefined,
    };
}

function genericLoginError(res, status = 401, requestId) {
    return res.status(status).json({
        message: 'Tên đăng nhập, mật khẩu hoặc bước xác minh không hợp lệ.',
        requestId,
    });
}

async function sendOtpEmail(to, otp) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Configured OTP email is invalid');
    const sender = requiredSecret('GMAIL_SENDER');
    const oauth = new OAuth2Client(
        requiredSecret('GMAIL_CLIENT_ID'),
        requiredSecret('GMAIL_CLIENT_SECRET')
    );
    oauth.setCredentials({ refresh_token: requiredSecret('GMAIL_REFRESH_TOKEN') });
    const accessTokenResult = await oauth.getAccessToken();
    const accessToken = typeof accessTokenResult === 'string' ? accessTokenResult : accessTokenResult?.token;
    if (!accessToken) throw new Error('Unable to obtain Gmail access token');

    const subject = 'Mã OTP đăng nhập Z76 thanhtoan';
    const body = [
        'Mã OTP đăng nhập của bạn là:',
        '',
        otp,
        '',
        'Mã có hiệu lực trong 5 phút và chỉ được sử dụng một lần.',
        'Nếu bạn không thực hiện đăng nhập, hãy bỏ qua email này.',
    ].join('\r\n');
    const message = [
        `From: Z76 ThanhToan <${sender}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(body).toString('base64'),
    ].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');

    await axios.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { raw },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
}

async function sendTelegramMessage(chatId, text, replyMarkup = undefined) {
    const token = requiredSecret('TELEGRAM_BOT_TOKEN');
    await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
            chat_id: String(chatId),
            text,
            disable_web_page_preview: true,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
        { timeout: 10000 }
    );
}

function normalizePhoneNumber(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0084')) digits = digits.slice(2);
    if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
    return digits;
}

async function sendOtpTelegram(chatId, otp) {
    await sendTelegramMessage(chatId, [
        'Mã OTP đăng nhập Z76 của bạn:',
        '',
        otp,
        '',
        'Mã có hiệu lực trong 5 phút và chỉ dùng một lần.',
        'Không chia sẻ mã này cho bất kỳ ai.',
    ].join('\n'));
}

function telegramLabel(account) {
    if (account?.TelegramUsername) return `@${account.TelegramUsername}`;
    return account?.TelegramDisplayName || 'tài khoản Telegram đã liên kết';
}

async function findOtpAccount(pool, userId, normalizedUsername) {
    const result = await pool.request()
        .input('UserId', sql.NVarChar(128), userId ? String(userId) : null)
        .input('NormalizedUsername', sql.NVarChar(255), normalizedUsername)
        .query(`
            SELECT TOP (1)
                UserId = CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap),
                Username = tk.TenDangNhap,
                OtpChannel = COALESCE(NULLIF(otp.OtpChannel, N''), N'Email'),
                OtpEmail = COALESCE(NULLIF(LTRIM(RTRIM(otp.OtpEmail)), N''), NULLIF(LTRIM(RTRIM(tk.Email)), N'')),
                PhoneNumber = NULLIF(LTRIM(RTRIM(otp.TelegramPhoneNumber)), N'')
            FROM dbo.AuthOtpAccount otp
            INNER JOIN TAG_System.dbo.TaiKhoanDangNhap tk
                ON (TRY_CONVERT(SMALLINT, otp.UserId) = tk.ID_TaiKhoanDangNhap)
                OR (otp.NormalizedUsername = LOWER(LTRIM(RTRIM(tk.TenDangNhap))))
            WHERE otp.OtpEnabled = 1 AND tk.SuDung = 1 AND tk.TonTai = 1
              AND ((@UserId IS NOT NULL AND CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap) = @UserId)
                   OR LOWER(LTRIM(RTRIM(tk.TenDangNhap))) = @NormalizedUsername)
            ORDER BY CASE WHEN @UserId IS NOT NULL AND CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap) = @UserId THEN 0 ELSE 1 END
        `);
    return result.recordset[0] || null;
}

async function findTelegramAccount(pool, userId) {
    const result = await pool.request()
        .input('UserId', sql.NVarChar(128), String(userId))
        .query(`
            SELECT TOP (1) TelegramUserId, ChatId,
                TelegramUsername, DisplayName AS TelegramDisplayName, PhoneNumberSnapshot, LinkedAt
            FROM dbo.AuthTelegramAccount
            WHERE UserId = @UserId AND RevokedAt IS NULL
            ORDER BY LinkedAt DESC
        `);
    return result.recordset[0] || null;
}

async function createTelegramSetup(pool, userId) {
    const botUsername = requiredSecret('TELEGRAM_BOT_USERNAME').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{5,}$/.test(botUsername)) throw new Error('TELEGRAM_BOT_USERNAME is invalid');
    const linkId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('base64url');
    await pool.request()
        .input('LinkId', sql.UniqueIdentifier, linkId)
        .input('UserId', sql.NVarChar(128), String(userId))
        .input('TokenHash', sql.Char(64), hmac(`telegram-link:${token}`))
        .query(`
            UPDATE dbo.AuthTelegramLinkToken
            SET ConsumedAt = COALESCE(ConsumedAt, SYSUTCDATETIME())
            WHERE UserId = @UserId AND ConsumedAt IS NULL;
            DELETE FROM dbo.AuthTelegramLinkToken WHERE ExpiresAt < DATEADD(DAY, -1, SYSUTCDATETIME());
            INSERT dbo.AuthTelegramLinkToken (LinkId, UserId, TokenHash, ExpiresAt, ConsumedAt, CreatedAt)
            VALUES (@LinkId, @UserId, @TokenHash,
                    DATEADD(SECOND, ${TELEGRAM_LINK_TTL_SECONDS}, SYSUTCDATETIME()), NULL, SYSUTCDATETIME());
        `);
    return {
        linkId,
        botUsername,
        deepLink: `https://t.me/${botUsername}?start=${token}`,
        expiresIn: TELEGRAM_LINK_TTL_SECONDS,
        pollAfter: 2,
    };
}

async function isTrustedDevice(pool, req, userId, logContext = {}) {
    const token = parseCookies(req.headers.cookie)[TRUSTED_COOKIE];
    if (!token) {
        authLog('info', 'trusted_device_rejected', { ...logContext, userId: String(userId), reason: 'cookie_missing' });
        return false;
    }

    const lookup = await pool.request()
        .input('UserId', sql.NVarChar(128), String(userId))
        .input('TokenHash', sql.Char(64), hmac(`trusted:${token}`))
        .query(`
            SELECT TOP (1) Id, ExpiresAt, RevokedAt
            FROM dbo.AuthTrustedDevice
            WHERE UserId = @UserId AND TokenHash = @TokenHash
        `);
    const device = lookup.recordset[0];
    if (!device) {
        authLog('info', 'trusted_device_rejected', { ...logContext, userId: String(userId), reason: 'token_not_found' });
        return false;
    }
    if (device.RevokedAt) {
        authLog('info', 'trusted_device_rejected', { ...logContext, userId: String(userId), reason: 'revoked' });
        return false;
    }
    if (new Date(device.ExpiresAt).getTime() <= Date.now()) {
        authLog('info', 'trusted_device_rejected', { ...logContext, userId: String(userId), reason: 'expired' });
        return false;
    }

    const result = await pool.request()
        .input('Id', sql.UniqueIdentifier, device.Id)
        .query(`
            UPDATE dbo.AuthTrustedDevice
            SET LastUsedAt = SYSUTCDATETIME()
            OUTPUT inserted.Id
            WHERE Id = @Id AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
        `);
    if (!result.recordset.length) {
        authLog('info', 'trusted_device_rejected', { ...logContext, userId: String(userId), reason: 'no_longer_valid' });
    }
    return result.recordset.length > 0;
}

async function erpOtpLogin(req, res) {
    const requestId = crypto.randomUUID();
    res.setHeader('X-Auth-Request-Id', requestId);
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const logContext = { requestId, username: normalizeUsername(username), ipAddress: clientIp(req) };
    authLog('info', 'login_started', {
        ...logContext,
        hasUsername: Boolean(username),
        hasPassword: Boolean(password),
        authSource: 'TAG_System.dbo.TaiKhoanDangNhap',
    });
    if (!username || !password) {
        authLog('warn', 'login_missing_credentials', logContext);
        return genericLoginError(res, 400, requestId);
    }

    let pool;
    let loginData;
    try {
        pool = await getPool();
        authLog('info', 'database_connected', logContext);

        const rateResult = await pool.request()
            .input('NormalizedUsername', sql.NVarChar(255), normalizeUsername(username))
            .input('IpAddress', sql.NVarChar(64), clientIp(req))
            .query(`
                SELECT
                    SUM(CASE WHEN NormalizedUsername = @NormalizedUsername AND WasSuccessful = 0 THEN 1 ELSE 0 END) AS UsernameFailures,
                    SUM(CASE WHEN IpAddress = @IpAddress AND WasSuccessful = 0 THEN 1 ELSE 0 END) AS IpFailures
                FROM dbo.AuthLoginAttempt
                WHERE CreatedAt >= DATEADD(MINUTE, -10, SYSUTCDATETIME())
                  AND (NormalizedUsername = @NormalizedUsername OR IpAddress = @IpAddress)
            `);
        const loginRate = rateResult.recordset[0] || {};
        if (Number(loginRate.UsernameFailures || 0) >= 10 || Number(loginRate.IpFailures || 0) >= 50) {
            authLog('warn', 'direct_login_rate_limited', { ...logContext, ...loginRate });
            return res.status(429).json({ message: 'Có quá nhiều lần đăng nhập không thành công. Vui lòng thử lại sau.', requestId });
        }

        const accountResult = await pool.request()
            .input('Username', sql.NVarChar(50), username)
            .input('PasswordMd5', sql.NVarChar(32), legacyMd5Password(password))
            .query(`
                SELECT TOP (1)
                    id = tk.ID_TaiKhoanDangNhap,
                    userId = tk.ID_TaiKhoanDangNhap,
                    username = tk.TenDangNhap,
                    fullName = COALESCE(NULLIF(tk.TenDayDu, N''), tk.TenDangNhap),
                    idDonVi = tk.ID_DonVi,
                    idBoPhan = tk.ID_BoPhan,
                    tenBoPhan = bp.Ten_BoPhan,
                    idChucVu = tk.ID_ChucVu,
                    idNhanSu = tk.ID_NhanSu,
                    email = tk.Email
                FROM TAG_System.dbo.TaiKhoanDangNhap tk
                LEFT JOIN TAG_System.dbo.DM_BoPhan bp ON bp.ID_BoPhan = tk.ID_BoPhan
                WHERE tk.TenDangNhap = @Username
                  AND LOWER(tk.MatKhau) = @PasswordMd5
                  AND tk.SuDung = 1 AND tk.TonTai = 1
            `);
        const userInfo = accountResult.recordset[0];
        await pool.request()
            .input('NormalizedUsername', sql.NVarChar(255), normalizeUsername(username))
            .input('IpAddress', sql.NVarChar(64), clientIp(req))
            .input('WasSuccessful', sql.Bit, Boolean(userInfo))
            .query(`
                INSERT dbo.AuthLoginAttempt (NormalizedUsername, IpAddress, WasSuccessful, CreatedAt)
                VALUES (@NormalizedUsername, @IpAddress, @WasSuccessful, SYSUTCDATETIME());
                DELETE FROM dbo.AuthLoginAttempt WHERE CreatedAt < DATEADD(DAY, -7, SYSUTCDATETIME());
            `);

        if (!userInfo) {
            authLog('warn', 'direct_login_rejected', logContext);
            return genericLoginError(res, 401, requestId);
        }

        const accessToken = jwt.sign(
            { userId: userInfo.id, username: userInfo.username },
            requiredSecret('ACCESS_TOKEN_SECRET'),
            { expiresIn: process.env.AUTH_TOKEN_TTL || '8h' }
        );
        loginData = { accessToken, userInfo };
        authLog('info', 'direct_login_accepted', {
            ...logContext,
            userId: userInfo.id,
        });
    } catch (error) {
        authLog('error', 'direct_login_failed', { ...logContext, ...safeErrorDetails(error) });
        return res.status(500).json({ message: 'Không thể xử lý đăng nhập.', requestId });
    }

    const accessToken = loginData?.accessToken;
    const userInfo = loginData?.userInfo || { username };
    const userId = userInfo?.id ?? userInfo?.userId;
    if (!accessToken) {
        authLog('error', 'direct_login_missing_access_token', { ...logContext });
        return genericLoginError(res, 401, requestId);
    }

    try {
        const account = await findOtpAccount(pool, userId, normalizeUsername(username));
        if (!account) {
            authLog('info', 'otp_not_required', { ...logContext, userId });
            return res.json({ ...loginData, status: 'authenticated', requestId });
        }

        const effectiveUserId = String(account.UserId);
        const deliveryChannel = String(account.OtpChannel || 'Email');
        authLog('info', 'otp_account_found', {
            ...logContext,
            userId: effectiveUserId,
            deliveryChannel,
            hasOtpEmail: Boolean(account.OtpEmail),
            maskedEmail: account.OtpEmail ? maskEmail(account.OtpEmail) : undefined,
        });
        let telegramAccount = null;
        if (deliveryChannel === 'Telegram') {
            if (!normalizePhoneNumber(account.PhoneNumber)) {
                authLog('error', 'telegram_phone_missing', { ...logContext, userId: effectiveUserId });
                return res.status(503).json({
                    message: 'Tài khoản chưa được cấu hình số điện thoại Telegram. Vui lòng liên hệ quản trị viên.',
                    requestId,
                });
            }
            telegramAccount = await findTelegramAccount(pool, effectiveUserId);
            if (telegramAccount && normalizePhoneNumber(telegramAccount.PhoneNumberSnapshot) !== normalizePhoneNumber(account.PhoneNumber)) {
                authLog('warn', 'telegram_phone_reverification_required', { ...logContext, userId: effectiveUserId });
                telegramAccount = null;
            }
            if (!telegramAccount) {
                const setup = await createTelegramSetup(pool, effectiveUserId);
                authLog('info', 'telegram_setup_created', { ...logContext, userId: effectiveUserId, linkId: setup.linkId });
                return res.json({ status: 'telegram_setup_required', ...setup, requestId });
            }
        } else if (!account.OtpEmail) {
            authLog('error', 'otp_email_missing', { ...logContext, userId: effectiveUserId });
            return res.status(503).json({ message: 'Tài khoản chưa được cấu hình email nhận OTP.', requestId });
        }
        if (deliveryChannel !== 'Telegram' && await isTrustedDevice(pool, req, effectiveUserId, logContext)) {
            authLog('info', 'trusted_device_accepted', { ...logContext, userId: effectiveUserId });
            return res.json({ ...loginData, status: 'authenticated', requestId });
        }

        const rateResult = await pool.request()
            .input('NormalizedUsername', sql.NVarChar(255), normalizeUsername(username))
            .input('IpAddress', sql.NVarChar(64), clientIp(req))
            .query(`
                SELECT
                    SUM(CASE WHEN NormalizedUsername = @NormalizedUsername THEN 1 ELSE 0 END) AS UsernameCount,
                    SUM(CASE WHEN IpAddress = @IpAddress THEN 1 ELSE 0 END) AS IpCount
                FROM dbo.AuthOtpChallenge
                WHERE CreatedAt >= DATEADD(MINUTE, -10, SYSUTCDATETIME())
                  AND (NormalizedUsername = @NormalizedUsername OR IpAddress = @IpAddress)
            `);
        const rate = rateResult.recordset[0] || {};
        if (Number(rate.UsernameCount || 0) >= 5 || Number(rate.IpCount || 0) >= 30) {
            authLog('warn', 'otp_rate_limited', { ...logContext, ...rate });
            return res.status(429).json({ message: 'Có quá nhiều yêu cầu xác minh. Vui lòng thử lại sau.', requestId });
        }

        const challengeId = crypto.randomUUID();
        const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
        await pool.request()
            .input('ChallengeId', sql.UniqueIdentifier, challengeId)
            .input('UserId', sql.NVarChar(128), effectiveUserId)
            .input('NormalizedUsername', sql.NVarChar(255), normalizeUsername(username))
            .input('OtpEmail', sql.NVarChar(320), deliveryChannel === 'Email' ? account.OtpEmail : null)
            .input('DeliveryChannel', sql.NVarChar(20), deliveryChannel)
            .input('TelegramChatId', sql.BigInt, telegramAccount?.ChatId || null)
            .input('OtpHash', sql.Char(64), otpHash(challengeId, otp))
            .input('EncryptedLoginPayload', sql.NVarChar(sql.MAX), encryptJson(loginData))
            .input('IpAddress', sql.NVarChar(64), clientIp(req))
            .input('UserAgent', sql.NVarChar(512), String(req.headers['user-agent'] || '').slice(0, 512))
            .query(`
                DELETE FROM dbo.AuthOtpChallenge WHERE ExpiresAt < DATEADD(DAY, -1, SYSUTCDATETIME());
                INSERT dbo.AuthOtpChallenge
                    (ChallengeId, UserId, NormalizedUsername, OtpEmail, OtpHash, EncryptedLoginPayload,
                     ExpiresAt, LastSentAt, Attempts, ConsumedAt, IpAddress, UserAgent, CreatedAt,
                     DeliveryChannel, TelegramChatId)
                VALUES
                    (@ChallengeId, @UserId, @NormalizedUsername, @OtpEmail, @OtpHash, @EncryptedLoginPayload,
                     DATEADD(SECOND, ${OTP_TTL_SECONDS}, SYSUTCDATETIME()), SYSUTCDATETIME(), 0, NULL,
                     @IpAddress, @UserAgent, SYSUTCDATETIME(), @DeliveryChannel, @TelegramChatId)
            `);
        authLog('info', 'otp_challenge_created', { ...logContext, challengeId, userId: effectiveUserId });

        try {
            if (deliveryChannel === 'Telegram') await sendOtpTelegram(telegramAccount.ChatId, otp);
            else await sendOtpEmail(account.OtpEmail, otp);
            authLog('info', 'otp_sent', {
                ...logContext,
                challengeId,
                userId: effectiveUserId,
                deliveryChannel,
                maskedEmail: maskEmail(account.OtpEmail),
            });
        } catch (error) {
            await pool.request().input('ChallengeId', sql.UniqueIdentifier, challengeId)
                .query('DELETE FROM dbo.AuthOtpChallenge WHERE ChallengeId = @ChallengeId');
            authLog('error', 'otp_delivery_failed', { ...logContext, challengeId, deliveryChannel, ...safeErrorDetails(error) });
            return res.status(503).json({ message: 'Chưa thể gửi mã xác minh. Vui lòng thử lại sau.', requestId });
        }

        return res.json({
            status: 'otp_required',
            challengeId,
            deliveryChannel: deliveryChannel.toLowerCase(),
            maskedEmail: deliveryChannel === 'Email' ? maskEmail(account.OtpEmail) : undefined,
            maskedTelegram: deliveryChannel === 'Telegram' ? telegramLabel(telegramAccount) : undefined,
            expiresIn: OTP_TTL_SECONDS,
            resendAfter: OTP_RESEND_SECONDS,
            requestId,
        });
    } catch (error) {
        authLog('error', 'otp_login_failed', { ...logContext, ...safeErrorDetails(error) });
        return res.status(500).json({ message: 'Không thể xử lý đăng nhập an toàn.', requestId });
    }
}

async function verifyOtp(req, res) {
    const challengeId = String(req.body?.challengeId || '');
    const otp = String(req.body?.otp || '');
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: 'Mã OTP không hợp lệ.' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ChallengeId', sql.UniqueIdentifier, challengeId)
            .query(`
                SELECT TOP (1) c.ChallengeId, c.UserId, c.OtpHash, c.EncryptedLoginPayload,
                    c.Attempts, c.ExpiresAt, c.ConsumedAt, c.DeliveryChannel
                FROM dbo.AuthOtpChallenge c
                WHERE c.ChallengeId = @ChallengeId
                  AND EXISTS (
                      SELECT 1
                      FROM dbo.AuthOtpAccount a
                      INNER JOIN TAG_System.dbo.TaiKhoanDangNhap tk
                          ON (TRY_CONVERT(SMALLINT, a.UserId) = tk.ID_TaiKhoanDangNhap)
                          OR (a.NormalizedUsername = LOWER(LTRIM(RTRIM(tk.TenDangNhap))))
                      WHERE a.OtpEnabled = 1 AND tk.SuDung = 1 AND tk.TonTai = 1
                        AND CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap) = c.UserId
                  )
            `);
        const challenge = result.recordset[0];
        if (!challenge || challenge.ConsumedAt || new Date(challenge.ExpiresAt) <= new Date()) {
            return res.status(400).json({ message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' });
        }
        if (challenge.Attempts >= OTP_MAX_ATTEMPTS) {
            return res.status(429).json({ message: 'Đã vượt quá số lần nhập OTP. Vui lòng đăng nhập lại.' });
        }
        if (!safeEqualHex(challenge.OtpHash, otpHash(challengeId, otp))) {
            await pool.request().input('ChallengeId', sql.UniqueIdentifier, challengeId)
                .query('UPDATE dbo.AuthOtpChallenge SET Attempts = Attempts + 1 WHERE ChallengeId = @ChallengeId');
            return res.status(400).json({ message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' });
        }

        const consumed = await pool.request()
            .input('ChallengeId', sql.UniqueIdentifier, challengeId)
            .query(`
                UPDATE dbo.AuthOtpChallenge SET ConsumedAt = SYSUTCDATETIME()
                OUTPUT inserted.ChallengeId
                WHERE ChallengeId = @ChallengeId AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
            `);
        if (!consumed.recordset.length) return res.status(409).json({ message: 'Mã OTP đã được sử dụng.' });

        if (challenge.DeliveryChannel !== 'Telegram' && req.body?.trustDevice === true) {
            const rawToken = crypto.randomBytes(32).toString('base64url');
            await pool.request()
                .input('Id', sql.UniqueIdentifier, crypto.randomUUID())
                .input('UserId', sql.NVarChar(128), challenge.UserId)
                .input('TokenHash', sql.Char(64), hmac(`trusted:${rawToken}`))
                .input('UserAgent', sql.NVarChar(512), String(req.headers['user-agent'] || '').slice(0, 512))
                .query(`
                    DELETE FROM dbo.AuthTrustedDevice WHERE ExpiresAt < SYSUTCDATETIME() OR RevokedAt IS NOT NULL;
                    INSERT dbo.AuthTrustedDevice
                        (Id, UserId, TokenHash, UserAgent, CreatedAt, LastUsedAt, ExpiresAt, RevokedAt)
                    VALUES
                        (@Id, @UserId, @TokenHash, @UserAgent, SYSUTCDATETIME(), SYSUTCDATETIME(),
                         DATEADD(SECOND, ${TRUSTED_DEVICE_SECONDS}, SYSUTCDATETIME()), NULL)
                `);
            res.setHeader('Set-Cookie', trustedCookie(rawToken));
            authLog('info', 'trusted_device_issued', {
                challengeId,
                userId: String(challenge.UserId),
                expiresIn: TRUSTED_DEVICE_SECONDS,
            });
        }

        return res.json({ ...decryptJson(challenge.EncryptedLoginPayload), status: 'authenticated' });
    } catch (error) {
        console.error('OTP verification failed:', error.code || error.message);
        return res.status(500).json({ message: 'Không thể xác minh OTP.' });
    }
}

async function resendOtp(req, res) {
    const challengeId = String(req.body?.challengeId || '');
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return res.status(400).json({ message: 'Yêu cầu xác minh không hợp lệ.' });

    try {
        const pool = await getPool();
        const result = await pool.request().input('ChallengeId', sql.UniqueIdentifier, challengeId).query(`
            SELECT TOP (1) OtpEmail, DeliveryChannel, TelegramChatId, LastSentAt, ConsumedAt
            FROM dbo.AuthOtpChallenge WHERE ChallengeId = @ChallengeId
        `);
        const challenge = result.recordset[0];
        if (!challenge || challenge.ConsumedAt) return res.status(400).json({ message: 'Yêu cầu xác minh không hợp lệ.' });
        const elapsed = Math.floor((Date.now() - new Date(challenge.LastSentAt).getTime()) / 1000);
        if (elapsed < OTP_RESEND_SECONDS) {
            return res.status(429).json({
                message: 'Vui lòng chờ trước khi gửi lại mã.',
                resendAfter: OTP_RESEND_SECONDS - Math.max(0, elapsed),
            });
        }

        const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
        await pool.request()
            .input('ChallengeId', sql.UniqueIdentifier, challengeId)
            .input('OtpHash', sql.Char(64), otpHash(challengeId, otp))
            .query(`
                UPDATE dbo.AuthOtpChallenge
                SET OtpHash = @OtpHash, ExpiresAt = DATEADD(SECOND, ${OTP_TTL_SECONDS}, SYSUTCDATETIME()),
                    LastSentAt = SYSUTCDATETIME(), Attempts = 0
                WHERE ChallengeId = @ChallengeId AND ConsumedAt IS NULL
            `);
        if (challenge.DeliveryChannel === 'Telegram') {
            await sendOtpTelegram(challenge.TelegramChatId, otp);
        } else {
            await sendOtpEmail(challenge.OtpEmail, otp);
        }
        return res.json({
            status: 'otp_required',
            challengeId,
            deliveryChannel: String(challenge.DeliveryChannel || 'Email').toLowerCase(),
            maskedEmail: challenge.DeliveryChannel === 'Telegram' ? undefined : maskEmail(challenge.OtpEmail),
            maskedTelegram: challenge.DeliveryChannel === 'Telegram' ? 'tài khoản Telegram đã liên kết' : undefined,
            expiresIn: OTP_TTL_SECONDS,
            resendAfter: OTP_RESEND_SECONDS,
        });
    } catch (error) {
        console.error('OTP resend failed:', error.code || error.message);
        return res.status(503).json({ message: 'Chưa thể gửi lại mã OTP.' });
    }
}

async function logoutTrustedDevice(req, res) {
    const token = parseCookies(req.headers.cookie)[TRUSTED_COOKIE];
    try {
        if (token) {
            const pool = await getPool();
            await pool.request().input('TokenHash', sql.Char(64), hmac(`trusted:${token}`))
                .query('UPDATE dbo.AuthTrustedDevice SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @TokenHash AND RevokedAt IS NULL');
        }
        res.setHeader('Set-Cookie', trustedCookie('', 0));
        return res.json({ success: true });
    } catch (error) {
        console.error('Trusted-device logout failed:', error.code || error.message);
        res.setHeader('Set-Cookie', trustedCookie('', 0));
        return res.status(500).json({ success: false });
    }
}

async function telegramSetupStatus(req, res) {
    const linkId = String(req.body?.linkId || '');
    if (!/^[0-9a-f-]{36}$/i.test(linkId)) return res.status(400).json({ message: 'Yêu cầu liên kết không hợp lệ.' });
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('LinkId', sql.UniqueIdentifier, linkId)
            .query(`
                SELECT TOP (1) t.UserId, t.ExpiresAt, t.ConsumedAt,
                    Linked = CASE WHEN a.Id IS NULL THEN 0 ELSE 1 END
                FROM dbo.AuthTelegramLinkToken t
                LEFT JOIN dbo.AuthTelegramAccount a ON a.UserId = t.UserId AND a.RevokedAt IS NULL
                WHERE t.LinkId = @LinkId
            `);
        const link = result.recordset[0];
        if (!link) return res.status(404).json({ message: 'Yêu cầu liên kết không tồn tại.' });
        const linked = Boolean(link.Linked);
        return res.json({
            linked,
            expired: !linked && new Date(link.ExpiresAt).getTime() <= Date.now(),
        });
    } catch (error) {
        authLog('error', 'telegram_setup_status_failed', safeErrorDetails(error));
        return res.status(500).json({ message: 'Không thể kiểm tra trạng thái liên kết.' });
    }
}

function webhookSecretMatches(req) {
    const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
    const actual = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    if (!expected || expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function telegramWebhook(req, res) {
    if (!webhookSecretMatches(req)) return res.status(403).json({ ok: false });
    const message = req.body?.message;
    const text = String(message?.text || '').trim();
    if (!message || message.chat?.type !== 'private') return res.json({ ok: true });
    const telegramUserId = message.from?.id;
    const chatId = message.chat?.id;
    if (!telegramUserId || !chatId) return res.json({ ok: true });

    if (message.contact) {
        let reply = 'Yêu cầu xác minh số điện thoại không hợp lệ hoặc đã hết hạn.';
        try {
            if (Number(message.contact.user_id) !== Number(telegramUserId)) {
                reply = 'Bạn phải chia sẻ số điện thoại của chính tài khoản Telegram đang sử dụng.';
            } else {
                const pool = await getPool();
                const pendingResult = await pool.request()
                    .input('TelegramUserId', sql.BigInt, telegramUserId)
                    .input('ChatId', sql.BigInt, chatId)
                    .query(`
                        SELECT TOP (1) t.LinkId, t.UserId, otp.TelegramPhoneNumber
                        FROM dbo.AuthTelegramLinkToken t
                        INNER JOIN dbo.AuthOtpAccount otp ON otp.UserId = t.UserId
                        INNER JOIN TAG_System.dbo.TaiKhoanDangNhap tk
                            ON CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap) = t.UserId
                        WHERE t.PendingTelegramUserId = @TelegramUserId AND t.PendingChatId = @ChatId
                          AND t.ConsumedAt IS NULL AND t.ExpiresAt > SYSUTCDATETIME()
                          AND tk.SuDung = 1 AND tk.TonTai = 1
                        ORDER BY t.CreatedAt DESC
                    `);
                const pending = pendingResult.recordset[0];
                if (pending) {
                    const telegramPhone = normalizePhoneNumber(message.contact.phone_number);
                    const configuredPhone = normalizePhoneNumber(pending.TelegramPhoneNumber);
                    if (!telegramPhone || !configuredPhone || telegramPhone !== configuredPhone) {
                        await pool.request().input('LinkId', sql.UniqueIdentifier, pending.LinkId)
                            .query('UPDATE dbo.AuthTelegramLinkToken SET ConsumedAt = SYSUTCDATETIME() WHERE LinkId = @LinkId;');
                        reply = 'Số điện thoại Telegram không khớp với số đã cấu hình cho tài khoản. Hãy liên hệ quản trị viên.';
                        authLog('warn', 'telegram_phone_mismatch', { userId: String(pending.UserId), telegramUserId: String(telegramUserId) });
                    } else {
                        const transaction = new sql.Transaction(pool);
                        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
                        try {
                            const linkResult = await new sql.Request(transaction)
                                .input('LinkId', sql.UniqueIdentifier, pending.LinkId)
                                .query(`
                                    SELECT TOP (1) LinkId, UserId
                                    FROM dbo.AuthTelegramLinkToken WITH (UPDLOCK, HOLDLOCK)
                                    WHERE LinkId = @LinkId AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
                                `);
                            const link = linkResult.recordset[0];
                            if (!link) throw new Error('Telegram link is no longer valid');
                            const duplicateResult = await new sql.Request(transaction)
                                .input('TelegramUserId', sql.BigInt, telegramUserId)
                                .input('UserId', sql.NVarChar(128), link.UserId)
                                .query(`
                                    SELECT TOP (1) UserId FROM dbo.AuthTelegramAccount WITH (UPDLOCK, HOLDLOCK)
                                    WHERE TelegramUserId = @TelegramUserId AND UserId <> @UserId
                                `);
                            if (duplicateResult.recordset.length) {
                                reply = 'Tài khoản Telegram này đã từng được liên kết với một tài khoản ERP khác.';
                            } else {
                                const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ').slice(0, 255);
                                await new sql.Request(transaction)
                                    .input('LinkId', sql.UniqueIdentifier, link.LinkId)
                                    .input('UserId', sql.NVarChar(128), link.UserId)
                                    .input('TelegramUserId', sql.BigInt, telegramUserId)
                                    .input('ChatId', sql.BigInt, chatId)
                                    .input('TelegramUsername', sql.NVarChar(255), message.from?.username || null)
                                    .input('DisplayName', sql.NVarChar(255), displayName || null)
                                    .input('PhoneNumberSnapshot', sql.NVarChar(32), configuredPhone)
                                    .query(`
                                        UPDATE dbo.AuthTelegramAccount
                                        SET RevokedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
                                        WHERE UserId = @UserId AND RevokedAt IS NULL;
                                        INSERT dbo.AuthTelegramAccount
                                            (UserId, TelegramUserId, ChatId, TelegramUsername, DisplayName,
                                             PhoneNumberSnapshot, LinkedAt, UpdatedAt, RevokedAt)
                                        VALUES
                                            (@UserId, @TelegramUserId, @ChatId, @TelegramUsername, @DisplayName,
                                             @PhoneNumberSnapshot, SYSUTCDATETIME(), SYSUTCDATETIME(), NULL);
                                        UPDATE dbo.AuthTelegramLinkToken SET ConsumedAt = SYSUTCDATETIME()
                                        WHERE LinkId = @LinkId AND ConsumedAt IS NULL;
                                    `);
                                reply = 'Liên kết Telegram với tài khoản Z76 thành công. Bạn có thể quay lại trang đăng nhập.';
                                authLog('info', 'telegram_account_linked', { userId: String(link.UserId), telegramUserId: String(telegramUserId) });
                            }
                            await transaction.commit();
                        } catch (error) {
                            await transaction.rollback();
                            throw error;
                        }
                    }
                }
            }
        } catch (error) {
            authLog('error', 'telegram_contact_verification_failed', safeErrorDetails(error));
            reply = 'Chưa thể xác minh số điện thoại. Vui lòng tạo liên kết mới hoặc liên hệ quản trị viên.';
        }
        try {
            await sendTelegramMessage(chatId, reply, { remove_keyboard: true });
        } catch (error) {
            authLog('error', 'telegram_contact_reply_failed', safeErrorDetails(error));
        }
        return res.json({ ok: true });
    }

    if (/^\/start$/i.test(text)) {
        try {
            await sendTelegramMessage(message.chat.id,
                'Hãy mở trang đăng nhập Z76, tạo liên kết Telegram rồi gửi lệnh /start kèm mã liên kết.');
        } catch (error) {
            authLog('error', 'telegram_start_reply_failed', safeErrorDetails(error));
        }
        return res.json({ ok: true });
    }
    const match = text.match(/^\/start\s+([A-Za-z0-9_-]{20,64})$/);
    if (!match) return res.json({ ok: true });

    const tokenHash = hmac(`telegram-link:${match[1]}`);
    let reply = 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy tạo liên kết mới trên trang đăng nhập Z76.';
    let requestPhone = false;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            const linkResult = await new sql.Request(transaction)
                .input('TokenHash', sql.Char(64), tokenHash)
                .query(`
                    SELECT TOP (1) LinkId, UserId
                    FROM dbo.AuthTelegramLinkToken WITH (UPDLOCK, HOLDLOCK)
                    WHERE TokenHash = @TokenHash AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
                `);
            const link = linkResult.recordset[0];
            if (link) {
                const duplicateResult = await new sql.Request(transaction)
                    .input('TelegramUserId', sql.BigInt, telegramUserId)
                    .input('UserId', sql.NVarChar(128), link.UserId)
                    .query(`
                        SELECT TOP (1) UserId FROM dbo.AuthTelegramAccount WITH (UPDLOCK, HOLDLOCK)
                        WHERE TelegramUserId = @TelegramUserId AND UserId <> @UserId
                    `);
                if (duplicateResult.recordset.length) {
                    reply = 'Tài khoản Telegram này đã từng được liên kết với một tài khoản ERP khác.';
                } else {
                    await new sql.Request(transaction)
                        .input('LinkId', sql.UniqueIdentifier, link.LinkId)
                        .input('TelegramUserId', sql.BigInt, telegramUserId)
                        .input('ChatId', sql.BigInt, chatId)
                        .query(`
                            UPDATE dbo.AuthTelegramLinkToken
                            SET PendingTelegramUserId = @TelegramUserId, PendingChatId = @ChatId
                            WHERE LinkId = @LinkId AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME();
                        `);
                    reply = 'Để xác nhận đúng nhân sự ERP, hãy bấm nút bên dưới và chia sẻ số điện thoại của chính tài khoản Telegram này.';
                    requestPhone = true;
                }
            }
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        authLog('error', 'telegram_link_failed', safeErrorDetails(error));
        reply = 'Chưa thể liên kết Telegram. Vui lòng thử lại hoặc liên hệ quản trị viên.';
    }
    try {
        await sendTelegramMessage(chatId, reply, requestPhone ? {
            keyboard: [[{ text: 'Chia sẻ số điện thoại', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
        } : undefined);
    } catch (error) {
        authLog('error', 'telegram_link_reply_failed', safeErrorDetails(error));
    }
    return res.json({ ok: true });
}

async function requireDatabaseAdmin(req, res) {
    const userId = Number(req.userId);
    if (!userId) {
        res.status(403).json({ message: 'Bạn không có quyền quản trị xác thực.' });
        return null;
    }
    const pool = await getPool();
    const result = await pool.request()
        .input('UserId', sql.Int, userId)
        .query(`SELECT HasPermission = dbo.SS_fn_UserCoQuyen(@UserId, N'Admin');`);
    if (!result.recordset[0]?.HasPermission) {
        res.status(403).json({ message: 'Chỉ Admin được cấu hình xác thực Telegram.' });
        return null;
    }
    return pool;
}

async function listTelegramAccounts(req, res) {
    try {
        const pool = await requireDatabaseAdmin(req, res);
        if (!pool) return;
        const search = String(req.query?.search || '').trim().slice(0, 100);
        const page = Math.max(1, Number(req.query?.page) || 1);
        const pageSize = Math.min(100, Math.max(10, Number(req.query?.pageSize) || 25));
        const result = await pool.request()
            .input('Search', sql.NVarChar(100), search || null)
            .input('Offset', sql.Int, (page - 1) * pageSize)
            .input('PageSize', sql.Int, pageSize)
            .query(`
                SELECT Total = COUNT(*) OVER(),
                    userId = tk.ID_TaiKhoanDangNhap,
                    username = tk.TenDangNhap,
                    fullName = tk.TenDayDu,
                    hasPhone = CONVERT(BIT, CASE WHEN NULLIF(LTRIM(RTRIM(otp.TelegramPhoneNumber)), N'') IS NULL THEN 0 ELSE 1 END),
                    telegramPhoneNumber = otp.TelegramPhoneNumber,
                    enabled = CONVERT(BIT, CASE WHEN otp.OtpEnabled = 1 AND otp.OtpChannel = N'Telegram' THEN 1 ELSE 0 END),
                    linked = CONVERT(BIT, CASE WHEN tg.Id IS NULL THEN 0 ELSE 1 END),
                    telegramUsername = tg.TelegramUsername,
                    telegramDisplayName = tg.DisplayName,
                    phoneNumberSnapshot = tg.PhoneNumberSnapshot,
                    linkedAt = tg.LinkedAt
                FROM TAG_System.dbo.TaiKhoanDangNhap tk
                LEFT JOIN dbo.AuthOtpAccount otp
                    ON TRY_CONVERT(INT, otp.UserId) = tk.ID_TaiKhoanDangNhap
                       OR otp.NormalizedUsername = LOWER(LTRIM(RTRIM(tk.TenDangNhap)))
                LEFT JOIN dbo.AuthTelegramAccount tg
                    ON tg.UserId = CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap) AND tg.RevokedAt IS NULL
                WHERE tk.SuDung = 1 AND tk.TonTai = 1
                  AND (@Search IS NULL OR tk.TenDangNhap LIKE N'%' + @Search + N'%'
                       OR tk.TenDayDu LIKE N'%' + @Search + N'%')
                ORDER BY tk.TenDangNhap
                OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
            `);
        const rows = result.recordset.map(({ phoneNumberSnapshot, ...row }) => ({
            ...row,
            linked: Boolean(row.linked) && normalizePhoneNumber(phoneNumberSnapshot) === normalizePhoneNumber(row.telegramPhoneNumber),
        }));
        return res.json({ rows, total: Number(result.recordset[0]?.Total || 0), page, pageSize });
    } catch (error) {
        authLog('error', 'telegram_admin_list_failed', safeErrorDetails(error));
        return res.status(500).json({ message: 'Không thể tải cấu hình Telegram.' });
    }
}

async function updateTelegramAccount(req, res) {
    try {
        const pool = await requireDatabaseAdmin(req, res);
        if (!pool) return;
        const userId = Number(req.params.userId);
        const enabled = req.body?.enabled;
        const phoneProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'phoneNumber');
        const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
        if (!userId || typeof enabled !== 'boolean') return res.status(400).json({ message: 'Dữ liệu cấu hình không hợp lệ.' });
        if (req.body?.phoneNumber && (phoneNumber.length < 9 || phoneNumber.length > 15)) {
            return res.status(400).json({ message: 'Số điện thoại Telegram không hợp lệ.' });
        }
        if (enabled && phoneProvided && !phoneNumber) return res.status(400).json({ message: 'Cần cấu hình số điện thoại trước khi bật OTP Telegram.' });
        const result = await pool.request()
            .input('UserId', sql.NVarChar(128), String(userId))
            .input('NumericUserId', sql.Int, userId)
            .input('Enabled', sql.Bit, enabled)
            .input('PhoneProvided', sql.Bit, phoneProvided)
            .input('TelegramPhoneNumber', sql.NVarChar(32), phoneNumber || null)
            .query(`
                DECLARE @Username NVARCHAR(255);
                SELECT @Username = TenDangNhap
                FROM TAG_System.dbo.TaiKhoanDangNhap
                WHERE ID_TaiKhoanDangNhap = @NumericUserId AND SuDung = 1 AND TonTai = 1;
                IF @Username IS NULL THROW 50001, N'Tài khoản ERP không tồn tại hoặc đã ngừng sử dụng.', 1;

                UPDATE dbo.AuthOtpAccount
                SET UserId = @UserId, Username = @Username,
                    NormalizedUsername = LOWER(LTRIM(RTRIM(@Username))),
                    OtpChannel = N'Telegram', OtpEnabled = @Enabled,
                    TelegramPhoneNumber = CASE WHEN @PhoneProvided = 1 THEN @TelegramPhoneNumber ELSE TelegramPhoneNumber END,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE UserId = @UserId OR NormalizedUsername = LOWER(LTRIM(RTRIM(@Username)));
                IF @@ROWCOUNT = 0
                    INSERT dbo.AuthOtpAccount
                        (UserId, Username, NormalizedUsername, OtpEmail, OtpEnabled, OtpChannel,
                         TelegramPhoneNumber, CreatedAt, UpdatedAt)
                    VALUES
                        (@UserId, @Username, LOWER(LTRIM(RTRIM(@Username))), NULL, @Enabled, N'Telegram',
                         @TelegramPhoneNumber,
                         SYSUTCDATETIME(), SYSUTCDATETIME());

                IF @Enabled = 1 AND NOT EXISTS (
                    SELECT 1 FROM dbo.AuthOtpAccount
                    WHERE UserId = @UserId AND NULLIF(TelegramPhoneNumber, N'') IS NOT NULL
                ) THROW 50002, N'Cần cấu hình số điện thoại trước khi bật OTP Telegram.', 1;

                IF @Enabled = 0
                BEGIN
                    UPDATE dbo.AuthOtpChallenge SET ConsumedAt = COALESCE(ConsumedAt, SYSUTCDATETIME())
                    WHERE UserId = @UserId AND ConsumedAt IS NULL;
                    UPDATE dbo.AuthTelegramLinkToken SET ConsumedAt = COALESCE(ConsumedAt, SYSUTCDATETIME())
                    WHERE UserId = @UserId AND ConsumedAt IS NULL;
                END;
                SELECT enabled = @Enabled;
            `);
        return res.json(result.recordset[0]);
    } catch (error) {
        authLog('error', 'telegram_admin_update_failed', safeErrorDetails(error));
        const isDuplicatePhone = error?.number === 2601 || error?.number === 2627;
        const isValidationError = error?.number === 50001 || error?.number === 50002 || isDuplicatePhone;
        return res.status(isValidationError ? 400 : 500).json({
            message: isDuplicatePhone
                ? 'Số điện thoại này đã được cấu hình cho tài khoản khác.'
                : (isValidationError ? error.message : 'Không thể cập nhật cấu hình Telegram.'),
        });
    }
}

async function resetTelegramAccount(req, res) {
    try {
        const pool = await requireDatabaseAdmin(req, res);
        if (!pool) return;
        const userId = Number(req.params.userId);
        if (!userId) return res.status(400).json({ message: 'Tài khoản không hợp lệ.' });
        await pool.request()
            .input('UserId', sql.NVarChar(128), String(userId))
            .query(`
                UPDATE dbo.AuthTelegramAccount SET RevokedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
                WHERE UserId = @UserId AND RevokedAt IS NULL;
                UPDATE dbo.AuthTelegramLinkToken SET ConsumedAt = COALESCE(ConsumedAt, SYSUTCDATETIME())
                WHERE UserId = @UserId AND ConsumedAt IS NULL;
                UPDATE dbo.AuthOtpChallenge SET ConsumedAt = COALESCE(ConsumedAt, SYSUTCDATETIME())
                WHERE UserId = @UserId AND ConsumedAt IS NULL;
                UPDATE dbo.AuthTrustedDevice SET RevokedAt = SYSUTCDATETIME()
                WHERE UserId = @UserId AND RevokedAt IS NULL;
            `);
        return res.json({ success: true });
    } catch (error) {
        authLog('error', 'telegram_admin_reset_failed', safeErrorDetails(error));
        return res.status(500).json({ message: 'Không thể reset liên kết Telegram.' });
    }
}

module.exports = {
    erpOtpLogin,
    verifyOtp,
    resendOtp,
    logoutTrustedDevice,
    telegramSetupStatus,
    telegramWebhook,
    listTelegramAccounts,
    updateTelegramAccount,
    resetTelegramAccount,
    _test: {
        normalizeUsername, legacyMd5Password, maskEmail, otpHash, safeEqualHex,
        encryptJson, decryptJson, parseCookies, trustedCookie, sendOtpTelegram, normalizePhoneNumber,
    },
};
