const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ ok: false, message: 'Thiếu API Key' });
    }

    if (apiKey !== process.env.API_KEY) {
        return res.status(403).json({ ok: false, message: 'API Key không hợp lệ' });
    }

    next(); // Cho phép đi tiếp
};

module.exports = checkApiKey;