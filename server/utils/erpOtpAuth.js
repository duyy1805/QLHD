const crypto = require('crypto');
const axios = require('axios');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
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

    const subject = 'Mã OTP đăng nhập Z76 Finance';
    const body = [
        'Mã OTP đăng nhập của bạn là:',
        '',
        otp,
        '',
        'Mã có hiệu lực trong 5 phút và chỉ được sử dụng một lần.',
        'Nếu bạn không thực hiện đăng nhập, hãy bỏ qua email này.',
    ].join('\r\n');
    const message = [
        `From: Z76 Finance <${sender}>`,
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

async function findOtpAccount(pool, userId, normalizedUsername) {
    const result = await pool.request()
        .input('UserId', sql.NVarChar(128), userId ? String(userId) : null)
        .input('NormalizedUsername', sql.NVarChar(255), normalizedUsername)
        .query(`
            SELECT TOP (1)
                UserId = CONVERT(NVARCHAR(128), tk.ID_TaiKhoanDangNhap),
                Username = tk.TenDangNhap,
                OtpEmail = COALESCE(NULLIF(LTRIM(RTRIM(otp.OtpEmail)), N''), NULLIF(LTRIM(RTRIM(tk.Email)), N''))
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

async function isTrustedDevice(pool, req, userId) {
    const token = parseCookies(req.headers.cookie)[TRUSTED_COOKIE];
    if (!token) return false;
    const result = await pool.request()
        .input('UserId', sql.NVarChar(128), String(userId))
        .input('TokenHash', sql.Char(64), hmac(`trusted:${token}`))
        .query(`
            UPDATE dbo.AuthTrustedDevice
            SET LastUsedAt = SYSUTCDATETIME()
            OUTPUT inserted.Id
            WHERE UserId = @UserId AND TokenHash = @TokenHash
              AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
        `);
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
                    idChucVu = tk.ID_ChucVu,
                    idNhanSu = tk.ID_NhanSu,
                    email = tk.Email
                FROM TAG_System.dbo.TaiKhoanDangNhap tk
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
        authLog('info', 'otp_account_found', {
            ...logContext,
            userId: effectiveUserId,
            hasOtpEmail: Boolean(account.OtpEmail),
            maskedEmail: account.OtpEmail ? maskEmail(account.OtpEmail) : undefined,
        });
        if (!account.OtpEmail) {
            authLog('error', 'otp_email_missing', { ...logContext, userId: effectiveUserId });
            return res.status(503).json({ message: 'Tài khoản chưa được cấu hình email nhận OTP.', requestId });
        }
        if (await isTrustedDevice(pool, req, effectiveUserId)) {
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
            .input('OtpEmail', sql.NVarChar(320), account.OtpEmail)
            .input('OtpHash', sql.Char(64), otpHash(challengeId, otp))
            .input('EncryptedLoginPayload', sql.NVarChar(sql.MAX), encryptJson(loginData))
            .input('IpAddress', sql.NVarChar(64), clientIp(req))
            .input('UserAgent', sql.NVarChar(512), String(req.headers['user-agent'] || '').slice(0, 512))
            .query(`
                DELETE FROM dbo.AuthOtpChallenge WHERE ExpiresAt < DATEADD(DAY, -1, SYSUTCDATETIME());
                INSERT dbo.AuthOtpChallenge
                    (ChallengeId, UserId, NormalizedUsername, OtpEmail, OtpHash, EncryptedLoginPayload,
                     ExpiresAt, LastSentAt, Attempts, ConsumedAt, IpAddress, UserAgent, CreatedAt)
                VALUES
                    (@ChallengeId, @UserId, @NormalizedUsername, @OtpEmail, @OtpHash, @EncryptedLoginPayload,
                     DATEADD(SECOND, ${OTP_TTL_SECONDS}, SYSUTCDATETIME()), SYSUTCDATETIME(), 0, NULL,
                     @IpAddress, @UserAgent, SYSUTCDATETIME())
            `);
        authLog('info', 'otp_challenge_created', { ...logContext, challengeId, userId: effectiveUserId });

        try {
            await sendOtpEmail(account.OtpEmail, otp);
            authLog('info', 'otp_email_sent', {
                ...logContext,
                challengeId,
                userId: effectiveUserId,
                maskedEmail: maskEmail(account.OtpEmail),
            });
        } catch (error) {
            await pool.request().input('ChallengeId', sql.UniqueIdentifier, challengeId)
                .query('DELETE FROM dbo.AuthOtpChallenge WHERE ChallengeId = @ChallengeId');
            authLog('error', 'otp_email_failed', { ...logContext, challengeId, ...safeErrorDetails(error) });
            return res.status(503).json({ message: 'Chưa thể gửi mã xác minh. Vui lòng thử lại sau.', requestId });
        }

        return res.json({
            status: 'otp_required',
            challengeId,
            maskedEmail: maskEmail(account.OtpEmail),
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
                    c.Attempts, c.ExpiresAt, c.ConsumedAt
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

        if (req.body?.trustDevice === true) {
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
            SELECT TOP (1) OtpEmail, LastSentAt, ConsumedAt
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
        await sendOtpEmail(challenge.OtpEmail, otp);
        return res.json({
            status: 'otp_required',
            challengeId,
            maskedEmail: maskEmail(challenge.OtpEmail),
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

module.exports = {
    erpOtpLogin,
    verifyOtp,
    resendOtp,
    logoutTrustedDevice,
    _test: { normalizeUsername, legacyMd5Password, maskEmail, otpHash, safeEqualHex, encryptJson, decryptJson, parseCookies, trustedCookie },
};
