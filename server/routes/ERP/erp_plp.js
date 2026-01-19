const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../../middleware/auth');
const { tagpoolPromise_PLP } = require('../../db_plp');
const sql = require('mssql');
const checkApiKey = require('../../middleware/apiKey');


router.get('/baocao/ton-layout-btp', async (req, res) => {
    try {
        const { TenNha, ID_Kho, MaVung } = req.query;

        const pool = await tagpoolPromise_PLP;
        const request = pool.request();

        request.input('TenNha', sql.NVarChar(30), TenNha);
        request.input('ID_Kho', sql.Int, Number(ID_Kho));
        request.input('MaVung', sql.NVarChar(30), MaVung);

        const result = await request.execute('BaoCao_Ton_Layoutkho_BTP');

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router