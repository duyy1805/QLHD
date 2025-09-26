const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { poolPromise } = require('../db');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Lấy danh sách seat theo EventId
router.post('/eventseat', async (req, res) => {
    try {
        const { EventId } = req.body;
        if (!EventId) {
            return res.status(400).json({ error: 'Thiếu EventId' });
        }

        const pool = await poolPromise;
        const result = await pool.request()
            .input('EventId', sql.Int, EventId)
            .execute('sp_EventSeat_Get');

        res.json({
            ok: true,
            data: result.recordset
        });
    } catch (err) {
        console.error('Lỗi khi lấy event seat:', err);
        res.status(500).json({ error: 'Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.' });
    }
});

router.post('/eventseat/upsert', async (req, res) => {
    try {
        const { EventId, PersonName, SeatId, Side, RowNumber, ColNumber } = req.body;

        if (!EventId) {
            return res.status(400).json({ ok: false, message: 'Thiếu EventId' });
        }

        const pool = await poolPromise;
        const request = pool.request()
            .input('EventId', sql.Int, EventId)
            .input('PersonName', sql.NVarChar(200), PersonName || null)
            .input('SeatId', sql.Int, SeatId || null)
            .input('Side', sql.Char(1), Side || null)
            .input('RowNumber', sql.Int, RowNumber || null)
            .input('ColNumber', sql.Int, ColNumber || null);

        const result = await request.execute('sp_EventSeat_Upsert');

        return res.json({
            ok: true,
            data: result.recordset?.[0] || null
        });
    } catch (err) {
        console.error('eventseat/upsert error:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi server khi upsert EventSeat.' });
    }
});

module.exports = router;