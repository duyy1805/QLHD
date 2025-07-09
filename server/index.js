const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const path = require('path');
const https = require("https");
const fs = require("fs");
require('dotenv').config();
const { poolPromise } = require('./db');

const authRouter = require('./routes/auth')
const b2Router = require('./routes/b2')
const qlhdRouter = require('./routes/qlhd')

const app = express();
app.use(express.json());
app.use(cors());

// Định nghĩa route

app.use('/auth', authRouter)
app.use('/b2', b2Router)
app.use('/QLHD', qlhdRouter)
app.use('/uploads', express.static('C:/HopDong/Upload', {
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

// https.createServer(credentials, app).listen(5000, () => {
//     console.log("HTTPS server is running on port 5000");
// });

// Lắng nghe kết nối
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

