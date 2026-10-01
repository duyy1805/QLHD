const XLSX = require('xlsx');

function formatDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExcelDate(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === 'number') {
        const parts = XLSX.SSF.parse_date_code(value);
        return parts ? formatDateParts(parts.y, parts.m, parts.d) : undefined;
    }

    const text = String(value).trim();
    const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    const vietnamese = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
    if (iso) return formatDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (vietnamese) return formatDateParts(Number(vietnamese[3]), Number(vietnamese[2]), Number(vietnamese[1]));
    return undefined;
}

module.exports = { parseExcelDate };
