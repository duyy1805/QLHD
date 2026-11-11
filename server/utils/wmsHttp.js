function headers(idempotencyKey) {
    return {
        'Content-Type': 'application/json',
        'x-api-key': String(process.env.WMS_API_KEY || '').trim(),
        'Idempotency-Key': idempotencyKey,
    };
}

module.exports = { headers };
