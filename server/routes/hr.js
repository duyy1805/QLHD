const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const fs = require('fs');
const path = require('path');
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

        await request.execute('[HR].[SP_ESHR_Workflows_Approve1]');

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

function writeCheckInLog(fileName, data) {
    try {
        const logDir = path.join(process.cwd(), 'logs', 'check-in-machine');

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const now = new Date();

        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');

        const logFile = path.join(logDir, `${fileName}-${yyyy}${mm}${dd}.txt`);

        const content =
            `\n================ ${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} ================\n` +
            JSON.stringify(data, null, 2) +
            `\n`;

        fs.appendFileSync(logFile, content, 'utf8');
    } catch (err) {
        console.error('Ghi log lỗi:', err.message);
    }
}

/**
 * Parse ngày từ máy chấm công.
 *
 * Nhận được các dạng:
 * - 2026-04-01 17:51:32
 * - 2026-04-1 17:51:32
 * - 2026-04-1 17:51:32 PM
 * - 2026-04-01 05:51:32 PM
 */
function parseMachineDateTime(value) {
    if (!value) return null;

    let s = String(value).trim();

    // Chuẩn hóa khoảng trắng
    s = s.replace(/\s+/g, ' ');

    const match = s.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\s*(AM|PM))?$/i
    );

    if (!match) return null;

    let [, year, month, day, hour, minute, second, ampm] = match;

    year = Number(year);
    month = Number(month);
    day = Number(day);
    hour = Number(hour);
    minute = Number(minute);
    second = Number(second);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        !Number.isInteger(second)
    ) {
        return null;
    }

    // Nếu có AM/PM và giờ là dạng 12h thì xử lý.
    // Nếu giờ là 17 PM thì coi là giờ 24h, bỏ qua PM.
    if (ampm) {
        ampm = ampm.toUpperCase();

        if (hour >= 1 && hour <= 12) {
            if (ampm === 'PM' && hour < 12) {
                hour += 12;
            }

            if (ampm === 'AM' && hour === 12) {
                hour = 0;
            }
        }
    }

    const dt = new Date(year, month - 1, day, hour, minute, second);

    // Check ngày sai kiểu 2026-02-31
    if (
        dt.getFullYear() !== year ||
        dt.getMonth() !== month - 1 ||
        dt.getDate() !== day ||
        dt.getHours() !== hour ||
        dt.getMinutes() !== minute ||
        dt.getSeconds() !== second
    ) {
        return null;
    }

    return dt;
}

router.post('/check-in-machine', async (req, res) => {
    const requests = req.body;

    writeCheckInLog('request', {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        body: requests
    });

    if (!Array.isArray(requests) || requests.length === 0) {
        const responseData = {
            statusCode: 400,
            message: 'Danh sách chấm công trống'
        };

        writeCheckInLog('response', responseData);

        return res.status(400).json(responseData);
    }

    const results = [];

    try {
        const pool = await hrpoolPromise;

        for (const request of requests) {
            /**
             * BƯỚC 1: XỬ LÝ MACHINE NUMBER
             *
             * Nhận được:
             * MachineNumber: 1       => "1"
             * MachineNumber: "1"     => "1"
             * MachineNumber: "KM01"  => "KM01"
             * MachineNumber: ""      => null
             * MachineNumber: null    => null
             */
            const rawMachine =
                request.MachineNumber !== undefined && request.MachineNumber !== null
                    ? String(request.MachineNumber).trim()
                    : '';

            const machineNumberForDb = rawMachine !== '' ? rawMachine : null;
            const machineNumberForResult = rawMachine !== '' ? rawMachine : null;

            const result = {
                MachineNumber: machineNumberForResult,
                IndRegID: request.IndRegID,
                DateTimeRecord: request.DateTimeRecord,
                errorCode: 0,
                Message: ''
            };

            try {
                /**
                 * BƯỚC 2: VALIDATE IndRegID
                 */
                const indRegID = Number(request.IndRegID);

                if (!Number.isInteger(indRegID)) {
                    result.errorCode = 400;
                    result.Message = 'IndRegID không hợp lệ';

                    writeCheckInLog('error', {
                        type: 'VALIDATION_ERROR',
                        message: result.Message,
                        request
                    });

                    results.push(result);
                    continue;
                }

                /**
                 * BƯỚC 3: VALIDATE DateTimeRecord
                 */
                if (!request.DateTimeRecord || String(request.DateTimeRecord).trim() === '') {
                    result.errorCode = 400;
                    result.Message = 'DateTimeRecord không được để trống';

                    writeCheckInLog('error', {
                        type: 'VALIDATION_ERROR',
                        message: result.Message,
                        request
                    });

                    results.push(result);
                    continue;
                }

                const dt = parseMachineDateTime(request.DateTimeRecord);

                if (!dt) {
                    result.errorCode = 400;
                    result.Message = 'Định dạng ngày tháng không hợp lệ. Ví dụ đúng: 2026-04-01 17:51:32';

                    writeCheckInLog('error', {
                        type: 'DATE_PARSE_ERROR',
                        message: result.Message,
                        DateTimeRecord: request.DateTimeRecord,
                        request
                    });

                    results.push(result);
                    continue;
                }

                /**
                 * BƯỚC 4: LẤY THÔNG TIN NHÂN VIÊN
                 */
                const employeeId = 'NV' + String(indRegID).padStart(6, '0');

                const empResult = await pool.request()
                    .input('EmployeeID', sql.NVarChar, employeeId)
                    .query(`
                        SELECT EmployeeGuid, FullName, DepartmentGuid
                        FROM HR.Employees
                        WHERE EmployeeID = @EmployeeID
                    `);

                if (empResult.recordset.length === 0) {
                    result.errorCode = 404;
                    result.Message = `Không tìm thấy nhân viên mã: ${employeeId}`;

                    writeCheckInLog('error', {
                        type: 'EMPLOYEE_NOT_FOUND',
                        message: result.Message,
                        employeeId,
                        request
                    });

                    results.push(result);
                    continue;
                }

                const employee = empResult.recordset[0];

                const employeeGuid = employee.EmployeeGuid ? String(employee.EmployeeGuid) : '';
                const employeeName = employee.FullName ? String(employee.FullName) : '';
                const departmentGuid = employee.DepartmentGuid ? String(employee.DepartmentGuid) : '';

                /**
                 * BƯỚC 5: CHUẨN BỊ THỜI GIAN CHO STORED
                 */
                const year = dt.getFullYear();
                const month = String(dt.getMonth() + 1).padStart(2, '0');
                const day = String(dt.getDate()).padStart(2, '0');

                const hour = String(dt.getHours()).padStart(2, '0');
                const minute = String(dt.getMinutes()).padStart(2, '0');
                const second = String(dt.getSeconds()).padStart(2, '0');

                const dateTimeRecordInt = Number(`${year}${month}${day}`);
                const dateOnly = `${day}/${month}/${year}`;
                const timeOnly = `${hour}:${minute}:${second}`;
                const checkTime = dt.getHours() < 12 ? 'AM' : 'PM';

                /**
                 * BƯỚC 6: XỬ LÝ IP
                 */
                const ipMachine = request.IPMachine || request.IPMaChine || '';
                const ipPort = Number(request.IPPort) || 0;

                /**
                 * BƯỚC 7: GỌI STORED HR.sp_CheckIn_Machine
                 */
                const storedParams = {
                    TimeKeepingID: indRegID,
                    EmployeeGuid: employeeGuid,
                    EmployeeID: employeeId,
                    EmployeeName: employeeName,
                    DateTimeRecord: dateTimeRecordInt,
                    DateOnlyRecord: dateOnly,
                    TimeOnlyRecord: timeOnly,
                    CheckTime: checkTime,
                    MachineNumber: machineNumberForDb,
                    IPMachine: ipMachine,
                    IPPort: ipPort,
                    DepartmentGuid: departmentGuid
                };

                writeCheckInLog('stored-params', storedParams);

                await pool.request()
                    .input('TimeKeepingID', sql.Int, indRegID)
                    .input('EmployeeGuid', sql.NVarChar, employeeGuid)
                    .input('EmployeeID', sql.NVarChar, employeeId)
                    .input('EmployeeName', sql.NVarChar, employeeName)

                    .input('DateTimeRecord', sql.Int, dateTimeRecordInt)
                    .input('DateOnlyRecord', sql.NVarChar, dateOnly)
                    .input('TimeOnlyRecord', sql.NVarChar, timeOnly)
                    .input('CheckTime', sql.NVarChar, checkTime)

                    // Quan trọng: MachineNumber luôn là string hoặc null
                    .input('MachineNumber', sql.NVarChar, machineNumberForDb)

                    .input('IPMachine', sql.NVarChar, ipMachine)
                    .input('IPPort', sql.Int, ipPort)
                    .input('DepartmentGuid', sql.NVarChar, departmentGuid)
                    .execute('HR.sp_CheckIn_Machine');

                result.errorCode = 200;
                result.Message = 'Chấm công thành công';

                writeCheckInLog('success', {
                    message: result.Message,
                    request,
                    storedParams
                });
            } catch (err) {
                result.errorCode = 500;
                result.Message = 'Lỗi hệ thống: ' + err.message;

                writeCheckInLog('error', {
                    type: 'PROCESS_ITEM_ERROR',
                    message: err.message,
                    stack: err.stack,
                    request
                });
            }

            results.push(result);
        }

        const responseData = {
            errorCode: 200,
            total: results.length,
            successCount: results.filter(x => x.errorCode === 200).length,
            failCount: results.filter(x => x.errorCode !== 200).length,
            details: results
        };

        writeCheckInLog('response', responseData);

        return res.json(responseData);
    } catch (err) {
        const responseData = {
            errorCode: 500,
            message: 'Lỗi kết nối hoặc xử lý DB',
            detail: err.message
        };

        writeCheckInLog('fatal-error', {
            message: err.message,
            stack: err.stack
        });

        return res.status(500).json(responseData);
    }
});

module.exports = router;