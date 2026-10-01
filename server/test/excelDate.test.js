const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExcelDate } = require('../utils/excelDate');

test('parses Excel serial dates without shifting through UTC', () => {
    assert.equal(parseExcelDate(46296), '2026-10-01');
    assert.equal(parseExcelDate(46356), '2026-11-30');
});

test('parses supported text dates and rejects invalid dates', () => {
    assert.equal(parseExcelDate('01/10/2026'), '2026-10-01');
    assert.equal(parseExcelDate('2026-10-01'), '2026-10-01');
    assert.equal(parseExcelDate('31/02/2026'), undefined);
    assert.equal(parseExcelDate(null), null);
});

test('uses local calendar fields for Date values', () => {
    assert.equal(parseExcelDate(new Date(2026, 9, 1)), '2026-10-01');
});
