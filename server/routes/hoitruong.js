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


router.post('/B5/register', async (req, res) => {
    try {
        // Lấy dữ liệu theo đúng tên key mà React gửi lên (snake_case)
        const { event_id, full_name, job_title, organization } = req.body;

        // 1. Validate dữ liệu đầu vào
        if (!full_name || !organization) {
            return res.status(400).json({
                ok: false,
                error: 'Vui lòng nhập Họ tên và Đơn vị công tác'
            });
        }

        // Mặc định event_id là 1 (Nhà máy) nếu không gửi lên
        const eventIdToSave = event_id || 1;

        const pool = await poolPromise;

        // 2. Thực hiện Insert có kèm event_id
        const result = await pool.request()
            .input('EventId', sql.Int, eventIdToSave)
            .input('FullName', sql.NVarChar, full_name)
            .input('JobTitle', sql.NVarChar, job_title || '') // Xử lý nếu job_title null
            .input('Organization', sql.NVarChar, organization)
            .query(`
                INSERT INTO B5_participants (event_id, full_name, job_title, organization)
                VALUES (@EventId, @FullName, @JobTitle, @Organization);
                
                -- Trả về ID vừa tạo
                SELECT SCOPE_IDENTITY() AS id;
            `);

        res.json({
            ok: true,
            message: 'Đăng ký thành công',
            newId: result.recordset[0].id
        });

    } catch (err) {
        console.error('Lỗi khi đăng ký tham gia:', err);
        res.status(500).json({
            ok: false,
            error: 'Có lỗi xảy ra khi lưu thông tin.'
        });
    }
});

router.get('/B5/participants', async (req, res) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();

        // Lấy tham số event_id từ URL (ví dụ: /B5/participants?event_id=1)
        const { event_id } = req.query;

        let sqlQuery = `
            SELECT id, event_id, full_name, job_title, organization, created_at 
            FROM B5_participants 
            WHERE 1=1 
        `;

        // Nếu có event_id gửi lên thì lọc, không thì lấy hết (hoặc mặc định lấy sự kiện mới nhất tùy logic)
        if (event_id) {
            request.input('EventId', sql.Int, event_id);
            sqlQuery += ` AND event_id = @EventId `;
        }

        sqlQuery += ` ORDER BY created_at DESC`;

        const result = await request.query(sqlQuery);

        // Map dữ liệu trả về camelCase cho Frontend dễ dùng (tùy chọn, ở đây React code của bạn đang map tay nên trả về snake_case cũng được)
        // Để khớp với code React hiện tại (LandingRegisterFactory), React đang đọc: item.fullName, item.jobTitle
        // Nên ta map lại key ở đây cho tiện Frontend:
        const formattedData = result.recordset.map(item => ({
            id: item.id,
            eventId: item.event_id,
            fullName: item.full_name,
            jobTitle: item.job_title,
            organization: item.organization,
            createdAt: item.created_at
        }));

        res.json({
            ok: true,
            data: formattedData
        });

    } catch (err) {
        console.error('Lỗi khi lấy danh sách:', err);
        res.status(500).json({
            ok: false,
            error: 'Không thể lấy danh sách người tham gia.'
        });
    }
});
module.exports = router;