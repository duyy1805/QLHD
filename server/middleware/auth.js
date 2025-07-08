const jwt = require('jsonwebtoken')

const verifyToken = (req, res, next) => {
	const authHeader = req.header('Authorization')
	const token = authHeader && authHeader.split(' ')[1]

	if (!token)
		return res
			.status(401)
			.json({ success: false, message: 'Access token not found' })

	try {
		const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
		console.log(decoded)
		req.userId = decoded.userId
		req.role = decoded.role;
		next()
	} catch (error) {
		console.log(error)
		return res.status(403).json({ success: false, message: 'Invalid token' })
	}
}

const verifyAdmin = (req, res, next) => {
	if (req.role !== 'admin') {
		return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
	}
	next();
};

module.exports = { verifyToken, verifyAdmin };
