const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const path = require('path');
const https = require("https");
const fs = require("fs");
require('dotenv').config();

const authRouter = require('./routes/auth')
const hrRouter = require('./routes/hr')
const qlhdRouter = require('./routes/qlhd')
const vanbandiRouter = require('./routes/vanbandi');
const hsttRouter = require('./routes/hstt');
const dautuanRouter = require('./routes/dautuan');
const khotm = require('./routes/khotm');
const khotmtest = require('./routes/khotmtest');
const erp = require('./routes/ERP/erp');
const hoitruongRouter = require('./routes/hoitruong');
const sosecRouter = require('./routes/sosec');
const invoiceRouter = require('./routes/invoice');
const hoaDonDienTuRouter = require('./routes/hoadondientu');
const tgsxRouter = require('./routes/ERP/tgsx');
const erp_plp = require('./routes/ERP/erp_plp');
const thuthapRouter = require('./routes/thuthap.routes');
const app = express();
app.use(express.json());
const configuredOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (configuredOrigins.includes(origin)) return true;
    try {
        const url = new URL(origin);
        const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
        const isZ76 = url.protocol === 'https:' && (url.hostname === 'z76.vn' || url.hostname.endsWith('.z76.vn'));
        return isLocal || isZ76;
    } catch {
        return false;
    }
};
app.use(cors({
    origin(origin, callback) {
        callback(isAllowedOrigin(origin) ? null : new Error('Origin is not allowed by CORS'), isAllowedOrigin(origin));
    },
    credentials: true,
}));

// Định nghĩa route

app.use('/auth', authRouter);
app.use('/hr', hrRouter);
app.use('/QLHD', qlhdRouter);
app.use('/vanbandi', vanbandiRouter);
app.use('/hoitruong', hoitruongRouter);
app.use('/sosec', sosecRouter);
app.use('/invoice', invoiceRouter);
app.use('/hoadondientu', hoaDonDienTuRouter);
app.use('/hstt', hsttRouter);
app.use('/dautuan', dautuanRouter);
app.use('/khotm', khotm);
app.use('/khotmtest', khotmtest);
app.use('/erp', erp);
app.use('/erp/tgsx', tgsxRouter);
app.use('/erp_plp', erp_plp)

app.use('/thuthap', thuthapRouter);

app.use('/upload', express.static(path.join('C:/Anh5s/Upload'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

app.use('/uploads', express.static(path.join('C:/DocumentsUpload/HopDong/Upload'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

app.use('/uploads_vbd', express.static(path.join('C:/DocumentsUpload/VanBanDi/Upload'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

app.use('/uploads_hstt', express.static(path.join('C:/DocumentsUpload/HoSoThanhToan/Upload'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

