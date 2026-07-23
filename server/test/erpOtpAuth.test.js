const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OTP_HASH_SECRET = 'test-hash-secret-with-enough-entropy';
process.env.OTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.COOKIE_SECURE = 'false';

const { _test } = require('../utils/erpOtpAuth');

test('normalizes usernames and masks recipient email', () => {
    assert.equal(_test.normalizeUsername('  NguyenVanA '), 'nguyenvana');
    assert.equal(_test.maskEmail('nguyenvana@example.com'), 'ng********@example.com');
    assert.equal(_test.maskEmail('x@example.com'), 'x***@example.com');
});

test('matches the legacy .NET ASCII MD5 format without logging the password', () => {
    assert.equal(_test.legacyMd5Password('123456'), 'e10adc3949ba59abbe56e057f20f883e');
    assert.equal(_test.legacyMd5Password('mật-khẩu'), _test.legacyMd5Password('m?t-kh?u'));
});

test('hash comparison accepts only the correct OTP and challenge', () => {
    const hash = _test.otpHash('challenge-a', '123456');
    assert.equal(_test.safeEqualHex(hash, _test.otpHash('challenge-a', '123456')), true);
    assert.equal(_test.safeEqualHex(hash, _test.otpHash('challenge-a', '654321')), false);
    assert.equal(_test.safeEqualHex(hash, _test.otpHash('challenge-b', '123456')), false);
});

test('encrypts and authenticates pending login payloads', () => {
    const source = { accessToken: 'secret-token', userInfo: { id: 12, username: 'tester' } };
    const encrypted = _test.encryptJson(source);
    assert.equal(encrypted.includes('secret-token'), false);
    assert.deepEqual(_test.decryptJson(encrypted), source);

    const tampered = Buffer.from(encrypted, 'base64');
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => _test.decryptJson(tampered.toString('base64')));
});

test('parses and creates trusted-device cookies safely', () => {
    assert.deepEqual(_test.parseCookies('a=1; z76_trusted_device=abc%20123'), {
        a: '1',
        z76_trusted_device: 'abc 123',
    });
    const cookie = _test.trustedCookie('opaque-token', 60);
    assert.match(cookie, /^z76_trusted_device=opaque-token;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /; Secure/);
});
