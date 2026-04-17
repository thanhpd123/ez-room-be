$ErrorActionPreference = 'Stop'
$paths = @('E:\SEP490\EZ-Room_Unit_Test_Report.xlsx','E:\SEP490\EZ-Room_Integration_Test_Report.xlsx')
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  foreach($path in $paths){
    $wb = $excel.Workbooks.Open($path)
    $changed = 0
    foreach($ws in $wb.Worksheets){
      $used = $ws.UsedRange
      $startRow = $used.Row
      $startCol = $used.Column
      $endRow = $startRow + $used.Rows.Count - 1
      $endCol = $startCol + $used.Columns.Count - 1

      $testerHeaders = @()
      for($r=$startRow; $r -le $endRow; $r++){
        for($c=$startCol; $c -le $endCol; $c++){
          $txt = [string]$ws.Cells.Item($r,$c).Text
          if($txt.Trim().ToLower() -eq 'tester'){
            $testerHeaders += @{ Row=$r; Col=$c }
          }
        }
      }

      foreach($h in $testerHeaders){
        for($r=$h.Row+1; $r -le $endRow; $r++){
          $rowHasData = $false
          for($c=$startCol; $c -le $endCol; $c++){
            $t = [string]$ws.Cells.Item($r,$c).Text
            if($t -ne '') { $rowHasData = $true; break }
          }
          if(-not $rowHasData){ continue }

          $current = [string]$ws.Cells.Item($r,$h.Col).Text
          if($current -ne 'Havt'){
            $ws.Cells.Item($r,$h.Col).Value2 = 'Havt'
            $changed++
          }
        }
      }
    }
    $wb.Save()
    Write-Output ((Split-Path -Path $path -Leaf) + ' => updated tester cells: ' + $changed)
    $wb.Close($true)
  }
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
