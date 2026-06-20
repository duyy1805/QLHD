const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = 'C:/Anh5s/Upload';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});

const uploadImage = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Chỉ cho phép upload ảnh'));
        }
        cb(null, true);
    }
});

module.exports = { uploadImage };
