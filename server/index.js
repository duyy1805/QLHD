const express = require('express');
const cors = require('cors');
const sql = require('mssql');
require('dotenv').config();
const { poolPromise } = require('./db');

const authRouter = require('./routes/auth')
const b2Router = require('./routes/b2')

const app = express();
app.use(express.json());
app.use(cors());

// Định nghĩa route

app.use('/auth', authRouter)
app.use('/b2', b2Router)


// Lắng nghe kết nối
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

