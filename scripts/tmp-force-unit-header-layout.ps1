$ErrorActionPreference = 'Stop'
$path = 'E:\SEP490\EZ-Room_Unit_Test_Report.xlsx'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Open($path)
  $skip = @('Cover','MethodList','Statistics')
  $count = 0
  foreach ($ws in $wb.Worksheets) {
    if ($skip -contains [string]$ws.Name) { continue }

    # Keep business data fields
    $b1 = $ws.Cells.Item(1,2).Value2
    $d1 = $ws.Cells.Item(1,4).Value2
    $b2 = $ws.Cells.Item(2,2).Value2
    $d2 = $ws.Cells.Item(2,4).Value2
    $b3 = $ws.Cells.Item(3,2).Value2

    # Force merge layout for requirement row
    $ws.Range('A1:M5').UnMerge()
    [void]$ws.Range('B3:H3').Merge()

    # Static labels
    $ws.Cells.Item(1,1).Value2 = 'Code Module'
    $ws.Cells.Item(1,3).Value2 = 'Method'
    $ws.Cells.Item(2,1).Value2 = 'Created By'
    $ws.Cells.Item(2,3).Value2 = 'Executed By'
    $ws.Cells.Item(3,1).Value2 = 'Test requirement'

    # Normalize row-4 summary labels
    for ($c=1; $c -le 13; $c++) {
      $v = [string]$ws.Cells.Item(4,$c).Text
      if ($v -in @('Passed','Failed','Untested','N/A/B','Total Test Cases')) {
        $ws.Cells.Item(4,$c).Value2 = ''
      }
    }
    $ws.Cells.Item(4,1).Value2 = 'Passed'
    $ws.Cells.Item(4,3).Value2 = 'Failed'
    $ws.Cells.Item(4,6).Value2 = 'Untested'
    $ws.Cells.Item(4,9).Value2 = 'N/A/B'
    $ws.Cells.Item(4,12).Value2 = 'Total Test Cases'

    # Restore values
    $ws.Cells.Item(1,2).Value2 = $b1
    $ws.Cells.Item(1,4).Value2 = $d1
    $ws.Cells.Item(2,2).Value2 = $b2
    $ws.Cells.Item(2,4).Value2 = $d2
    $ws.Cells.Item(3,2).Value2 = $b3

    $count++
  }
  $wb.Save()
  $wb.Close($true)
  Write-Output ('Forced header layout on ' + $count + ' Unit sheets.')
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
