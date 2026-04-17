$ErrorActionPreference='Stop'
$path='E:\SEP490\Report5.1_Unit Test (1).xlsx'
Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
function LastRow($ws,$col,$start){ $r=$start; while(([string]$ws.Cells.Item($r,$col).Text).Trim() -ne ''){ $r++ }; return ($r-1) }
function ToInt($v){ if($null -eq $v){ return 0 }; $s=[string]$v; if($s.Trim() -eq ''){ return 0 }; $n=0; if([int]::TryParse($s.Trim(), [ref]$n)){ return $n }; return 0 }
try {
  $wb=$excel.Workbooks.Open($path)
  if($wb.ReadOnly){ throw 'Workbook is read-only' }

  $ml=$wb.Worksheets.Item('MethodList')
  $st=$wb.Worksheets.Item('Statistics')
  $mlLast=LastRow $ml 1 11

  # 1) MethodList table formatting + hyperlinks in Sheet Name
  $mlDataRange=$ml.Range("A10:F$mlLast")
  $mlDataRange.NumberFormat='@'
  $mlDataRange.WrapText=$false
  $mlDataRange.VerticalAlignment=-4108

  # Uniform borders and readable layout
  $borders=$mlDataRange.Borders
  $borders.LineStyle=1
  $borders.Weight=2

  # Column widths to keep all values inside table
  $ml.Columns.Item('A').ColumnWidth=6
  $ml.Columns.Item('B').ColumnWidth=22
  $ml.Columns.Item('C').ColumnWidth=20
  $ml.Columns.Item('D').ColumnWidth=18
  $ml.Columns.Item('E').ColumnWidth=48
  $ml.Columns.Item('F').ColumnWidth=38

  # Add hyperlinks for Sheet Name column (D)
  for($r=11; $r -le $mlLast; $r++){
    $sheetName=([string]$ml.Cells.Item($r,4).Text).Trim()
    if($sheetName -eq ''){ continue }
    try {
      $null = $wb.Worksheets.Item($sheetName)
      # Remove old hyperlink if exists
      try { if($ml.Cells.Item($r,4).Hyperlinks.Count -gt 0){ $ml.Cells.Item($r,4).Hyperlinks.Delete() } } catch {}
      $anchor=$ml.Cells.Item($r,4)
      $subAddr="'" + $sheetName.Replace("'","''") + "'!A1"
      $ml.Hyperlinks.Add($anchor, '', $subAddr, 'Go to sheet', $sheetName) | Out-Null
      $anchor.Font.Underline=1
      $anchor.Font.ColorIndex=5
    } catch {
      # leave text as-is when sheet missing
    }
  }

  # 2) Rebuild Statistics numeric values from each sheet to eliminate percent/### corruption
  $st.Range('A12:I1000').ClearContents()
  $idx=1
  $sumP=0; $sumF=0; $sumU=0; $sumN=0; $sumA=0; $sumB=0; $sumT=0
  for($r=11; $r -le $mlLast; $r++){
    $sheetName=([string]$ml.Cells.Item($r,4).Text).Trim()
    if($sheetName -eq ''){ continue }
    try {
      $ws=$wb.Worksheets.Item($sheetName)
    } catch { continue }

    $func=([string]$ml.Cells.Item($r,3).Text).Trim()
    if($func -eq ''){ $func=$sheetName }

    $p=ToInt $ws.Cells.Item(5,1).Text
    $f=ToInt $ws.Cells.Item(5,3).Text
    $u=ToInt $ws.Cells.Item(5,6).Text
    $n=ToInt $ws.Cells.Item(5,12).Text
    $a=ToInt $ws.Cells.Item(5,13).Text
    $b=ToInt $ws.Cells.Item(5,14).Text
    $t=ToInt $ws.Cells.Item(5,15).Text
    if($t -eq 0){ $t=$p+$f+$u }

    $row=11+$idx
    $st.Cells.Item($row,1).Value2=[string]$idx
    $st.Cells.Item($row,2).Value2=$func
    $st.Cells.Item($row,3).Value2=[string]$p
    $st.Cells.Item($row,4).Value2=[string]$f
    $st.Cells.Item($row,5).Value2=[string]$u
    $st.Cells.Item($row,6).Value2=[string]$n
    $st.Cells.Item($row,7).Value2=[string]$a
    $st.Cells.Item($row,8).Value2=[string]$b
    $st.Cells.Item($row,9).Value2=[string]$t

    $sumP+=$p; $sumF+=$f; $sumU+=$u; $sumN+=$n; $sumA+=$a; $sumB+=$b; $sumT+=$t
    $idx++
  }

  $totalRow=11+$idx
  $st.Cells.Item($totalRow,2).Value2='TOTAL'
  $st.Cells.Item($totalRow,3).Value2=[string]$sumP
  $st.Cells.Item($totalRow,4).Value2=[string]$sumF
  $st.Cells.Item($totalRow,5).Value2=[string]$sumU
  $st.Cells.Item($totalRow,6).Value2=[string]$sumN
  $st.Cells.Item($totalRow,7).Value2=[string]$sumA
  $st.Cells.Item($totalRow,8).Value2=[string]$sumB
  $st.Cells.Item($totalRow,9).Value2=[string]$sumT

  $stRange=$st.Range("A11:I$totalRow")
  $stRange.NumberFormat='0'
  $st.Columns.Item('A').ColumnWidth=6
  $st.Columns.Item('B').ColumnWidth=28
  $st.Columns.Item('C').ColumnWidth=10
  $st.Columns.Item('D').ColumnWidth=10
  $st.Columns.Item('E').ColumnWidth=10
  $st.Columns.Item('F').ColumnWidth=7
  $st.Columns.Item('G').ColumnWidth=7
  $st.Columns.Item('H').ColumnWidth=7
  $st.Columns.Item('I').ColumnWidth=16
  $stRange.Borders.LineStyle=1
  $stRange.Borders.Weight=2
  $st.Range("A$totalRow:I$totalRow").Font.Bold=$true

  # Re-point pie charts to TOTAL row ranges
  foreach($co in $st.ChartObjects()){
    $ch=$co.Chart
    $title=''
    try{ $title=[string]$ch.ChartTitle.Text } catch {}
    $series=$ch.SeriesCollection(1)
    if($title -match 'Passed'){ $series.Formula = '=SERIES(,Statistics!$C$11:$E$11,Statistics!$C$'+$totalRow+':$E$'+$totalRow+',1)' }
    elseif($title -match 'Test Type'){ $series.Formula = '=SERIES(,Statistics!$F$11:$H$11,Statistics!$F$'+$totalRow+':$H$'+$totalRow+',1)' }
  }

  $wb.Save()

  Write-Output ('MethodListRows=' + ($mlLast-10))
  Write-Output ('StatisticsTotalRow=' + $totalRow)
  Write-Output ('StatisticsTotals=' + $sumP + '/' + $sumF + '/' + $sumU + '/' + $sumN + '/' + $sumA + '/' + $sumB + '/' + $sumT)

  # Quick checks
  for($r=11; $r -le [Math]::Min($mlLast,15); $r++){
    $linkCount=0
    try { $linkCount=$ml.Cells.Item($r,4).Hyperlinks.Count } catch {}
    Write-Output ('ML_LINK R' + $r + ' sheet=' + [string]$ml.Cells.Item($r,4).Text + ' links=' + $linkCount)
  }
  Write-Output ('ST_SAMPLE_R17=' + [string]$st.Cells.Item(17,2).Text + '|' + [string]$st.Cells.Item(17,3).Text + '|' + [string]$st.Cells.Item(17,4).Text + '|' + [string]$st.Cells.Item(17,5).Text + '|' + [string]$st.Cells.Item(17,6).Text + '|' + [string]$st.Cells.Item(17,7).Text + '|' + [string]$st.Cells.Item(17,8).Text + '|' + [string]$st.Cells.Item(17,9).Text)

  $wb.Close($true)
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect(); [gc]::WaitForPendingFinalizers()
}
