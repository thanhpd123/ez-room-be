#!/usr/bin/env node

const XLSX = require('xlsx');
const path = require('path');

const EXCEL_FILE = 'e:\\SEP490\\Performance_Test_Report.xlsx';

try {
  console.log('📖 Reading Excel file...\n');
  
  const workbook = XLSX.readFile(EXCEL_FILE);
  
  console.log('📊 Workbook Sheets:');
  console.log(workbook.SheetNames);
  console.log(`\nTotal Sheets: ${workbook.SheetNames.length}\n`);
  
  // Read each sheet
  workbook.SheetNames.forEach((sheetName, index) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Sheet ${index + 1}: ${sheetName}`);
    console.log('='.repeat(80));
    
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Display first 20 rows
    const rowsToShow = Math.min(20, data.length);
    console.log(`Showing ${rowsToShow} of ${data.length} rows:\n`);
    
    data.slice(0, rowsToShow).forEach((row, i) => {
      console.log(`Row ${i + 1}: ${JSON.stringify(row)}`);
    });
    
    if (data.length > 20) {
      console.log(`\n... (${data.length - 20} more rows)`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ File read successfully');
  
} catch (error) {
  console.error('❌ Error reading Excel file:');
  console.error(error.message);
  process.exit(1);
}
