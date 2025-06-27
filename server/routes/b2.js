const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { poolPromise } = require('../db');
const sql = require('mssql');

router.get('/thietbi', async (req, res) => {
    try {
        // Sử dụng kết nối được khởi tạo
        const pool = await poolPromise;
        let result = await pool.request()
            .execute('GetThietBiKiemTra');

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});

router.post('/capnhatketquakiemtra', async (req, res) => {
    const { IDNoiDungKiemTra, KetQua } = req.body; // Lấy tham số từ body

    console.log(req.body)
    try {
        // Kết nối với cơ sở dữ liệu
        const pool = await poolPromise;

        // Thực thi lệnh SQL để cập nhật kết quả kiểm tra
        const result = await pool.request()
            .input('IDNoiDungKiemTra', sql.Int, IDNoiDungKiemTra) // Thêm tham số IDNoiDungKiemTra
            .input('KetQua', sql.NVarChar, KetQua) // Thêm tham số KetQua
            .query('EXEC dbo.CapNhatKetQuaKiemTra @IDNoiDungKiemTra, @KetQua'); // Thực thi câu lệnh SQL
        res.json(result.recordset); // Trả về kết quả
    } catch (err) {
        console.error('Lỗi truy vấn cơ sở dữ liệu:', err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});


router.post('/insertthietbi', async (req, res) => {
    const { LoaiPhuongTien, ViTri, TanSuat } = req.body; // Lấy tham số từ body

    console.log(req.body); // Log ra để kiểm tra dữ liệu

    try {
        // Kết nối với cơ sở dữ liệu
        const pool = await poolPromise;

        // Thực thi lệnh SQL để chèn thiết bị mới vào bảng ThietBi
        const result = await pool.request()
            .input('LoaiPhuongTien', sql.NVarChar, LoaiPhuongTien) // Thêm tham số LoaiPhuongTien
            .input('ViTri', sql.NVarChar, ViTri) // Thêm tham số ViTri
            .input('TanSuatKiemTra', sql.Int, TanSuat) // Thêm tham số TanSuatKiemTra
            .query('EXEC dbo.InsertThietBi @LoaiPhuongTien, @ViTri, @TanSuatKiemTra'); // Gọi stored procedure để chèn thiết bị mới

        res.json(result.recordset); // Trả về kết quả từ cơ sở dữ liệu
    } catch (err) {
        console.error('Lỗi truy vấn cơ sở dữ liệu:', err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});


router.post('/deletethietbi', async (req, res) => {
    const { IDThietBi } = req.body; // Lấy tham số từ body

    console.log(req.body); // Log ra để kiểm tra dữ liệu

    try {
        // Kết nối với cơ sở dữ liệu
        const pool = await poolPromise;

        // Thực thi lệnh SQL để chèn thiết bị mới vào bảng ThietBi
        const result = await pool.request()
            .input('IDThietBi', sql.Int, IDThietBi) // Thêm tham số TanSuatKiemTra
            .query('EXEC dbo.DeleteThietBi @IDThietBi'); // Gọi stored procedure để chèn thiết bị mới

        res.json(result.recordset); // Trả về kết quả từ cơ sở dữ liệu
    } catch (err) {
        console.error('Lỗi truy vấn cơ sở dữ liệu:', err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});
// @route POST api/auth/register
// @desc Register user
// @access Public
router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    // Simple validation
    if (!username || !password)
        return res.status(400).json({ success: false, message: 'Missing username and/or password' });

    try {
        const pool = await poolPromise;

        // Check for existing user
        const existingUser = await pool.request()
            .input('Username', username)
            .query('SELECT * FROM Users WHERE username = @Username');

        if (existingUser.recordset.length > 0)
            return res.status(400).json({ success: false, message: 'Username already taken' });

        // All good
        const hashedPassword = await argon2.hash(password);
        await pool.request()
            .input('Username', username)
            .input('Password', hashedPassword)
            .query('INSERT INTO Users (username, password) VALUES (@username, @password)');

        // Return token
        const result = await pool.request()
            .input('Username', username)
            .query('SELECT id FROM Users WHERE username = @Username');

        const newUser = result.recordset[0];
        const accessToken = jwt.sign(
            { userId: newUser.id },
            process.env.ACCESS_TOKEN_SECRET
        );

        res.json({
            success: true,
            message: 'User created successfully',
            accessToken
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// @route POST api/auth/login
// @desc Login user
// @access Public
router.post('/login', async (req, res) => {
    const { username, password, uuid } = req.body;

    // Simple validation
    if (!username || !password)
        return res.status(400).json({ success: false, message: 'Missing username and/or password' });

    try {
        const pool = await poolPromise;

        // Check for existing user
        const result = await pool.request()
            .input('Username', username)
            .query('SELECT * FROM Users WHERE username = @Username');

        const user = result.recordset[0];
        if (!user)
            return res.status(400).json({ success: false, message: 'Incorrect username or password' });

        // Username found
        const passwordValid = await argon2.verify(user.password, password);
        if (!passwordValid)
            return res.status(400).json({ success: false, message: 'Incorrect username or password' });

        // Check UUID logic
        console.log(uuid)
        if (!user.uuid) {
            // If user.uuid is null, update with the new uuid
            await pool.request()
                .input('UUID', uuid)
                .input('Username', username)
                .query('UPDATE Users SET uuid = @UUID WHERE username = @Username');

            // Proceed to login
        } else if (user.uuid !== uuid) {
            // If user.uuid exists and doesn't match the provided uuid, deny login
            return res.status(403).json({ success: false, message: 'This account is locked to another device.' });
        }

        // Create JWT token with user role included
        const accessToken = jwt.sign(
            { userId: user.id, role: user.role }, // Add role to JWT payload
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '1h' } // Optional: Set token expiration time
        );
        res.json({
            success: true,
            message: 'User logged in successfully',
            accessToken,
            role: user.role // Return the user's role as part of the response
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.post('/resetUUID', async (req, res) => {
    const { username } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Username', username)
            .query('SELECT * FROM Users WHERE username = @Username');
        console.log(result)
        const user = result.recordset[0];
        if (!user)
            return res.status(400).json({ success: false, message: 'Incorrect username or password' });
        // Check for existing user
        await pool.request()
            .input('Username', username)
            .query('update Users SET uuid = NULL WHERE username = @Username');

        res.json({
            success: true,
            message: 'User can login on new device',
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
module.exports = router
