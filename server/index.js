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

const app = express();
app.use(express.json());
app.use(cors());

// Định nghĩa route

app.use('/auth', authRouter)
app.use('/hr', hrRouter)
app.use('/QLHD', qlhdRouter)
app.use('/vanbandi', vanbandiRouter);
app.use('/hstt', hsttRouter)
app.use('/dautuan', dautuanRouter);

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

