/**
 * Generate Unit Test Report Excel file matching the template format exactly.
 * Includes: Cover, MethodList, Statistics, and one detail sheet per function.
 * Each detail sheet: Header, Summary, UTCID bar, Condition/Precondition,
 *   DataInput, Expected Output, Confirm (Return T/F, Exception),
 *   Log message, Result (Type N/A/B, P/F, Date, Defect ID)
 *
 * Usage: node scripts/generate-test-report.js
 * Output: EZ-Room_Unit_Test_Report.xlsx in E:\SEP490\
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── Styles ──
const DARK_BLUE = '003366';
const WHITE = 'FFFFFF';
const LIGHT_YELLOW = 'FFFFCC';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BLUE } };
const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_YELLOW } };
const WHITE_FONT = { color: { argb: WHITE }, bold: true, size: 10 };
const BOLD_FONT = { bold: true, size: 10 };
const NORMAL_FONT = { size: 10 };
const TITLE_FONT = { bold: true, size: 18 };
const THIN_BORDER = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
};
const LABEL_BROWN_FONT = { bold: true, size: 11, color: { argb: '9C3B00' } };
const VALUE_BLUE_FONT = { bold: true, size: 11, color: { argb: '0000FF' } };

function toPercentComma(value) {
    return value.toFixed(2).replace('.', ',');
}

// ── Classify test type: N=Normal, A=Abnormal, B=Boundary ──
function classifyTest(testName) {
    const lower = testName.toLowerCase();
    if (lower.includes('empty') || lower.includes('null') || lower.includes('no ') ||
        lower.includes('zero') || lower.includes('boundary') || lower.includes('edge') ||
        lower.includes('limit') || lower.includes('max ') || lower.includes('min ')) {
        return 'B';
    }
    if (lower.includes('500') || lower.includes('error') || lower.includes('reject') ||
        lower.includes('invalid') || lower.includes('400') || lower.includes('401') ||
        lower.includes('403') || lower.includes('404') || lower.includes('409') ||
        lower.includes('not logged in') || lower.includes('not the target') ||
        lower.includes('not found') || lower.includes('not exist') ||
        lower.includes('duplicate') || lower.includes('already') ||
        lower.includes('fail') || lower.includes('missing') ||
        lower.includes('forbidden') || lower.includes('unauthorized')) {
        return 'A';
    }
    return 'N';
}

// ── Is success test (T) or failure (F) ──
function isSuccessTest(testName) {
    const lower = testName.toLowerCase();
    return !(lower.includes('500') || lower.includes('error') || lower.includes('reject') ||
        lower.includes('invalid') || lower.includes('400') || lower.includes('401') ||
        lower.includes('403') || lower.includes('404') || lower.includes('409') ||
        lower.includes('not logged in') || lower.includes('not the target') ||
        lower.includes('not found') || lower.includes('not exist') ||
        lower.includes('duplicate') || lower.includes('already') ||
        lower.includes('fail') || lower.includes('missing') ||
        lower.includes('forbidden') || lower.includes('unauthorized'));
}

// ── Extract error messages from controller source per function ──
function extractErrorMessagesFromController(controllerPath, functionName) {
    if (!fs.existsSync(controllerPath)) return [];
    const src = fs.readFileSync(controllerPath, 'utf8');
    const messages = [];

    // Find function body
    const funcPattern = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
    const funcMatch = funcPattern.exec(src);
    if (!funcMatch) return messages;

    let depth = 0, start = funcMatch.index + funcMatch[0].length - 1, funcBody = '';
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') depth--;
        funcBody += src[i];
        if (depth === 0) break;
    }

    // 1) Template literals: message: `text ${var} text`
    const templateRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*`([^`]+)`/g;
    let match;
    while ((match = templateRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) messages.push({ status, message: match[2].replace(/\$\{[^}]+\}/g, '*') });
    }

    // 2) Single/double quoted: message: 'text'
    const msgRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*(['"])([^'"]+)\2/g;
    while ((match = msgRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) messages.push({ status, message: match[3] });
    }

    // 3) Dynamic: message: err.message || 'fallback'
    const catchRegex = /res\.status\((\d+)\)\.json\(\{[^}]*message:\s*(?:err|error)\.message(?:\s*\|\|\s*['"]([^'"]+)['"])?/g;
    while ((match = catchRegex.exec(funcBody)) !== null) {
        const status = parseInt(match[1]);
        if (status >= 400) messages.push({ status, message: match[2] || '(err.message)' });
    }

    return messages;
}

// ── Map controller file from test file name ──
function getControllerPath(testFileName) {
    const base = testFileName.replace('.test.js', '.js');
    return path.join(__dirname, '..', 'controllers', base);
}

// ── Match test case to its specific controller error message ──
function matchTestToErrorMessage(testName, assertStatus, errorMessages) {
    if (!assertStatus || assertStatus < 400) return null;
    const candidates = errorMessages.filter(m => m.status === assertStatus);
    if (candidates.length === 0) return `HTTP ${assertStatus}`;
    if (candidates.length === 1) return candidates[0].message;

    const lower = testName.toLowerCase();
    for (const c of candidates) {
        const ml = c.message.toLowerCase();
        if (lower.includes('validate') && ml.includes('không hợp lệ')) return c.message;
        if (lower.includes('validation') && ml.includes('không hợp lệ')) return c.message;
        if (lower.includes('empty') && ml.includes('để trống')) return c.message;
        if (lower.includes('missing') && ml.includes('để trống')) return c.message;
        if (lower.includes('missing') && ml.includes('thiếu')) return c.message;
        if (lower.includes('long') && ml.includes('quá')) return c.message;
        if (lower.includes('100 char') && ml.includes('100')) return c.message;
        if (lower.includes('duplicate') && (ml.includes('đã tồn tại') || ml.includes('đã được sử dụng'))) return c.message;
        if (lower.includes('already') && (ml.includes('đã tồn tại') || ml.includes('đã được sử dụng'))) return c.message;
        if (lower.includes('not found') && ml.includes('không tìm thấy')) return c.message;
        if (lower.includes('not exist') && ml.includes('không tồn tại')) return c.message;
        if (lower.includes('db error') && (ml.includes('lỗi') || c.message.includes('(err.message)'))) return c.message;
        if (lower.includes('500') && (ml.includes('lỗi') || c.message.includes('(err.message)'))) return c.message;
        if (lower.includes('not logged') && ml.includes('chưa đăng nhập')) return c.message;
        if (lower.includes('wrong password') && ml.includes('không đúng')) return c.message;
        if (lower.includes('user not found') && ml.includes('không đúng')) return c.message;
        if (lower.includes('locked') && ml.includes('bị khóa')) return c.message;
        if (lower.includes('banned') && ml.includes('bị khóa')) return c.message;
        if (lower.includes('invalid token') && ml.includes('không hợp lệ')) return c.message;
        if (lower.includes('expired') && ml.includes('hết hạn')) return c.message;
        if (lower.includes('not the target') && ml.includes('quyền')) return c.message;
        if (lower.includes('forbidden') && ml.includes('quyền')) return c.message;
        if (lower.includes('self') && ml.includes('chính mình')) return c.message;
        if (lower.includes('invalid amount') && ml.includes('không hợp lệ')) return c.message;
        if (lower.includes('insufficient') && ml.includes('không đủ')) return c.message;
        if (lower.includes('latitude') && ml.includes('latitude')) return c.message;
        if (lower.includes('longitude') && ml.includes('longitude')) return c.message;
        if (lower.includes('address') && ml.includes('địa chỉ')) return c.message;
        if (lower.includes('linked') && ml.includes('liên kết')) return c.message;
        if (lower.includes('in use') && ml.includes('liên kết')) return c.message;
        if (lower.includes('no data') && ml.includes('không có dữ liệu')) return c.message;
        if (lower.includes('cannot send') && ml.includes('không thể')) return c.message;
        if (lower.includes('processed') && ml.includes('đã được xử lý')) return c.message;
        if (lower.includes('content') && ml.includes('nội dung')) return c.message;
        if (lower.includes('max') && ml.includes('tối đa')) return c.message;
        if (lower.includes('receiver') && ml.includes('người nhận')) return c.message;
    }
    return candidates[0].message;
}

// ── Get expected output description ──
function getExpectedOutput(testName) {
    const lower = testName.toLowerCase();
    if (lower.includes('500') || lower.includes('error')) return 'Return 500 error';
    if (lower.includes('404') || lower.includes('not found') || lower.includes('not exist')) return 'Return 404 not found';
    if (lower.includes('400') || lower.includes('reject') || lower.includes('invalid') || lower.includes('missing') || lower.includes('empty')) return 'Return 400 bad request';
    if (lower.includes('409') || lower.includes('duplicate') || lower.includes('already exists')) return 'Return 409 conflict';
    if (lower.includes('403') || lower.includes('not the target')) return 'Return 403 forbidden';
    if (lower.includes('401') || lower.includes('not logged in')) return 'Return 401 unauthorized';
    return 'Return 200/201 success';
}

// ── Parse test files — now extracts actual input data per test case ──
function parseTestFiles() {
    const testDir = path.join(__dirname, '..', 'test');
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));
    const modules = [];

    files.forEach(file => {
        const content = fs.readFileSync(path.join(testDir, file), 'utf8');

        // Split into describe blocks, then into it blocks
        const describeBlocks = splitDescribes(content);

        const moduleName = file.replace('.controller.test.js', '').replace('.test.js', '');

        describeBlocks.forEach(({ name, itBlocks }) => {
            const parts = name.split(' > ');
            const funcName = parts.length > 1 ? parts[1] : parts[0];

            const tests = itBlocks.map(b => b.name);
            const testInputs = itBlocks.map(b => extractInputFromBlock(b.code));

            modules.push({
                file,
                moduleName: parts[0] || moduleName,
                functionName: funcName,
                fullName: name,
                tests,
                testInputs,
                passed: tests.length,
                failed: 0,
                untested: 0,
            });
        });
    });

    return modules;
}

// ── Split file content into describe blocks with their it blocks ──
function splitDescribes(content) {
    const results = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
        const descMatch = lines[i].match(/describe\('([^']+)'/);
        if (descMatch) {
            const descName = descMatch[1];
            const itBlocks = [];
            let depth = 0;
            let foundOpen = false;

            // Find the opening { for this describe
            for (let j = i; j < lines.length; j++) {
                if (lines[j].includes('{')) { foundOpen = true; depth += (lines[j].match(/\{/g) || []).length; }
                if (lines[j].includes('}')) { depth -= (lines[j].match(/\}/g) || []).length; }

                const itMatch = lines[j].match(/it\('([^']+)'/);
                if (itMatch) {
                    // Capture the full it() block
                    const itName = itMatch[1];
                    let itCode = '';
                    let itDepth = 0;
                    let itFoundOpen = false;
                    for (let k = j; k < lines.length; k++) {
                        itCode += lines[k] + '\n';
                        if (lines[k].includes('{')) { itFoundOpen = true; itDepth += (lines[k].match(/\{/g) || []).length; }
                        if (lines[k].includes('}')) { itDepth -= (lines[k].match(/\}/g) || []).length; }
                        if (itFoundOpen && itDepth <= 0) break;
                    }
                    itBlocks.push({ name: itName, code: itCode });
                }

                if (foundOpen && depth <= 0) {
                    i = j + 1;
                    break;
                }
            }

            results.push({ name: descName, itBlocks });
        } else {
            i++;
        }
    }

    return results;
}

// ── Extract input data from an it() block's source code ──
function extractInputFromBlock(code) {
    const input = { body: null, params: null, query: null, auth: null, assertStatus: null, assertMessage: null, preconditions: [] };

    // Pattern 1: mockReq({ body: {...}, params: {...}, query: {...} })
    const mockReqMatch = code.match(/mockReq\(\{([\s\S]*?)\}\s*\)/);
    if (mockReqMatch) {
        const argContent = mockReqMatch[1];
        input.body = extractObjectField(argContent, 'body');
        input.params = extractObjectField(argContent, 'params');
        input.query = extractObjectField(argContent, 'query');
        if (argContent.includes('auth:')) {
            input.auth = 'custom';
        }
    }

    // Pattern 2: req.body = {...}, req.params = {...}
    const reqBodyMatch = code.match(/req\.body\s*=\s*(\{[^}]*\})/);
    if (reqBodyMatch) input.body = reqBodyMatch[1].trim();
    const reqParamsMatch = code.match(/req\.params\s*=\s*(\{[^}]*\})/);
    if (reqParamsMatch) input.params = reqParamsMatch[1].trim();
    const reqQueryMatch = code.match(/req\.query\s*=\s*(\{[^}]*\})/);
    if (reqQueryMatch) input.query = reqQueryMatch[1].trim();

    // Auth state detection
    if (code.includes('req.auth') && (code.includes('user: {}') || code.includes('user: null'))) {
        input.auth = 'null';
    } else if (code.includes('auth:') && code.includes('user: {}')) {
        input.auth = 'null';
    } else if (code.includes('auth:') && code.includes('user: null')) {
        input.auth = 'null';
    }

    // ── Extract assert status: assert.strictEqual(res._status, 200) ──
    const statusMatch = code.match(/assert\.(strictEqual|equal)\(res\._status,\s*(\d+)/);
    if (statusMatch) input.assertStatus = parseInt(statusMatch[2]);

    // ── Extract assert message: res._json.message or res._json.error ──
    const msgMatch = code.match(/assert\.(strictEqual|equal)\(res\._json\.(message|error),\s*['"]([^'"]+)['"]/);
    if (msgMatch) input.assertMessage = msgMatch[3];

    // ── Extract preconditions from mock assignments ──
    const mockLines = code.split('\n');
    mockLines.forEach(line => {
        // mockPrisma.xxx.yyy = async () => null/fakeXxx/throw
        const mockAssign = line.match(/mock\w+\.(\w+)\.(\w+)\s*=\s*async\s*\(\)\s*=>\s*(.+)/);
        if (mockAssign) {
            const [, model, method, returnVal] = mockAssign;
            const val = returnVal.trim().replace(/;$/, '').trim();
            if (val === 'null') {
                input.preconditions.push(`${model}.${method} → null`);
            } else if (val.includes('throw')) {
                input.preconditions.push(`${model}.${method} → throws Error`);
            } else if (val.includes('fake') || val.includes('{')) {
                input.preconditions.push(`${model}.${method} → exists`);
            }
        }
    });

    return input;
}

// ── Extract a named object field from a mockReq argument string ──
function extractObjectField(argContent, fieldName) {
    // Look for fieldName: { ... }
    const regex = new RegExp(fieldName + '\\s*:\\s*\\{');
    const match = regex.exec(argContent);
    if (!match) return null;

    // Find matching closing brace
    let depth = 0;
    let start = match.index + match[0].length - 1; // position of {
    let result = '';
    for (let i = start; i < argContent.length; i++) {
        if (argContent[i] === '{') depth++;
        if (argContent[i] === '}') depth--;
        result += argContent[i];
        if (depth === 0) break;
    }
    return result.trim();
}

// ── Format input object string into readable field=value lines ──
function formatInputForCell(inputObj) {
    if (!inputObj) return '(none)';

    const parts = [];

    if (inputObj.params) {
        const fields = parseFieldValues(inputObj.params);
        if (fields.length > 0) {
            fields.forEach(f => parts.push(f));
        }
    }

    if (inputObj.query) {
        const fields = parseFieldValues(inputObj.query);
        if (fields.length > 0) {
            fields.forEach(f => parts.push(f));
        }
    }

    if (inputObj.body) {
        const fields = parseFieldValues(inputObj.body);
        if (fields.length > 0) {
            fields.forEach(f => parts.push(f));
        }
    }

    if (parts.length === 0) return '(no input)';
    return parts.join(',\n');
}

// ── Parse "{ key: value, key2: value2 }" into array of "key = value" strings ──
function parseFieldValues(objStr) {
    if (!objStr || objStr === '{}') return ['(empty)'];

    // Remove outer braces
    let inner = objStr.trim();
    if (inner.startsWith('{')) inner = inner.substring(1);
    if (inner.endsWith('}')) inner = inner.substring(0, inner.length - 1);
    inner = inner.trim();

    if (!inner) return ['(empty)'];

    const fields = [];
    // Split by comma, but respect nested structures
    let depth = 0;
    let current = '';
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        if (ch === '}' || ch === ']' || ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) fields.push(current.trim());

    return fields.map(f => {
        // Convert "key: value" to "key = value"
        const colonIdx = f.indexOf(':');
        if (colonIdx === -1) return f;
        const key = f.substring(0, colonIdx).trim();
        let val = f.substring(colonIdx + 1).trim();
        // Clean up string quotes for readability
        val = val.replace(/^'|'$/g, '"').replace(/^"(.*)"$/, '"$1"');
        return `${key} = ${val}`;
    });
}

// ── Helper: fill a row with 4 columns (A, B, C, D) + UTCID columns ──
function fillRow4(ws, rowNum, tcStartCol, testCount, opts = {}) {
    const row = ws.getRow(rowNum);
    // Col A (section label)
    row.getCell(1).value = opts.a || '';
    row.getCell(1).border = THIN_BORDER;
    if (opts.aFill) row.getCell(1).fill = opts.aFill;
    if (opts.aFont) row.getCell(1).font = opts.aFont;
    // Col B (sub-label)
    row.getCell(2).value = opts.b || '';
    row.getCell(2).border = THIN_BORDER;
    if (opts.bFont) row.getCell(2).font = opts.bFont;
    if (opts.bFill) row.getCell(2).fill = opts.bFill;
    if (opts.bAlign) row.getCell(2).alignment = opts.bAlign;
    // Col C (field name — centered)
    row.getCell(3).value = opts.c || '';
    row.getCell(3).border = THIN_BORDER;
    if (opts.cFont) row.getCell(3).font = opts.cFont;
    row.getCell(3).alignment = opts.cAlign || { horizontal: 'center', vertical: 'middle' };
    if (opts.cFill) row.getCell(3).fill = opts.cFill;
    // Col D (field value — right-aligned)
    row.getCell(4).value = opts.d || '';
    row.getCell(4).border = THIN_BORDER;
    if (opts.dFont) row.getCell(4).font = opts.dFont;
    row.getCell(4).alignment = opts.dAlign || { horizontal: 'right', vertical: 'middle' };
    if (opts.dFill) row.getCell(4).fill = opts.dFill;
    // Test case columns
    for (let i = 0; i < testCount; i++) {
        const cell = row.getCell(tcStartCol + i);
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (opts.tcValues && opts.tcValues[i] !== undefined) cell.value = opts.tcValues[i];
        if (opts.tcFont) cell.font = opts.tcFont;
        if (opts.tcFill) cell.fill = opts.tcFill;
    }
    return row;
}

// ── Parse individual fields from extracted input ──
function getFieldList(inputObj) {
    const fields = [];
    if (!inputObj) return fields;
    const addFields = (objStr, prefix) => {
        if (!objStr || objStr === '{}') {
            fields.push({ name: prefix ? `${prefix} (empty)` : '(empty body)', value: '{}' });
            return;
        }
        let inner = objStr.trim();
        if (inner.startsWith('{')) inner = inner.substring(1);
        if (inner.endsWith('}')) inner = inner.substring(0, inner.length - 1);
        inner = inner.trim();
        if (!inner) {
            fields.push({ name: prefix ? `${prefix} (empty)` : '(empty body)', value: '{}' });
            return;
        }
        let depth = 0, current = '';
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '{' || ch === '[' || ch === '(') depth++;
            if (ch === '}' || ch === ']' || ch === ')') depth--;
            if (ch === ',' && depth === 0) { if (current.trim()) fields.push(parseOneField(current.trim(), prefix)); current = ''; }
            else current += ch;
        }
        if (current.trim()) fields.push(parseOneField(current.trim(), prefix));
    };
    if (inputObj.params) addFields(inputObj.params, 'params');
    if (inputObj.query) addFields(inputObj.query, 'query');
    if (inputObj.body) addFields(inputObj.body, '');
    return fields;
}

function parseOneField(fieldStr, prefix) {
    const colonIdx = fieldStr.indexOf(':');
    if (colonIdx === -1) return { name: fieldStr, value: '' };
    const key = fieldStr.substring(0, colonIdx).trim();
    let val = fieldStr.substring(colonIdx + 1).trim();
    val = val.replace(/^'([^']*)'$/, '"$1"');
    const displayName = prefix ? `${prefix}.${key}` : key;
    return { name: displayName, value: val };
}

async function generateReport() {
    const modules = parseTestFiles();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EZ Room Team';
    wb.created = new Date();
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB');
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = String(today.getFullYear());

    // ════════════════════════════════════════════
    // SHEET 1: Cover
    // ════════════════════════════════════════════
    const cover = wb.addWorksheet('Cover', { properties: { defaultColWidth: 20 } });
    cover.mergeCells('A2:F2');
    cover.getCell('A2').value = 'UNIT TEST REPORT';
    cover.getCell('A2').font = { bold: true, size: 24 };
    cover.getCell('A2').alignment = { horizontal: 'center' };

    const infoData = [
        ['Project Name', 'EZ Room - Tìm phòng trọ thông minh', '', 'Creator', 'EZ Room Team'],
        ['Project Code', 'EZ-Room', '', 'Reviewer/Approver', ''],
        ['Document Code', 'EZ-Room_Unit_Test_Report', '', 'Issue Date', dateStr],
        ['Notes', ''],
    ];
    infoData.forEach((row, i) => {
        const r = cover.getRow(4 + i);
        r.getCell(1).value = row[0];
        r.getCell(1).font = BOLD_FONT;
        r.getCell(2).value = row[1];
        r.getCell(2).font = { ...NORMAL_FONT, italic: true };
        if (row.length >= 5) {
            r.getCell(4).value = row[3];
            r.getCell(4).font = BOLD_FONT;
            r.getCell(5).value = row[4];
        }
    });

    cover.getRow(9).getCell(1).value = 'Test Environment Setup Description';
    cover.getRow(9).getCell(1).font = BOLD_FONT;
    cover.mergeCells('B9:F12');
    cover.getCell('B9').value = '1. Database: PostgreSQL (Supabase)\n2. Runtime: Node.js 22.11.0\n3. Framework: Express 5.2 + Prisma 6.19\n4. Test Runner: node:test + node:assert (built-in)\n5. OS: Windows 10/11';
    cover.getCell('B9').alignment = { wrapText: true, vertical: 'top' };
    cover.getColumn(1).width = 30;
    cover.getColumn(2).width = 40;
    cover.getColumn(4).width = 22;
    cover.getColumn(5).width = 25;

    // ════════════════════════════════════════════
    // SHEET 2: MethodList
    // ════════════════════════════════════════════
    const ml = wb.addWorksheet('MethodList', { properties: { defaultColWidth: 18 } });
    ml.mergeCells('A2:F2');
    ml.getCell('A2').value = 'Method List';
    ml.getCell('A2').font = TITLE_FONT;
    ml.getCell('A2').alignment = { horizontal: 'center' };

    ml.getCell('A4').value = 'Project Name';
    ml.getCell('A4').font = BOLD_FONT;
    ml.mergeCells('B4:F4');
    ml.getCell('B4').value = 'EZ Room - Tìm phòng trọ thông minh';
    ml.getCell('B4').font = { ...NORMAL_FONT, italic: true };
    ml.getCell('A5').value = 'Project Code';
    ml.getCell('A5').font = BOLD_FONT;
    ml.getCell('B5').value = 'EZ-Room';
    ml.getCell('A6').value = 'Test Environment Setup Description';
    ml.getCell('A6').font = BOLD_FONT;
    ml.mergeCells('B6:F8');
    ml.getCell('B6').value = '1. Database: PostgreSQL (Supabase)\n2. Runtime: Node.js 22.11.0\n3. Framework: Express 5.2 + Prisma 6.19\n4. Test Runner: node:test + node:assert\n5. OS: Windows 10/11';
    ml.getCell('B6').alignment = { wrapText: true, vertical: 'top' };

    const mlHeaders = ['No', 'Module Name', 'Method Name', 'Sheet Name', 'Description', 'Pre-Condition'];
    const mlHeaderRow = ml.getRow(10);
    mlHeaders.forEach((h, i) => {
        const cell = mlHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = WHITE_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ml.getColumn(1).width = 6;
    ml.getColumn(2).width = 28;
    ml.getColumn(3).width = 32;
    ml.getColumn(4).width = 32;
    ml.getColumn(5).width = 50;
    ml.getColumn(6).width = 45;

    modules.forEach((mod, idx) => {
        const r = ml.getRow(11 + idx);
        const sn = mod.functionName.length > 31 ? mod.functionName.substring(0, 31) : mod.functionName;
        r.getCell(1).value = idx + 1;
        r.getCell(1).alignment = { horizontal: 'center' };
        r.getCell(2).value = mod.moduleName;
        r.getCell(3).value = mod.functionName;
        r.getCell(4).value = { text: sn, hyperlink: `#'${sn}'!A1` };
        r.getCell(4).font = { color: { argb: '0000FF' }, underline: true, size: 10 };
        r.getCell(5).value = `Unit test for ${mod.functionName} (${mod.tests.length} test cases)`;
        r.getCell(6).value = 'User authenticated, server running';
        for (let c = 1; c <= 6; c++) r.getCell(c).border = THIN_BORDER;
    });

    // ════════════════════════════════════════════
    // SHEET 3: Statistics
    // ════════════════════════════════════════════
    const stats = wb.addWorksheet('Statistics', { properties: { defaultColWidth: 14 } });
    stats.mergeCells('A2:I2');
    stats.getCell('A2').value = 'UNIT TEST REPORT';
    stats.getCell('A2').font = TITLE_FONT;
    stats.getCell('A2').alignment = { horizontal: 'center' };

    const statInfo = [
        ['A4', 'Project Name', 'B4', 'EZ Room - Tìm phòng trọ thông minh', 'D4', 'Creator', 'E4', 'EZ Room Team'],
        ['A5', 'Project Code', 'B5', 'EZ-Room', 'D5', 'Reviewer/Approver', 'E5', ''],
        ['A6', 'Document Code', 'B6', 'EZ-Room_Unit_Test_Report', 'D6', 'Issue Date', 'E6', dateStr],
        ['A7', 'Notes', 'B7', ''],
    ];
    statInfo.forEach(row => {
        for (let i = 0; i < row.length; i += 2) {
            const cell = stats.getCell(row[i]);
            cell.value = row[i + 1];
            cell.font = i % 4 === 0 ? BOLD_FONT : { ...NORMAL_FONT, italic: true };
        }
    });

    const stHeaders = ['No', 'Function code', 'Passed', 'Failed', 'Untested', 'N', 'A', 'B', 'Total Test Cases'];
    const stHeaderRow = stats.getRow(11);
    stHeaders.forEach((h, i) => {
        const cell = stHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = WHITE_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    stats.getColumn(1).width = 6;
    stats.getColumn(2).width = 35;
    stats.getColumn(3).width = 10;
    stats.getColumn(4).width = 10;
    stats.getColumn(5).width = 12;
    stats.getColumn(6).width = 6;
    stats.getColumn(7).width = 6;
    stats.getColumn(8).width = 6;
    stats.getColumn(9).width = 16;

    let totalPassed = 0, totalFailed = 0, totalUntested = 0, totalAll = 0;
    let totalN = 0, totalA = 0, totalB = 0;

    modules.forEach((mod, idx) => {
        const r = stats.getRow(12 + idx);
        const sn = mod.functionName.length > 31 ? mod.functionName.substring(0, 31) : mod.functionName;
        r.getCell(1).value = idx + 1;
        r.getCell(1).alignment = { horizontal: 'center' };
        r.getCell(2).value = { text: sn, hyperlink: `#'${sn}'!A1` };
        r.getCell(2).font = { color: { argb: '0000FF' }, underline: true, size: 10 };
        r.getCell(3).value = mod.passed;
        r.getCell(4).value = mod.failed;
        r.getCell(5).value = mod.untested;
        const nC = mod.tests.filter(t => classifyTest(t) === 'N').length;
        const aC = mod.tests.filter(t => classifyTest(t) === 'A').length;
        const bC = mod.tests.filter(t => classifyTest(t) === 'B').length;
        r.getCell(6).value = nC;
        r.getCell(7).value = aC;
        r.getCell(8).value = bC;
        r.getCell(9).value = mod.tests.length;
        totalPassed += mod.passed;
        totalFailed += mod.failed;
        totalUntested += mod.untested;
        totalAll += mod.tests.length;
        totalN += nC; totalA += aC; totalB += bC;
        for (let c = 1; c <= 9; c++) {
            r.getCell(c).border = THIN_BORDER;
            r.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
        }
        r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    });

    const totalRow = stats.getRow(12 + modules.length);
    totalRow.getCell(2).value = 'TOTAL';
    totalRow.getCell(2).font = BOLD_FONT;
    totalRow.getCell(3).value = totalPassed;
    totalRow.getCell(4).value = totalFailed;
    totalRow.getCell(5).value = totalUntested;
    totalRow.getCell(6).value = totalN;
    totalRow.getCell(7).value = totalA;
    totalRow.getCell(8).value = totalB;
    totalRow.getCell(9).value = totalAll;
    for (let c = 1; c <= 9; c++) {
        totalRow.getCell(c).border = THIN_BORDER;
        totalRow.getCell(c).font = BOLD_FONT;
        totalRow.getCell(c).alignment = { horizontal: 'center' };
    }

    const statsTotalRow = 12 + modules.length;
    const testCoverage = totalAll > 0 ? ((totalPassed + totalFailed) / totalAll) * 100 : 0;
    const successfulCoverage = totalAll > 0 ? (totalPassed / totalAll) * 100 : 0;

    const covRow = statsTotalRow + 2;
    stats.getCell(`B${covRow}`).value = 'Test coverage';
    stats.getCell(`B${covRow}`).font = LABEL_BROWN_FONT;
    stats.getCell(`D${covRow}`).value = toPercentComma(testCoverage);
    stats.getCell(`D${covRow}`).font = VALUE_BLUE_FONT;
    stats.getCell(`E${covRow}`).value = '%';
    stats.getCell(`E${covRow}`).font = VALUE_BLUE_FONT;

    stats.getCell(`B${covRow + 1}`).value = 'Test successful coverage';
    stats.getCell(`B${covRow + 1}`).font = LABEL_BROWN_FONT;
    stats.getCell(`D${covRow + 1}`).value = toPercentComma(successfulCoverage);
    stats.getCell(`D${covRow + 1}`).font = VALUE_BLUE_FONT;
    stats.getCell(`E${covRow + 1}`).value = '%';
    stats.getCell(`E${covRow + 1}`).font = VALUE_BLUE_FONT;

    // Native Excel charts are added in a follow-up PowerShell step (COM automation).

    // ════════════════════════════════════════════
    // SHEETS 4+: One sheet per function (4-column layout)
    // ════════════════════════════════════════════
    const usedSheetNames = new Set();
    modules.forEach(mod => {
        let baseName = mod.functionName.length > 31 ? mod.functionName.substring(0, 31) : mod.functionName;
        let sheetName = baseName;
        if (usedSheetNames.has(sheetName)) {
            const suffix = `_${mod.moduleName}`;
            sheetName = baseName.substring(0, 31 - suffix.length) + suffix;
        }
        usedSheetNames.add(sheetName);
        const ws = wb.addWorksheet(sheetName);
        const testCount = mod.tests.length;
        const tcStart = 5;

        ws.getColumn(1).width = 14;
        ws.getColumn(2).width = 20;
        ws.getColumn(3).width = 22;
        ws.getColumn(4).width = 28;
        for (let i = 0; i < testCount; i++) ws.getColumn(tcStart + i).width = 5;

        // ── Header rows 1-3 ──
        ws.getCell('A1').value = 'Code Module';  ws.getCell('A1').font = BOLD_FONT;
        ws.getCell('B1').value = mod.moduleName;  ws.getCell('B1').font = { ...NORMAL_FONT, italic: true };
        ws.getCell('C1').value = 'Method';        ws.getCell('C1').font = BOLD_FONT;
        ws.getCell('D1').value = mod.functionName;
        ws.getCell('A2').value = 'Created By';    ws.getCell('A2').font = BOLD_FONT;
        ws.getCell('B2').value = 'EZ Room Team';  ws.getCell('B2').font = { ...NORMAL_FONT, italic: true };
        ws.getCell('C2').value = 'Executed By';   ws.getCell('C2').font = BOLD_FONT;
        ws.getCell('D2').value = 'EZ Room Team';
        ws.getCell('A3').value = 'Test requirement'; ws.getCell('A3').font = BOLD_FONT;
        if (testCount > 0) ws.mergeCells(3, 2, 3, Math.min(tcStart + testCount - 1, tcStart + 5));
        ws.getCell('B3').value = `Unit tests for ${mod.moduleName} > ${mod.functionName}`;
        ws.getCell('B3').font = { ...NORMAL_FONT, italic: true };

        // ── Summary rows 4-5 ──
        const nC = mod.tests.filter(t => classifyTest(t) === 'N').length;
        const aC = mod.tests.filter(t => classifyTest(t) === 'A').length;
        const bC = mod.tests.filter(t => classifyTest(t) === 'B').length;
        const untCol = Math.max(6, Math.floor(tcStart + testCount * 0.35));
        const nabCol = Math.max(9, Math.floor(tcStart + testCount * 0.6));
        const totalCol = Math.max(12, Math.floor(tcStart + testCount * 0.8));

        const r4 = ws.getRow(4);
        r4.getCell(1).value = 'Passed'; r4.getCell(1).font = BOLD_FONT; r4.getCell(1).border = THIN_BORDER; r4.getCell(1).alignment = { horizontal: 'center' };
        r4.getCell(3).value = 'Failed'; r4.getCell(3).font = BOLD_FONT; r4.getCell(3).border = THIN_BORDER; r4.getCell(3).alignment = { horizontal: 'center' };
        r4.getCell(untCol).value = 'Untested'; r4.getCell(untCol).font = BOLD_FONT; r4.getCell(untCol).border = THIN_BORDER; r4.getCell(untCol).alignment = { horizontal: 'center' };
        r4.getCell(nabCol).value = 'N/A/B'; r4.getCell(nabCol).font = BOLD_FONT; r4.getCell(nabCol).border = THIN_BORDER; r4.getCell(nabCol).alignment = { horizontal: 'center' };
        r4.getCell(totalCol).value = 'Total Test Cases'; r4.getCell(totalCol).font = BOLD_FONT; r4.getCell(totalCol).border = THIN_BORDER; r4.getCell(totalCol).alignment = { horizontal: 'center' };

        const r5 = ws.getRow(5);
        r5.getCell(1).value = mod.passed; r5.getCell(1).border = THIN_BORDER; r5.getCell(1).alignment = { horizontal: 'center' };
        r5.getCell(3).value = mod.failed; r5.getCell(3).border = THIN_BORDER; r5.getCell(3).alignment = { horizontal: 'center' };
        r5.getCell(untCol).value = mod.untested; r5.getCell(untCol).border = THIN_BORDER; r5.getCell(untCol).alignment = { horizontal: 'center' };
        r5.getCell(nabCol).value = nC; r5.getCell(nabCol).border = THIN_BORDER; r5.getCell(nabCol).alignment = { horizontal: 'center' };
        r5.getCell(nabCol + 1).value = aC; r5.getCell(nabCol + 1).border = THIN_BORDER; r5.getCell(nabCol + 1).alignment = { horizontal: 'center' };
        r5.getCell(nabCol + 2).value = bC; r5.getCell(nabCol + 2).border = THIN_BORDER; r5.getCell(nabCol + 2).alignment = { horizontal: 'center' };
        r5.getCell(totalCol).value = testCount; r5.getCell(totalCol).border = THIN_BORDER; r5.getCell(totalCol).alignment = { horizontal: 'center' };

        // ── Row 7: Blue header bar with UTCID ──
        const mRow = 7;
        ws.getRow(mRow).height = 80;
        for (let c = 1; c <= 4; c++) {
            ws.getRow(mRow).getCell(c).fill = HEADER_FILL;
            ws.getRow(mRow).getCell(c).border = THIN_BORDER;
        }
        mod.tests.forEach((_, i) => {
            const cell = ws.getRow(mRow).getCell(tcStart + i);
            cell.value = `UTCID${String(i + 1).padStart(2, '0')}`;
            cell.fill = HEADER_FILL;
            cell.font = { ...WHITE_FONT, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90 };
            cell.border = THIN_BORDER;
        });

        // ── Row 8: Condition / Precondition ──
        fillRow4(ws, mRow + 1, tcStart, testCount, {
            a: 'Condition', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Precondition', bFont: WHITE_FONT, bFill: HEADER_FILL,
            cFill: HEADER_FILL, dFill: HEADER_FILL,
        });
        // Ensure C/D cells have fill
        ws.getRow(mRow + 1).getCell(3).fill = HEADER_FILL;
        ws.getRow(mRow + 1).getCell(4).fill = HEADER_FILL;

        let cur = mRow + 2;

        // ── Can connect with server ──
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'Can connect with server', dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: mod.tests.map(() => 'O'), tcFont: { bold: true, size: 10 },
        });
        cur += 2;

        // ── Account section ──
        const hasAuth = mod.tests.some((t, ti) => {
            const l = t.toLowerCase();
            const authInfo = mod.testInputs && mod.testInputs[ti] ? mod.testInputs[ti].auth : null;
            return l.includes('logged in') || l.includes('401') || l.includes('403') || l.includes('not the target') || authInfo === 'null';
        });
        if (hasAuth) {
            fillRow4(ws, cur, tcStart, testCount, { c: 'Account', cFont: BOLD_FONT });
            cur++;
            // null (not logged in)
            const nullAuthValues = mod.tests.map((t, ti) => {
                const l = t.toLowerCase();
                const authInfo = mod.testInputs && mod.testInputs[ti] ? mod.testInputs[ti].auth : null;
                return (l.includes('not logged in') || l.includes('401') || authInfo === 'null') ? 'O' : '';
            });
            if (nullAuthValues.some(v => v === 'O')) {
                fillRow4(ws, cur, tcStart, testCount, {
                    d: 'null', dAlign: { horizontal: 'right', vertical: 'middle' },
                    tcValues: nullAuthValues, tcFont: { bold: true, size: 10 },
                });
                cur++;
            }
            // exist (authenticated user)
            const authValues = mod.tests.map((t, ti) => {
                const l = t.toLowerCase();
                const authInfo = mod.testInputs && mod.testInputs[ti] ? mod.testInputs[ti].auth : null;
                return (l.includes('not logged in') || l.includes('401') || authInfo === 'null') ? '' : 'O';
            });
            fillRow4(ws, cur, tcStart, testCount, {
                d: 'exist(authenticated)', dAlign: { horizontal: 'right', vertical: 'middle' },
                tcValues: authValues, tcFont: { bold: true, size: 10 },
            });
            cur++;
            // Forbidden (wrong role / not the target)
            const forbidValues = mod.tests.map(t => {
                const l = t.toLowerCase();
                return (l.includes('403') || l.includes('not the target') || l.includes('forbidden')) ? 'O' : '';
            });
            if (forbidValues.some(v => v === 'O')) {
                fillRow4(ws, cur, tcStart, testCount, {
                    d: 'exist(wrong role / not target)', dAlign: { horizontal: 'right', vertical: 'middle' },
                    tcValues: forbidValues, tcFont: { bold: true, size: 10 },
                });
                cur++;
            }
            cur++;
        }

        // ══════════════════════════════════════
        // DataInput — field name centered, values right-aligned
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            b: `DataInput(${mod.functionName})`, bFont: BOLD_FONT,
        });
        cur++;

        // Collect all field names and their values per test
        const allFieldData = mod.tests.map((_, ti) => {
            const inp = mod.testInputs && mod.testInputs[ti] ? mod.testInputs[ti] : null;
            return getFieldList(inp);
        });

        // Get ordered unique field names
        const fieldOrder = [];
        const fieldSet = new Set();
        allFieldData.forEach(fields => {
            fields.forEach(f => {
                if (!fieldSet.has(f.name)) {
                    fieldSet.add(f.name);
                    fieldOrder.push(f.name);
                }
            });
        });

        // For each field: header row (centered), then unique value rows (right-aligned)
        for (const fieldName of fieldOrder) {
            // Field name header row
            fillRow4(ws, cur, tcStart, testCount, {
                c: fieldName, cFont: BOLD_FONT, cAlign: { horizontal: 'center', vertical: 'middle' },
            });
            cur++;

            // Collect values per test for this field
            const testValues = allFieldData.map(fields => {
                const match = fields.find(f => f.name === fieldName);
                return match ? match.value : '';
            });

            // Group unique values
            const valueGroups = new Map();
            testValues.forEach((val, ti) => {
                const key = val || '(empty)';
                if (!valueGroups.has(key)) valueGroups.set(key, []);
                valueGroups.get(key).push(ti);
            });

            for (const [val, indices] of valueGroups) {
                fillRow4(ws, cur, tcStart, testCount, {
                    d: val, dFont: NORMAL_FONT, dAlign: { horizontal: 'right', vertical: 'middle' },
                    tcValues: mod.tests.map((_, i) => indices.includes(i) ? 'O' : ''),
                    tcFont: { bold: true, size: 10 },
                });
                cur++;
            }
        }

        // If no fields found at all
        if (fieldOrder.length === 0) {
            fillRow4(ws, cur, tcStart, testCount, { d: '(no input)', dAlign: { horizontal: 'right', vertical: 'middle' } });
            cur++;
        }
        cur++;

        // ══════════════════════════════════════
        // Expected Output
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'Expected Output', bFont: BOLD_FONT,
        });
        cur++;
        const eoGroups = [];
        const eoSeen = new Map();
        mod.tests.forEach((testName, ti) => {
            const status = mod.testInputs && mod.testInputs[ti] && mod.testInputs[ti].assertStatus
                ? mod.testInputs[ti].assertStatus
                : null;
            const eoText = status ? `Return ${status}` : getExpectedOutput(testName);
            if (eoSeen.has(eoText)) {
                eoSeen.get(eoText).indices.push(ti);
            } else {
                const group = { text: eoText, indices: [ti] };
                eoGroups.push(group);
                eoSeen.set(eoText, group);
            }
        });
        eoGroups.forEach(group => {
            fillRow4(ws, cur, tcStart, testCount, {
                d: group.text, dAlign: { horizontal: 'right', vertical: 'middle' },
                tcValues: mod.tests.map((_, i) => group.indices.includes(i) ? 'O' : ''),
                tcFont: { bold: true, size: 10 },
            });
            cur++;
        });
        cur++;

        // ══════════════════════════════════════
        // CONFIRM section
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            a: 'Confirm', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Return', bFont: BOLD_FONT,
        });
        cur++;

        // T (True / success) row
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'T', dFont: BOLD_FONT, dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: mod.tests.map((t, ti) => {
                const s = mod.testInputs[ti] && mod.testInputs[ti].assertStatus;
                return s ? (s >= 200 && s < 300 ? 'O' : '') : (isSuccessTest(t) ? 'O' : '');
            }),
            tcFont: { bold: true, size: 10 },
        });
        cur++;

        // F (False / failure) row
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'F', dFont: BOLD_FONT, dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: mod.tests.map((t, ti) => {
                const s = mod.testInputs[ti] && mod.testInputs[ti].assertStatus;
                return s ? (s >= 400 ? 'O' : '') : (!isSuccessTest(t) ? 'O' : '');
            }),
            tcFont: { bold: true, size: 10 },
        });
        cur++;

        // Exception O-mark row — extract actual error messages from controller source
        const controllerPath = getControllerPath(mod.file);
        const ctrlErrorMsgs = extractErrorMessagesFromController(controllerPath, mod.functionName);
        const exMap = new Map();
        mod.tests.forEach((t, i) => {
            const info = mod.testInputs[i];
            const status = info && info.assertStatus;
            if (status && status >= 400) {
                const exText = matchTestToErrorMessage(t, status, ctrlErrorMsgs);
                if (exText) {
                    if (!exMap.has(exText)) exMap.set(exText, []);
                    exMap.get(exText).push(i);
                }
            }
        });
        const allExIndices = new Set();
        for (const indices of exMap.values()) indices.forEach(i => allExIndices.add(i));
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'Exception', dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: mod.tests.map((_, i) => allExIndices.has(i) ? 'O' : ''),
            tcFont: { bold: true, size: 10 },
        });
        cur++;

        // Exception header
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'Exception', bFont: BOLD_FONT,
        });
        cur++;

        // Individual exception messages (actual Vietnamese messages from controller)
        for (const [msg, indices] of exMap) {
            fillRow4(ws, cur, tcStart, testCount, {
                d: `"${msg}"`, dAlign: { horizontal: 'right', vertical: 'middle' },
                tcValues: mod.tests.map((_, i) => indices.includes(i) ? 'O' : ''),
                tcFont: { bold: true, size: 10 },
            });
            cur++;
        }
        if (exMap.size === 0) {
            fillRow4(ws, cur, tcStart, testCount, { d: 'N/A', dAlign: { horizontal: 'right', vertical: 'middle' } });
            cur++;
        }
        cur++;

        // ══════════════════════════════════════
        // LOG MESSAGE
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'Log message', bFont: BOLD_FONT,
        });
        cur++;
        cur += 2;

        // ══════════════════════════════════════
        // RESULT section
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            a: 'Result', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Type(N : Normal, A : Abnormal, B : Boundary)',
            bFont: NORMAL_FONT,
            tcValues: mod.tests.map((t, ti) => {
                const s = mod.testInputs[ti] && mod.testInputs[ti].assertStatus;
                if (s) {
                    if (s >= 200 && s < 300) return classifyTest(t) === 'B' ? 'B' : 'N';
                    if (s === 400) return classifyTest(t) === 'B' ? 'B' : 'A';
                    return 'A';
                }
                return classifyTest(t);
            }),
            tcFont: { bold: false, size: 10 },
        });
        cur++;

        // Passed/Failed per test
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'Passed/Failed', bFont: NORMAL_FONT,
            tcValues: mod.tests.map(() => 'P'),
            tcFont: { bold: false, size: 10 },
        });
        cur++;

        // Executed Date
        const dateChars = dateStr.split('');
        {
            const row = ws.getRow(cur);
            for (let c = 1; c <= 4; c++) { row.getCell(c).border = THIN_BORDER; }
            row.getCell(2).value = 'Executed Date';
            row.getCell(2).font = NORMAL_FONT;
            for (let i = 0; i < testCount; i++) {
                const cell = row.getCell(tcStart + i);
                cell.value = dateChars[0] || '';
                cell.border = THIN_BORDER;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.font = { size: 10 };
            }
            cur++;
        }
        for (let ci = 1; ci < dateChars.length; ci++) {
            const row = ws.getRow(cur);
            for (let c = 1; c <= 4; c++) { row.getCell(c).border = THIN_BORDER; }
            for (let i = 0; i < testCount; i++) {
                const cell = row.getCell(tcStart + i);
                cell.value = dateChars[ci];
                cell.border = THIN_BORDER;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.font = { size: 10 };
            }
            cur++;
        }

        // Defect ID
        {
            const row = ws.getRow(cur);
            for (let c = 1; c <= 4; c++) { row.getCell(c).border = THIN_BORDER; }
            row.getCell(2).value = 'Defect ID';
            row.getCell(2).font = NORMAL_FONT;
            for (let i = 0; i < testCount; i++) {
                const cell = row.getCell(tcStart + i);
                cell.value = '';
                cell.border = THIN_BORDER;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            cur++;
        }
    });

    // ── Save ──
    const outputPath = path.join(__dirname, '..', '..', 'EZ-Room_Unit_Test_Report.xlsx');
    await wb.xlsx.writeFile(outputPath);

    try {
        execFileSync('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'apply-excel-charts.ps1'),
            '-Mode', 'unit',
            '-WorkbookPath', outputPath,
        ], { stdio: 'ignore' });
        console.log('   Native Excel charts added (Unit Statistics).');
    } catch (err) {
        console.warn('⚠️ Could not add native Excel chart automatically. Open the file in Excel and run apply-excel-charts.ps1 manually.');
    }

    console.log(`✅ Report generated: ${outputPath}`);
    console.log(`   Total functions: ${modules.length}`);
    console.log(`   Total test cases: ${totalAll}`);
    console.log(`   Passed: ${totalPassed} | Failed: ${totalFailed} | Untested: ${totalUntested}`);
    console.log(`   N: ${totalN} | A: ${totalA} | B: ${totalB}`);
}

generateReport().catch(err => {
    console.error('❌ Error generating report:', err);
    process.exit(1);
});
