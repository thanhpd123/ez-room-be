$ErrorActionPreference='Stop'
$path='E:\SEP490\Report5.1_Unit Test (1).xlsx'

Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force

$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false

function ToInt($v){
  if($null -eq $v){ return 0 }
  $s = [string]$v
  if($s.Trim() -eq ''){ return 0 }
  $n=0
  if([int]::TryParse($s.Trim(), [ref]$n)){ return $n }
  return 0
}

function FindTypeRow($ws){
  for($r=8; $r -le 40; $r++){
    $t=[string]$ws.Cells.Item($r,2).Text
    if($t -match 'Type\s*\('){ return $r }
  }
  return 0
}

function FindUtcidCols($ws){
  $cols=@()
  for($c=1; $c -le 26; $c++){
    $found=$false
    for($r=6; $r -le 10; $r++){
      $t=[string]$ws.Cells.Item($r,$c).Text
      if($t -match '^UTCID'){ $found=$true; break }
    }
    if($found){ $cols += $c }
  }
  return $cols
}

try {
  $wb=$excel.Workbooks.Open($path)
  if($wb.ReadOnly){ throw 'Workbook is read-only' }

  $skip=@('Cover','MethodList','Statistics','Guideline')
  $methodSheets=@()
  foreach($ws in $wb.Worksheets){ if($skip -notcontains [string]$ws.Name){ $methodSheets += $ws } }

  # 1) Fix per-method sheets: Created By + N/A/B counts
  foreach($ws in $methodSheets){
    $ws.Cells.Item(2,3).Value2='HaVT'

    $typeRow=FindTypeRow $ws
    $utcCols=FindUtcidCols $ws
    $n=0; $a=0; $b=0
    if($typeRow -gt 0 -and $utcCols.Count -gt 0){
      foreach($c in $utcCols){
        $tv=[string]$ws.Cells.Item($typeRow,$c).Text
        $t=$tv.Trim().ToUpper()
        if($t -eq 'N'){ $n++ }
        elseif($t -eq 'A'){ $a++ }
        elseif($t -eq 'B'){ $b++ }
      }
    }

    # Fallback when type row not detected
    if($n -eq 0 -and $a -eq 0 -and $b -eq 0){
      $n=ToInt $ws.Cells.Item(5,12).Text
      $a=ToInt $ws.Cells.Item(5,13).Text
      $b=ToInt $ws.Cells.Item(5,14).Text
      if(($n+$a+$b) -eq 0){
        $total=ToInt $ws.Cells.Item(5,15).Text
        if($total -gt 0){ $n=$total }
      }
    }

    $ws.Cells.Item(4,12).Value2='N/A/B'
    $ws.Cells.Item(5,12).Value2=[string]$n
    $ws.Cells.Item(5,13).Value2=[string]$a
    $ws.Cells.Item(5,14).Value2=[string]$b
  }

  # 2) Rebuild Statistics table cleanly with TOTAL row at bottom
  $wsStats=$wb.Worksheets.Item('Statistics')
  $wsML=$wb.Worksheets.Item('MethodList')

  # Creator on Statistics
  $wsStats.Cells.Item(4,5).Value2='HaVT'

  # Collect ordered list from MethodList (preferred)
  $ordered=@()
  $r=11
  while(([string]$wsML.Cells.Item($r,1).Text).Trim() -ne ''){
    $sheetName=([string]$wsML.Cells.Item($r,4).Text).Trim()
    if($sheetName -ne ''){
      try {
        $null = $wb.Worksheets.Item($sheetName)
        $ordered += $sheetName
      } catch {}
    }
    $r++
  }
  if($ordered.Count -eq 0){ foreach($ws in $methodSheets){ $ordered += [string]$ws.Name } }

  $wsStats.Range('A12:I1000').ClearContents()

  $row=12
  $sumP=0; $sumF=0; $sumU=0; $sumN=0; $sumA=0; $sumB=0; $sumT=0
  $idx=1
  foreach($sheetName in $ordered){
    $ws=$wb.Worksheets.Item($sheetName)
    $func=[string]$ws.Cells.Item(1,12).Text
    if($func.Trim() -eq ''){ $func=[string]$ws.Cells.Item(1,4).Text }
    if($func.Trim() -eq ''){ $func=$sheetName }

    $p=ToInt $ws.Cells.Item(5,1).Text
    $f=ToInt $ws.Cells.Item(5,3).Text
    $u=ToInt $ws.Cells.Item(5,6).Text
    $n=ToInt $ws.Cells.Item(5,12).Text
    $a=ToInt $ws.Cells.Item(5,13).Text
    $b=ToInt $ws.Cells.Item(5,14).Text
    $t=ToInt $ws.Cells.Item(5,15).Text
    if($t -eq 0){ $t=$p+$f+$u }

    $wsStats.Cells.Item($row,1).Value2=[string]$idx
    $wsStats.Cells.Item($row,2).Value2=$func
    $wsStats.Cells.Item($row,3).Value2=[string]$p
    $wsStats.Cells.Item($row,4).Value2=[string]$f
    $wsStats.Cells.Item($row,5).Value2=[string]$u
    $wsStats.Cells.Item($row,6).Value2=[string]$n
    $wsStats.Cells.Item($row,7).Value2=[string]$a
    $wsStats.Cells.Item($row,8).Value2=[string]$b
    $wsStats.Cells.Item($row,9).Value2=[string]$t

    $sumP+=$p; $sumF+=$f; $sumU+=$u; $sumN+=$n; $sumA+=$a; $sumB+=$b; $sumT+=$t
    $row++; $idx++
  }

  $totalRow=$row
  $wsStats.Cells.Item($totalRow,2).Value2='TOTAL'
  $wsStats.Cells.Item($totalRow,3).Value2=[string]$sumP
  $wsStats.Cells.Item($totalRow,4).Value2=[string]$sumF
  $wsStats.Cells.Item($totalRow,5).Value2=[string]$sumU
  $wsStats.Cells.Item($totalRow,6).Value2=[string]$sumN
  $wsStats.Cells.Item($totalRow,7).Value2=[string]$sumA
  $wsStats.Cells.Item($totalRow,8).Value2=[string]$sumB
  $wsStats.Cells.Item($totalRow,9).Value2=[string]$sumT

  # Style total row for readability
  $wsStats.Range("A$totalRow:I$totalRow").Font.Bold=$true

  # 3) Update pie charts to use TOTAL row
  foreach($co in $wsStats.ChartObjects()){
    $ch=$co.Chart
    $title=''
    try { $title=[string]$ch.ChartTitle.Text } catch {}

    if($title -match 'Passed'){ 
      $series=$ch.SeriesCollection(1)
      $series.XValues = $wsStats.Range('C11:E11')
      $series.Values  = $wsStats.Range("C$totalRow:E$totalRow")
    }
    elseif($title -match 'Test Type'){
      $series=$ch.SeriesCollection(1)
      $series.XValues = $wsStats.Range('F11:H11')
      $series.Values  = $wsStats.Range("F$totalRow:H$totalRow")
    }
  }

  $wb.Save()

  Write-Output ('MethodSheets=' + $methodSheets.Count)
  Write-Output ('StatisticsTotalRow=' + $totalRow)
  Write-Output ('StatisticsTotals P/F/U/N/A/B/T=' + $sumP + '/' + $sumF + '/' + $sumU + '/' + $sumN + '/' + $sumA + '/' + $sumB + '/' + $sumT)

  foreach($check in @('getAllUsers','createVipPurchase_Service','depositToWallet')){
    $ws=$wb.Worksheets.Item($check)
    Write-Output ('CHECK|' + $check + '|CreatedBy=' + [string]$ws.Cells.Item(2,3).Text + '|NAB=' + [string]$ws.Cells.Item(5,12).Text + '/' + [string]$ws.Cells.Item(5,13).Text + '/' + [string]$ws.Cells.Item(5,14).Text)
  }

  $wb.Close($true)
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect(); [gc]::WaitForPendingFinalizers()
}
