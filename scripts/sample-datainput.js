/**
 * SAMPLE — preview the new DataInput layout with field names centered
 * and field values right-aligned, matching the template image.
 *
 * Generates: E:\SEP490\Sample_DataInput_Preview.xlsx
 * with 2 sample sheets: createAmenity (single field) and register (multi field)
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

// ── Load the same parsing functions from the main script ──
const scriptPath = path.join(__dirname, 'generate-test-report.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');
eval(scriptContent.split('// ── MAIN')[0]);

// ── New fillRow with 4 columns (A, B, C, D) before UTCID columns ──
function fillRow4(ws, rowNum, tcStartCol, testCount, opts = {}) {
    const row = ws.getRow(rowNum);
    // Col A (section label)
    row.getCell(1).value = opts.a || '';
    row.getCell(1).border = THIN_BORDER;
    if (opts.aFill) row.getCell(1).fill = opts.aFill;
    if (opts.aFont) row.getCell(1).font = opts.aFont;
    // Col B (sub-label / field name)
    row.getCell(2).value = opts.b || '';
    row.getCell(2).border = THIN_BORDER;
    if (opts.bFont) row.getCell(2).font = opts.bFont;
    if (opts.bAlign) row.getCell(2).alignment = opts.bAlign;
    // Col C (field name — centered)
    row.getCell(3).value = opts.c || '';
    row.getCell(3).border = THIN_BORDER;
    if (opts.cFont) row.getCell(3).font = opts.cFont;
    row.getCell(3).alignment = opts.cAlign || { horizontal: 'center', vertical: 'middle' };
    // Col D (field value — right-aligned)
    row.getCell(4).value = opts.d || '';
    row.getCell(4).border = THIN_BORDER;
    if (opts.dFont) row.getCell(4).font = opts.dFont;
    row.getCell(4).alignment = opts.dAlign || { horizontal: 'right', vertical: 'middle' };
    // Test case columns
    for (let i = 0; i < testCount; i++) {
        const cell = row.getCell(tcStartCol + i);
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (opts.tcValues && opts.tcValues[i] !== undefined) cell.value = opts.tcValues[i];
        if (opts.tcFont) cell.font = opts.tcFont;
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
        // Split by comma respecting nesting
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

// ── Infer type from value ──
function inferType(val) {
    if (val === '{}' || val === '(empty)') return '';
    if (/^\d+$/.test(val)) return '(int)';
    if (/^\d+\.\d+$/.test(val)) return '(float)';
    if (/^true|false$/i.test(val)) return '(boolean)';
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) return '(string)';
    return '';
}

async function generateSample() {
    const wb = new ExcelJS.Workbook();
    const testDir = path.join(__dirname, '..', 'test');
    const tcStart = 5; // UTCID columns start at col 5

    // ──────────────────────────────────────────
    // SAMPLE 1: createAmenity (single field: name)
    // ──────────────────────────────────────────
    {
        const content = fs.readFileSync(path.join(testDir, 'amenities.controller.test.js'), 'utf8');
        const describes = splitDescribes(content);
        const desc = describes.find(d => d.name.includes('createAmenity'));
        const tests = desc.itBlocks.map(b => b.name);
        const inputs = desc.itBlocks.map(b => extractInputFromBlock(b.code));
        const testCount = tests.length;

        const ws = wb.addWorksheet('createAmenity');
        ws.getColumn(1).width = 14;
        ws.getColumn(2).width = 20;
        ws.getColumn(3).width = 22;
        ws.getColumn(4).width = 28;
        for (let i = 0; i < testCount; i++) ws.getColumn(tcStart + i).width = 5;

        // Header
        ws.getCell('A1').value = 'Code Module'; ws.getCell('A1').font = BOLD_FONT;
        ws.getCell('B1').value = 'Amenities';
        ws.getCell('D1').value = 'Method'; ws.getCell('D1').font = BOLD_FONT;
        ws.getCell('E1').value = 'createAmenity';
        ws.getCell('A2').value = 'Created By'; ws.getCell('A2').font = BOLD_FONT;
        ws.getCell('B2').value = 'EZ Room Team';
        ws.getCell('D2').value = 'Executed By'; ws.getCell('D2').font = BOLD_FONT;
        ws.getCell('E2').value = 'EZ Room Team';

        // Summary row 4-5
        ws.getCell('A4').value = 'Passed'; ws.getCell('A4').font = BOLD_FONT; ws.getCell('A4').border = THIN_BORDER;
        ws.getCell('A5').value = testCount; ws.getCell('A5').border = THIN_BORDER;
        ws.getCell('C4').value = 'Failed'; ws.getCell('C4').font = BOLD_FONT; ws.getCell('C4').border = THIN_BORDER;
        ws.getCell('C5').value = 0; ws.getCell('C5').border = THIN_BORDER;

        // Row 7: UTCID header bar
        const mRow = 7;
        ws.getRow(mRow).height = 80;
        for (let c = 1; c <= 4; c++) {
            ws.getRow(mRow).getCell(c).fill = HEADER_FILL;
            ws.getRow(mRow).getCell(c).border = THIN_BORDER;
        }
        tests.forEach((_, i) => {
            const cell = ws.getRow(mRow).getCell(tcStart + i);
            cell.value = `UTCID${String(i + 1).padStart(2, '0')}`;
            cell.fill = HEADER_FILL;
            cell.font = { ...WHITE_FONT, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90 };
            cell.border = THIN_BORDER;
        });

        let cur = mRow + 1;

        // Condition > Precondition
        fillRow4(ws, cur, tcStart, testCount, {
            a: 'Condition', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Precondition',
            bFont: BOLD_FONT,
        });
        cur++;
        fillRow4(ws, cur, tcStart, testCount, {
            c: '', d: 'Can connect with server',
            dAlign: { horizontal: 'right', vertical: 'middle' },
            tcValues: tests.map(() => 'O'), tcFont: { bold: true, size: 10 },
        });
        cur++;
        cur++; // blank

        // ══════════════════════════════════════
        // DataInput — field name on its own row, values below on the right
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'DataInput', bFont: BOLD_FONT,
        });
        cur++;

        // Collect all unique field names across all test cases (preserve order)
        const allFieldNames = [];
        const fieldNamesSet = new Set();
        const testFields = inputs.map(inp => {
            const fl = getFieldList(inp);
            fl.forEach(f => {
                if (!fieldNamesSet.has(f.name)) {
                    fieldNamesSet.add(f.name);
                    allFieldNames.push(f.name);
                }
            });
            return fl;
        });

        // For each field: 1 header row with field name centered, then value rows below
        for (const fieldName of allFieldNames) {
            // Gather unique values for this field
            const valueGroups = new Map();
            tests.forEach((_, ti) => {
                const tf = testFields[ti];
                const match = tf.find(f => f.name === fieldName);
                if (match) {
                    const v = match.value;
                    if (!valueGroups.has(v)) valueGroups.set(v, []);
                    valueGroups.get(v).push(ti);
                }
            });

            // Row: field name only (centered, bold)
            fillRow4(ws, cur, tcStart, testCount, {
                c: fieldName,
                cFont: BOLD_FONT,
                cAlign: { horizontal: 'center', vertical: 'middle' },
            });
            cur++;

            // Rows: each unique value (right-aligned) with O marks
            for (const [val, indices] of valueGroups) {
                fillRow4(ws, cur, tcStart, testCount, {
                    d: val,
                    dFont: NORMAL_FONT,
                    dAlign: { horizontal: 'right', vertical: 'middle' },
                    tcValues: tests.map((_, i) => indices.includes(i) ? 'O' : ''),
                    tcFont: { bold: true, size: 10 },
                });
                cur++;
            }
        }
        // Empty body tests (no fields at all)
        const emptyTests = [];
        tests.forEach((_, ti) => {
            if (testFields[ti].length === 0) emptyTests.push(ti);
        });
        if (emptyTests.length > 0) {
            fillRow4(ws, cur, tcStart, testCount, {
                c: '(no input)',
                cFont: { ...NORMAL_FONT, italic: true },
                d: '',
                tcValues: tests.map((_, i) => emptyTests.includes(i) ? 'O' : ''),
                tcFont: { bold: true, size: 10 },
            });
            cur++;
        }
        cur++; // blank

        // Expected Output (simplified)
        fillRow4(ws, cur, tcStart, testCount, { b: 'Expected Output', bFont: BOLD_FONT });
        cur++;
        // Group by status
        const statusGroups = new Map();
        inputs.forEach((inp, ti) => {
            const s = inp.assertStatus || '200';
            if (!statusGroups.has(s)) statusGroups.set(s, []);
            statusGroups.get(s).push(ti);
        });
        for (const [status, indices] of statusGroups) {
            fillRow4(ws, cur, tcStart, testCount, {
                d: `Return ${status}`,
                dAlign: { horizontal: 'right' },
                tcValues: tests.map((_, i) => indices.includes(i) ? 'O' : ''),
                tcFont: { bold: true, size: 10 },
            });
            cur++;
        }
        cur++;

        // Confirm (simplified)
        fillRow4(ws, cur, tcStart, testCount, {
            a: 'Confirm', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Return', bFont: BOLD_FONT,
        });
        cur++;
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'T', dAlign: { horizontal: 'right' }, dFont: BOLD_FONT,
            tcValues: inputs.map(inp => inp.assertStatus && inp.assertStatus >= 200 && inp.assertStatus < 300 ? 'O' : ''),
            tcFont: { bold: true, size: 10 },
        });
        cur++;
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'F', dAlign: { horizontal: 'right' }, dFont: BOLD_FONT,
            tcValues: inputs.map(inp => inp.assertStatus && inp.assertStatus >= 400 ? 'O' : ''),
            tcFont: { bold: true, size: 10 },
        });
        cur++;
    }

    // ──────────────────────────────────────────
    // SAMPLE 2: register (multi-field: fullName, email, password, confirmPassword, role)
    // ──────────────────────────────────────────
    {
        const content = fs.readFileSync(path.join(testDir, 'auth.controller.test.js'), 'utf8');
        const describes = splitDescribes(content);
        const desc = describes.find(d => d.name.includes('register'));
        const tests = desc.itBlocks.map(b => b.name);
        const inputs = desc.itBlocks.map(b => extractInputFromBlock(b.code));
        const testCount = tests.length;

        const ws = wb.addWorksheet('register');
        ws.getColumn(1).width = 14;
        ws.getColumn(2).width = 20;
        ws.getColumn(3).width = 25;
        ws.getColumn(4).width = 28;
        for (let i = 0; i < testCount; i++) ws.getColumn(tcStart + i).width = 5;

        ws.getCell('A1').value = 'Code Module'; ws.getCell('A1').font = BOLD_FONT;
        ws.getCell('B1').value = 'Auth';
        ws.getCell('D1').value = 'Method'; ws.getCell('D1').font = BOLD_FONT;
        ws.getCell('E1').value = 'register';

        // Row 4: UTCID header bar
        const mRow = 4;
        ws.getRow(mRow).height = 80;
        for (let c = 1; c <= 4; c++) {
            ws.getRow(mRow).getCell(c).fill = HEADER_FILL;
            ws.getRow(mRow).getCell(c).border = THIN_BORDER;
        }
        tests.forEach((_, i) => {
            const cell = ws.getRow(mRow).getCell(tcStart + i);
            cell.value = `UTCID${String(i + 1).padStart(2, '0')}`;
            cell.fill = HEADER_FILL;
            cell.font = { ...WHITE_FONT, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90 };
            cell.border = THIN_BORDER;
        });

        let cur = mRow + 1;

        // Condition > Precondition
        fillRow4(ws, cur, tcStart, testCount, {
            a: 'Condition', aFill: HEADER_FILL, aFont: WHITE_FONT,
            b: 'Precondition', bFont: BOLD_FONT,
        });
        cur++;
        fillRow4(ws, cur, tcStart, testCount, {
            d: 'Can connect with server',
            dAlign: { horizontal: 'right' },
            tcValues: tests.map(() => 'O'), tcFont: { bold: true, size: 10 },
        });
        cur++;
        cur++;

        // ══════════════════════════════════════
        // DataInput — field name on its own row, values below
        // ══════════════════════════════════════
        fillRow4(ws, cur, tcStart, testCount, {
            b: 'DataInput', bFont: BOLD_FONT,
        });
        cur++;

        const allFieldNames = [];
        const fieldNamesSet = new Set();
        const testFields = inputs.map(inp => {
            const fl = getFieldList(inp);
            fl.forEach(f => {
                if (!fieldNamesSet.has(f.name)) {
                    fieldNamesSet.add(f.name);
                    allFieldNames.push(f.name);
                }
            });
            return fl;
        });

        for (const fieldName of allFieldNames) {
            const valueGroups = new Map();
            tests.forEach((_, ti) => {
                const tf = testFields[ti];
                const match = tf.find(f => f.name === fieldName);
                if (match) {
                    const v = match.value;
                    if (!valueGroups.has(v)) valueGroups.set(v, []);
                    valueGroups.get(v).push(ti);
                }
            });

            // Field name row (centered, bold)
            fillRow4(ws, cur, tcStart, testCount, {
                c: fieldName,
                cFont: BOLD_FONT,
                cAlign: { horizontal: 'center', vertical: 'middle' },
            });
            cur++;

            // Value rows (right-aligned)
            for (const [val, indices] of valueGroups) {
                fillRow4(ws, cur, tcStart, testCount, {
                    d: val,
                    dFont: NORMAL_FONT,
                    dAlign: { horizontal: 'right', vertical: 'middle' },
                    tcValues: tests.map((_, i) => indices.includes(i) ? 'O' : ''),
                    tcFont: { bold: true, size: 10 },
                });
                cur++;
            }
        }

        // Empty body tests
        const emptyTests = [];
        tests.forEach((_, ti) => {
            if (testFields[ti].length === 0) emptyTests.push(ti);
        });
        if (emptyTests.length > 0) {
            fillRow4(ws, cur, tcStart, testCount, {
                c: '(no input)',
                cFont: { ...NORMAL_FONT, italic: true },
                tcValues: tests.map((_, i) => emptyTests.includes(i) ? 'O' : ''),
                tcFont: { bold: true, size: 10 },
            });
            cur++;
        }
    }

    const outputPath = path.join(__dirname, '..', '..', 'Sample_DataInput_Preview.xlsx');
    await wb.xlsx.writeFile(outputPath);
    console.log(`✅ Sample generated: ${outputPath}`);
}

generateSample().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
