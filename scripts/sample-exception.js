/**
 * SAMPLE — preview the new Exception layout.
 * Shows actual error messages from controller source code per test case.
 *
 * Generates: E:\SEP490\Sample_Exception_Preview.xlsx
 * with 2 sample sheets: register (auth) and createAmenity (amenities)
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DARK_BLUE = '003366';
const WHITE = 'FFFFFF';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BLUE } };
const WHITE_FONT = { color: { argb: WHITE }, bold: true, size: 10 };
const BOLD_FONT = { bold: true, size: 10 };
const NORMAL_FONT = { size: 10 };
const THIN_BORDER = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
};

// ── fillRow4 from approved layout ──
function fillRow4(ws, rowNum, tcStartCol, testCount, opts = {}) {
    const row = ws.getRow(rowNum);
    row.getCell(1).value = opts.a || '';
    row.getCell(1).border = THIN_BORDER;
    if (opts.aFill) row.getCell(1).fill = opts.aFill;
    if (opts.aFont) row.getCell(1).font = opts.aFont;
    row.getCell(2).value = opts.b || '';
    row.getCell(2).border = THIN_BORDER;
    if (opts.bFont) row.getCell(2).font = opts.bFont;
    if (opts.bFill) row.getCell(2).fill = opts.bFill;
    if (opts.bAlign) row.getCell(2).alignment = opts.bAlign;
    row.getCell(3).value = opts.c || '';
    row.getCell(3).border = THIN_BORDER;
    if (opts.cFont) row.getCell(3).font = opts.cFont;
    row.getCell(3).alignment = opts.cAlign || { horizontal: 'center', vertical: 'middle' };
    if (opts.cFill) row.getCell(3).fill = opts.cFill;
    row.getCell(4).value = opts.d || '';
    row.getCell(4).border = THIN_BORDER;
    if (opts.dFont) row.getCell(4).font = opts.dFont;
    row.getCell(4).alignment = opts.dAlign || { horizontal: 'right', vertical: 'middle' };
    if (opts.dFill) row.getCell(4).fill = opts.dFill;
    for (let i = 0; i < testCount; i++) {
        const cell = row.getCell(tcStartCol + i);
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (opts.tcValues && opts.tcValues[i] !== undefined) cell.value = opts.tcValues[i];
        if (opts.tcFont) cell.font = opts.tcFont;
    }
    return row;
}

// ══════════════════════════════════════════════════════════════════
// Extract error messages from controller source code per function
// ══════════════════════════════════════════════════════════════════
function extractErrorMessagesFromController(controllerPath, functionName) {
    const src = fs.readFileSync(controllerPath, 'utf8');
    const messages = []; // { status, message }

    // Find the function body
    // Pattern: async function funcName(req, res) { ... }
    const funcPattern = new RegExp(
        `(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`,
    );
    const funcMatch = funcPattern.exec(src);
    if (!funcMatch) return messages;

    // Extract the function body by tracking braces
    let depth = 0;
    let start = funcMatch.index + funcMatch[0].length - 1;
    let funcBody = '';
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') depth--;
        funcBody += src[i];
        if (depth === 0) break;
    }

    // 1) Template literals: message: `Tiện ích "${name}" đã tồn tại`
    const templateRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*`([^`]+)`/g;
    let match;
    const templateStatuses = new Set();
    while ((match = templateRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) {
            const msg = match[2].replace(/\$\{[^}]+\}/g, '*');
            messages.push({ status, message: msg });
            templateStatuses.add(`${status}:${match.index}`);
        }
    }

    // 2) Single/double quoted: message: 'Dữ liệu không hợp lệ'
    const msgRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*(['"])([^'"]+)\2/g;
    while ((match = msgRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) {
            messages.push({ status, message: match[3] });
        }
    }

    // 3) Dynamic: message: err.message || 'fallback'
    const catchMsgRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*(?:err|error)\.message(?:\s*\|\|\s*['"]([^'"]+)['"])?/g;
    while ((match = catchMsgRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) {
            messages.push({ status, message: match[2] || '(err.message)' });
        }
    }

    return messages;
}

// ══════════════════════════════════════════════════════════════════
// Match a test case to a specific error message from the controller
// ══════════════════════════════════════════════════════════════════
function matchTestToErrorMessage(testName, assertStatus, errorMessages) {
    if (!assertStatus || assertStatus < 400) return null;

    // Filter messages matching the asserted status
    const candidates = errorMessages.filter(m => m.status === assertStatus);
    if (candidates.length === 0) {
        // Fallback: generic message by status
        return `HTTP ${assertStatus}`;
    }
    if (candidates.length === 1) return candidates[0].message;

    // Multiple candidates for same status — try to match by test name keywords
    const lower = testName.toLowerCase();

    for (const c of candidates) {
        const msgLower = c.message.toLowerCase();
        // Keyword matching
        if (lower.includes('validate') && msgLower.includes('không hợp lệ')) return c.message;
        if (lower.includes('validation') && msgLower.includes('không hợp lệ')) return c.message;
        if (lower.includes('empty') && msgLower.includes('để trống')) return c.message;
        if (lower.includes('missing') && msgLower.includes('để trống')) return c.message;
        if (lower.includes('missing') && msgLower.includes('thiếu')) return c.message;
        if (lower.includes('long') && msgLower.includes('quá')) return c.message;
        if (lower.includes('100 char') && msgLower.includes('100')) return c.message;
        if (lower.includes('duplicate') && (msgLower.includes('đã tồn tại') || msgLower.includes('đã được sử dụng'))) return c.message;
        if (lower.includes('already') && (msgLower.includes('đã tồn tại') || msgLower.includes('đã được sử dụng'))) return c.message;
        if (lower.includes('not found') && msgLower.includes('không tìm thấy')) return c.message;
        if (lower.includes('not exist') && msgLower.includes('không tồn tại')) return c.message;
        if (lower.includes('db error') && (msgLower.includes('lỗi') || c.message.includes('(err.message)'))) return c.message;
        if (lower.includes('500') && (msgLower.includes('lỗi') || c.message.includes('(err.message)'))) return c.message;
        if (lower.includes('not logged') && msgLower.includes('chưa đăng nhập')) return c.message;
        if (lower.includes('wrong password') && msgLower.includes('không đúng')) return c.message;
        if (lower.includes('user not found') && msgLower.includes('không đúng')) return c.message;
        if (lower.includes('locked') && msgLower.includes('bị khóa')) return c.message;
        if (lower.includes('banned') && msgLower.includes('bị khóa')) return c.message;
        if (lower.includes('invalid token') && msgLower.includes('không hợp lệ')) return c.message;
        if (lower.includes('expired') && msgLower.includes('hết hạn')) return c.message;
        if (lower.includes('not the target') && msgLower.includes('quyền')) return c.message;
        if (lower.includes('forbidden') && msgLower.includes('quyền')) return c.message;
        if (lower.includes('self') && msgLower.includes('chính mình')) return c.message;
        if (lower.includes('invalid amount') && msgLower.includes('không hợp lệ')) return c.message;
        if (lower.includes('insufficient') && msgLower.includes('không đủ')) return c.message;
        if (lower.includes('latitude') && msgLower.includes('latitude')) return c.message;
        if (lower.includes('longitude') && msgLower.includes('longitude')) return c.message;
        if (lower.includes('address') && msgLower.includes('địa chỉ')) return c.message;
        if (lower.includes('linked') && msgLower.includes('liên kết')) return c.message;
        if (lower.includes('in use') && msgLower.includes('liên kết')) return c.message;
        if (lower.includes('no data') && msgLower.includes('không có dữ liệu')) return c.message;
        if (lower.includes('cannot send') && msgLower.includes('không thể')) return c.message;
        if (lower.includes('processed') && msgLower.includes('đã được xử lý')) return c.message;
        if (lower.includes('content') && msgLower.includes('nội dung')) return c.message;
        if (lower.includes('max') && msgLower.includes('tối đa')) return c.message;
        if (lower.includes('receiver') && msgLower.includes('người nhận')) return c.message;
    }

    // Default: return the first candidate
    return candidates[0].message;
}

async function main() {
    const wb = new ExcelJS.Workbook();
    const tcStart = 5;

    // ═══════════════════════════════════════════
    // Sheet 1: register (auth) — 5 tests
    // ═══════════════════════════════════════════
    const tests1 = [
        { name: 'should register successfully', status: 201 },
        { name: 'should return 400 on validation failure', status: 400 },
        { name: 'should return 409 when email already exists', status: 409 },
        { name: 'should return 500 on DB error', status: 500 },
        { name: 'should set role to LANDLORD when requested', status: 201 },
    ];
    const tc1 = tests1.length;

    const errMsgs1 = extractErrorMessagesFromController(
        path.join(__dirname, '..', 'controllers', 'auth.controller.js'),
        'register'
    );
    console.log('register error messages:', errMsgs1);

    const ws1 = wb.addWorksheet('register');
    ws1.getColumn(1).width = 14;
    ws1.getColumn(2).width = 20;
    ws1.getColumn(3).width = 22;
    ws1.getColumn(4).width = 38;
    for (let i = 0; i < tc1; i++) ws1.getColumn(tcStart + i).width = 5;

    // UTCID bar
    ws1.getRow(1).height = 80;
    for (let c = 1; c <= 4; c++) {
        ws1.getRow(1).getCell(c).fill = HEADER_FILL;
        ws1.getRow(1).getCell(c).border = THIN_BORDER;
    }
    tests1.forEach((_, i) => {
        const cell = ws1.getRow(1).getCell(tcStart + i);
        cell.value = `UTCID${String(i + 1).padStart(2, '0')}`;
        cell.fill = HEADER_FILL;
        cell.font = { ...WHITE_FONT, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90 };
        cell.border = THIN_BORDER;
    });

    let cur = 3;

    // ── Confirm section ──
    fillRow4(ws1, cur, tcStart, tc1, {
        a: 'Confirm', aFill: HEADER_FILL, aFont: WHITE_FONT,
        b: 'Return', bFont: BOLD_FONT,
    });
    cur++;

    // T row
    fillRow4(ws1, cur, tcStart, tc1, {
        d: 'T', dFont: BOLD_FONT,
        tcValues: tests1.map(t => t.status >= 200 && t.status < 300 ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur++;

    // F row
    fillRow4(ws1, cur, tcStart, tc1, {
        d: 'F', dFont: BOLD_FONT,
        tcValues: tests1.map(t => t.status >= 400 ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur++;

    // Exception O-mark row (summary)
    const exMap1 = new Map();
    tests1.forEach((t, i) => {
        if (t.status >= 400) {
            const msg = matchTestToErrorMessage(t.name, t.status, errMsgs1);
            if (msg) {
                if (!exMap1.has(msg)) exMap1.set(msg, []);
                exMap1.get(msg).push(i);
            }
        }
    });
    const allExIdx1 = new Set();
    for (const indices of exMap1.values()) indices.forEach(i => allExIdx1.add(i));
    fillRow4(ws1, cur, tcStart, tc1, {
        d: 'Exception', dAlign: { horizontal: 'right', vertical: 'middle' },
        tcValues: tests1.map((_, i) => allExIdx1.has(i) ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur++;

    // Exception header
    fillRow4(ws1, cur, tcStart, tc1, {
        b: 'Exception', bFont: BOLD_FONT,
    });
    cur++;

    // Individual exception messages
    for (const [msg, indices] of exMap1) {
        fillRow4(ws1, cur, tcStart, tc1, {
            d: `"${msg}"`, dFont: NORMAL_FONT, dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: tests1.map((_, i) => indices.includes(i) ? 'O' : ''),
            tcFont: { bold: true, size: 10 },
        });
        cur++;
    }

    // ═══════════════════════════════════════════
    // Sheet 2: createAmenity — 7 tests
    // ═══════════════════════════════════════════
    const tests2 = [
        { name: 'should create amenity', status: 201 },
        { name: 'should reject empty name', status: 400 },
        { name: 'should reject missing name', status: 400 },
        { name: 'should reject name longer than 100 chars', status: 400 },
        { name: 'should trim name', status: 201 },
        { name: 'should return 409 on duplicate', status: 409 },
        { name: 'should return 500 on DB error', status: 500 },
    ];
    const tc2 = tests2.length;

    const errMsgs2 = extractErrorMessagesFromController(
        path.join(__dirname, '..', 'controllers', 'amenities.controller.js'),
        'createAmenity'
    );
    console.log('createAmenity error messages:', errMsgs2);

    const ws2 = wb.addWorksheet('createAmenity');
    ws2.getColumn(1).width = 14;
    ws2.getColumn(2).width = 20;
    ws2.getColumn(3).width = 22;
    ws2.getColumn(4).width = 38;
    for (let i = 0; i < tc2; i++) ws2.getColumn(tcStart + i).width = 5;

    // UTCID bar
    ws2.getRow(1).height = 80;
    for (let c = 1; c <= 4; c++) {
        ws2.getRow(1).getCell(c).fill = HEADER_FILL;
        ws2.getRow(1).getCell(c).border = THIN_BORDER;
    }
    tests2.forEach((_, i) => {
        const cell = ws2.getRow(1).getCell(tcStart + i);
        cell.value = `UTCID${String(i + 1).padStart(2, '0')}`;
        cell.fill = HEADER_FILL;
        cell.font = { ...WHITE_FONT, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90 };
        cell.border = THIN_BORDER;
    });

    let cur2 = 3;

    // ── Confirm section ──
    fillRow4(ws2, cur2, tcStart, tc2, {
        a: 'Confirm', aFill: HEADER_FILL, aFont: WHITE_FONT,
        b: 'Return', bFont: BOLD_FONT,
    });
    cur2++;

    fillRow4(ws2, cur2, tcStart, tc2, {
        d: 'T', dFont: BOLD_FONT,
        tcValues: tests2.map(t => t.status >= 200 && t.status < 300 ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur2++;

    fillRow4(ws2, cur2, tcStart, tc2, {
        d: 'F', dFont: BOLD_FONT,
        tcValues: tests2.map(t => t.status >= 400 ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur2++;

    // Exception O-mark row
    const exMap2 = new Map();
    tests2.forEach((t, i) => {
        if (t.status >= 400) {
            const msg = matchTestToErrorMessage(t.name, t.status, errMsgs2);
            if (msg) {
                if (!exMap2.has(msg)) exMap2.set(msg, []);
                exMap2.get(msg).push(i);
            }
        }
    });
    const allExIdx2 = new Set();
    for (const indices of exMap2.values()) indices.forEach(i => allExIdx2.add(i));
    fillRow4(ws2, cur2, tcStart, tc2, {
        d: 'Exception', dAlign: { horizontal: 'right', vertical: 'middle' },
        tcValues: tests2.map((_, i) => allExIdx2.has(i) ? 'O' : ''),
        tcFont: { bold: true, size: 10 },
    });
    cur2++;

    // Exception header
    fillRow4(ws2, cur2, tcStart, tc2, {
        b: 'Exception', bFont: BOLD_FONT,
    });
    cur2++;

    // Individual exception messages
    for (const [msg, indices] of exMap2) {
        fillRow4(ws2, cur2, tcStart, tc2, {
            d: `"${msg}"`, dFont: NORMAL_FONT, dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: tests2.map((_, i) => indices.includes(i) ? 'O' : ''),
            tcFont: { bold: true, size: 10 },
        });
        cur2++;
    }

    // Save
    const outPath = path.join(__dirname, '..', '..', 'Sample_Exception_Preview.xlsx');
    await wb.xlsx.writeFile(outPath);
    console.log(`\n✅ Sample generated: ${outPath}`);
    console.log(`   Sheet 1: register — ${tc1} tests, ${exMap1.size} exception messages`);
    console.log(`   Sheet 2: createAmenity — ${tc2} tests, ${exMap2.size} exception messages`);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
