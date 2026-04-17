$ErrorActionPreference = 'Stop'
$path = 'E:\SEP490\EZ-Room_Unit_Test_Report.xlsx'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Open($path)
  $ref = $wb.Worksheets.Item('getAllUsers')
  $skip = @('Cover','MethodList','Statistics')

  $labelPos = @{}
  for ($c=1; $c -le 13; $c++) {
    $v = [string]$ref.Cells.Item(4,$c).Text
    if ($v -ne '') { $labelPos[$v] = $c }
  }

  $mergeAddrs = @()
  $seen = @{}
  for ($r=1; $r -le 5; $r++) {
    for ($c=1; $c -le 13; $c++) {
      $cell = $ref.Cells.Item($r,$c)
      if ($cell.MergeCells) {
        $addr = $cell.MergeArea.Address($false,$false)
        if (-not $seen.ContainsKey($addr)) {
          $seen[$addr] = $true
          $mergeAddrs += $addr
        }
      }
    }
  }

  $fixed = 0
  foreach ($ws in $wb.Worksheets) {
    if ($skip -contains [string]$ws.Name) { continue }
    if ($ws.Name -eq $ref.Name) { continue }

    $b1 = $ws.Cells.Item(1,2).Value2
    $d1 = $ws.Cells.Item(1,4).Value2
    $b2 = $ws.Cells.Item(2,2).Value2
    $d2 = $ws.Cells.Item(2,4).Value2
    $b3 = $ws.Cells.Item(3,2).Value2

    $ref.Range('A1:M5').Copy()
    $ws.Range('A1:M5').PasteSpecial(-4122)

    $ws.Range('A1:M5').UnMerge()
    foreach ($addr in $mergeAddrs) {
      [void]$ws.Range($addr).Merge()
    }

    $ws.Cells.Item(1,1).Value2 = 'Code Module'
    $ws.Cells.Item(1,3).Value2 = 'Method'
    $ws.Cells.Item(2,1).Value2 = 'Created By'
    $ws.Cells.Item(2,3).Value2 = 'Executed By'
    $ws.Cells.Item(3,1).Value2 = 'Test requirement'

    for ($c=1; $c -le 13; $c++) {
      $v = [string]$ws.Cells.Item(4,$c).Text
      if ($v -in @('Passed','Failed','Untested','N/A/B','Total Test Cases')) {
        $ws.Cells.Item(4,$c).Value2 = ''
      }
    }
    foreach ($k in $labelPos.Keys) {
      $ws.Cells.Item(4, [int]$labelPos[$k]).Value2 = $k
    }

    $ws.Cells.Item(1,2).Value2 = $b1
    $ws.Cells.Item(1,4).Value2 = $d1
    $ws.Cells.Item(2,2).Value2 = $b2
    $ws.Cells.Item(2,4).Value2 = $d2
    $ws.Cells.Item(3,2).Value2 = $b3

    $fixed++
  }

  $wb.Save()
  $wb.Close($true)
  Write-Output ('Fixed header format on ' + $fixed + ' Unit sheets.')
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
