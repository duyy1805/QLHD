const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { hrpoolPromise } = require('../db1');
const sql = require('mssql');


async function generateApplyLeaveID(pool) {
    const today = new Date();
    const datePrefix = `PNP${today.getDate().toString().padStart(2, '0')}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getFullYear().toString().slice(-2)}`;

    const query = `
        SELECT ApplyLeaveID
        FROM HR.ApplyLeaves
        WHERE ApplyLeaveID LIKE '${datePrefix}-%'
    `;

    const result = await pool.request().query(query);
    const existingIds = result.recordset.map(row => row.ApplyLeaveID);

    let maxSeq = 0;
    existingIds.forEach(id => {
        const parts = id.split("-");
        if (parts.length === 2 && !isNaN(parts[1])) {
            const num = parseInt(parts[1], 10);
            if (num > maxSeq) maxSeq = num;
        }
    });

    const nextSeq = (maxSeq + 1).toString().padStart(2, '0');
    return `${datePrefix}-${nextSeq}`; // ví dụ: PNP20250716-03
}

router.post('/apply-leave', async (req, res) => {
    try {
        const pool = await hrpoolPromise;
        const request = pool.request();

        const data = req.body;
        const applyLeaveID = await generateApplyLeaveID(pool);
        // Truyền các tham số
        request.input('ApplyLeaveGuid', sql.UniqueIdentifier, data.ApplyLeaveGuid);
        request.input('ApplyLeaveID', sql.VarChar(20), applyLeaveID);
        request.input('Title', sql.NVarChar(255), data.Title);
        request.input('EmployeeGuid', sql.UniqueIdentifier, data.EmployeeGuid);
        request.input('EmployeeID', sql.VarChar(20), data.EmployeeID);
        request.input('EmployeeName', sql.NVarChar(50), data.EmployeeName);
        request.input('LoginName', sql.VarChar(25), data.LoginName);
        request.input('OrganizationGuid', sql.UniqueIdentifier, data.OrganizationGuid);
        request.input('DepartmentGuid', sql.UniqueIdentifier, data.DepartmentGuid);
        request.input('DepartmentID', sql.VarChar(20), data.DepartmentID);
        request.input('DepartmentName', sql.NVarChar(50), data.DepartmentName);
        request.input('StartTime', sql.DateTime, data.StartTime);
        request.input('EndTime', sql.DateTime, data.EndTime);
        request.input('StatusEndTime', sql.VarChar(1), data.StatusEndTime);
        request.input('StatusStartTime', sql.VarChar(1), data.StatusStartTime);
        request.input('RealTime', sql.Float, data.RealTime);
        request.input('LeaveReason', sql.VarChar(2), data.LeaveReason);
        request.input('Type', sql.VarChar(2), data.Type);
        request.input('ApplyLeaveTypeName', sql.NVarChar(255), data.ApplyLeaveTypeName);
        request.input('Attachment', sql.Bit, data.Attachment);
        request.input('Description', sql.NVarChar(255), data.Description);
        request.input('Note', sql.NVarChar(255), data.Note);
        request.input('Total', sql.Float, data.Total);
        request.input('TotalNoSalary', sql.Float, data.TotalNoSalary);
        request.input('TotalHaveSalary', sql.Float, data.TotalHaveSalary);
        request.input('IsLocked', sql.NVarChar(50), data.IsLocked);
        request.input('IsImported', sql.Bit, data.IsImported);
        request.input('RemainDay', sql.Float, data.RemainDay);
        request.input('ShiftID', sql.Int, data.ShiftID);
        request.input('ShiftName', sql.NVarChar(50), data.ShiftName);
        request.input('Status', sql.VarChar(1), data.Status);
        request.input('ConditionValue', sql.NVarChar(50), data.ConditionValue);
        request.input('WorkFlowGuid', sql.UniqueIdentifier, data.WorkFlowGuid);
        request.input('WorkFlowsContent', sql.NVarChar(sql.MAX), data.WorkFlowsContent);
        request.input('WorkFlowCurrent', sql.UniqueIdentifier, data.WorkFlowCurrent);
        request.input('CreatedDate', sql.DateTime, data.CreatedDate);
        request.input('ModifiedDate', sql.DateTime, data.ModifiedDate);
        request.input('CreatedBy', sql.NVarChar(50), data.CreatedBy);
        request.input('ModifiedBy', sql.NVarChar(50), data.ModifiedBy);
        request.input('EmployeeAskGuid', sql.UniqueIdentifier, data.EmployeeAskGuid);
        request.input('EmployeeAskName', sql.NVarChar(50), data.EmployeeAskName);
        request.input('GenitiveID', sql.NVarChar(50), data.GenitiveID);
        request.output('Error', sql.NVarChar(400));

        await request.execute('[HR].[SP_ESHR_Insert_ApplyLeaves]');

        const error = request.parameters.Error.value;

        if (error) {
            res.status(400).json({ success: false, message: error });
        } else {
            res.json({ success: true, message: 'Apply leave created successfully' });
        }
    } catch (err) {
        console.error('SP_ESHR_Insert_ApplyLeaves error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


router.get('/employee/:id', async (req, res) => {
    const employeeID = req.params.id;
    try {
        const pool = await hrpoolPromise;
        const result = await pool.request()
            .input('EmployeeID', sql.VarChar(20), employeeID)
            .execute('HR.SP_HR_GetEmployeeByID');

        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Lỗi khi gọi SP_HR_GetEmployeeByID:', err); // Log chi tiết lỗi
        res.status(500).json({ error: err.message }); // Trả lỗi cụ thể về frontend
    }
});

router.get('/stored-procedures', async (req, res) => {
    const schema = req.query.schema || 'dbo'; // mặc định schema là dbo
    try {
        const pool = await hrpoolPromise;
        const result = await pool.request().query(`
      SELECT SPECIFIC_NAME
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'PROCEDURE'
        AND ROUTINE_SCHEMA = '${schema}'
    `);

        res.json({ procedures: result.recordset.map(p => p.SPECIFIC_NAME) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/apply-leaves/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;

    try {
        const pool = await hrpoolPromise;

        const result = await pool.request()
            .input('EmployeeID', sql.VarChar(20), employeeId)
            .execute('HR.SP_HR_GetApplyLeavesByEmployeeID');

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (err) {
        console.error('Lỗi lấy danh sách phiếu nghỉ phép:', err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

router.post('/approve-leave', async (req, res) => {
    const { RowGuid, LoginName, Comment } = req.body;

    if (!RowGuid || !LoginName) {
        return res.status(400).json({ success: false, message: 'Thiếu RowGuid hoặc LoginName' });
    }

    try {
        const pool = await hrpoolPromise;
        const request = pool.request();

        request.input('Database', sql.NVarChar(255), 'Z76_HR');
        request.input('scheme', sql.NVarChar(255), 'HR');
        request.input('TableName', sql.NVarChar(255), 'ApplyLeaves');
        request.input('TableProcessName', sql.NVarChar(255), 'ApplyLeaveProcess');
        request.input('RowGuid', sql.UniqueIdentifier, RowGuid);
        request.input('LoginName', sql.NVarChar(50), LoginName);
        request.input('Comment', sql.NVarChar(500), Comment || 'duyệt');

        await request.execute('[HR].[SP_ESHR_Workflows_Approve]');

        res.json({ success: true, message: 'Phiếu đã được gửi duyệt thành công.' });
    } catch (err) {
        console.error('Lỗi khi duyệt phiếu:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/apply-leave-types", async (req, res) => {
    try {
        const pool = await hrpoolPromise;
        const result = await pool.request().query(`
            SELECT ApplyLeaveTypeID, ApplyLeaveTypeName 
            FROM HR.ApplyLeaveType
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error("Lỗi khi lấy ApplyLeaveType:", err);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

module.exports = router;