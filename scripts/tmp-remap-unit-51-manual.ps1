$ErrorActionPreference='Stop'
$srcPath='E:\SEP490\EZ-Room_Unit_Test_Report.xlsx'
$dstPath='E:\SEP490\Report5.1_Unit Test (1).xlsx'
Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
function Set-CellValueSafe($ws,[int]$r,[int]$c,$value){
  $cell=$ws.Cells.Item($r,$c)
  if($cell.MergeCells){ $area=$cell.MergeArea; if($cell.Row -ne $area.Row -or $cell.Column -ne $area.Column){ return } }
  if($null -eq $value){ return }
  $cell.Value2=[string]$value
}
function LastRowByCol($ws,[int]$col,[int]$start){ $r=$start; while(([string]$ws.Cells.Item($r,$col).Text) -ne ''){ $r++ }; return ($r-1) }
try {
  $srcWb=$excel.Workbooks.Open($srcPath)
  $dstWb=$excel.Workbooks.Open($dstPath)
  if($dstWb.ReadOnly){ throw 'Destination workbook is read-only' }
  if(@($dstWb.Worksheets | Where-Object { $_.Name -eq 'Guideline' }).Count -gt 0){ $dstWb.Worksheets.Item('Guideline').Delete() }

  $summary=@('Cover','MethodList','Statistics')
  $methodNames=@(); foreach($w in $srcWb.Worksheets){ if($summary -notcontains [string]$w.Name){ $methodNames += [string]$w.Name } }

  foreach($name in $methodNames){
    if(@($dstWb.Worksheets | Where-Object { $_.Name -eq $name }).Count -eq 0){ continue }
    $s=$srcWb.Worksheets.Item($name); $d=$dstWb.Worksheets.Item($name)
    $d.Cells.Item(1,1).Value2='Code Module'; $d.Cells.Item(1,3).Value2=[string]$s.Cells.Item(1,2).Text
    $d.Cells.Item(1,6).Value2='Method'; $d.Cells.Item(1,12).Value2=[string]$s.Cells.Item(1,4).Text
    $d.Cells.Item(2,1).Value2='Created By'; $d.Cells.Item(2,3).Value2=[string]$s.Cells.Item(2,2).Text
    $d.Cells.Item(2,6).Value2='Executed By'; $d.Cells.Item(2,12).Value2=[string]$s.Cells.Item(2,4).Text
    $d.Cells.Item(3,1).Value2='Test requirement'; $d.Cells.Item(3,3).Value2=[string]$s.Cells.Item(3,2).Text
    $d.Cells.Item(4,1).Value2='Passed'; $d.Cells.Item(4,3).Value2='Failed'; $d.Cells.Item(4,6).Value2='Untested'; $d.Cells.Item(4,12).Value2='N/A/B'; $d.Cells.Item(4,15).Value2='Total Test Cases'
    $d.Cells.Item(5,1).Value2=[string]$s.Cells.Item(5,1).Text; $d.Cells.Item(5,3).Value2=[string]$s.Cells.Item(5,3).Text; $d.Cells.Item(5,6).Value2=[string]$s.Cells.Item(5,6).Text
    $d.Cells.Item(5,12).Value2=[string]$s.Cells.Item(5,9).Text; $d.Cells.Item(5,13).Value2=[string]$s.Cells.Item(5,10).Text; $d.Cells.Item(5,14).Value2=[string]$s.Cells.Item(5,11).Text; $d.Cells.Item(5,15).Value2=[string]$s.Cells.Item(5,12).Text
    $d.Range('A7:Z1000').ClearContents()
    $used=$s.UsedRange; $rows=$used.Rows.Count; $cols=[Math]::Min(26,$used.Columns.Count)
    if($rows -ge 7){ for($r=7;$r -le $rows;$r++){ for($c=1;$c -le $cols;$c++){ $v=$s.Cells.Item($r,$c).Value2; if($null -ne $v -and $v -ne ''){ Set-CellValueSafe $d $r $c $v } } } }
  }

  $sCover=$srcWb.Worksheets.Item('Cover'); $dCover=$dstWb.Worksheets.Item('Cover')
  $dCover.Cells.Item(4,3).Value2=[string]$sCover.Cells.Item(4,2).Text; $dCover.Cells.Item(5,3).Value2=[string]$sCover.Cells.Item(5,2).Text; $dCover.Cells.Item(6,3).Value2=[string]$sCover.Cells.Item(6,2).Text
  $dCover.Cells.Item(4,6).Value2=[string]$sCover.Cells.Item(4,5).Text; $dCover.Cells.Item(5,6).Value2=[string]$sCover.Cells.Item(5,5).Text; $dCover.Cells.Item(6,6).Value2=[string]$sCover.Cells.Item(6,5).Text
  $dCover.Cells.Item(7,3).Value2=[string]$sCover.Cells.Item(7,2).Text; $dCover.Cells.Item(9,3).Value2=[string]$sCover.Cells.Item(9,2).Text

  $sML=$srcWb.Worksheets.Item('MethodList'); $dML=$dstWb.Worksheets.Item('MethodList')
  $dML.Cells.Item(4,3).Value2=[string]$sML.Cells.Item(4,2).Text; $dML.Cells.Item(5,3).Value2=[string]$sML.Cells.Item(5,2).Text; $dML.Cells.Item(6,3).Value2=[string]$sML.Cells.Item(6,2).Text
  $dML.Range('A11:F1000').ClearContents(); $mlLast=LastRowByCol $sML 1 11
  if($mlLast -ge 11){ for($r=11;$r -le $mlLast;$r++){ for($c=1;$c -le 6;$c++){ Set-CellValueSafe $dML $r $c $sML.Cells.Item($r,$c).Value2 } } }

  $sSt=$srcWb.Worksheets.Item('Statistics'); $dSt=$dstWb.Worksheets.Item('Statistics')
  $dSt.Cells.Item(4,2).Value2=[string]$sSt.Cells.Item(4,2).Text; $dSt.Cells.Item(4,5).Value2=[string]$sSt.Cells.Item(4,5).Text
  $dSt.Cells.Item(5,2).Value2=[string]$sSt.Cells.Item(5,2).Text; $dSt.Cells.Item(5,5).Value2=[string]$sSt.Cells.Item(5,5).Text
  $dSt.Cells.Item(6,2).Value2=[string]$sSt.Cells.Item(6,2).Text; $dSt.Cells.Item(6,6).Value2=[string]$sSt.Cells.Item(6,5).Text
  $dSt.Cells.Item(7,2).Value2=[string]$sSt.Cells.Item(7,2).Text
  $dSt.Range('A12:I1000').ClearContents(); $stLast=LastRowByCol $sSt 1 12
  if($stLast -ge 12){ for($r=12;$r -le $stLast;$r++){ for($c=1;$c -le 9;$c++){ Set-CellValueSafe $dSt $r $c $sSt.Cells.Item($r,$c).Value2 } } }

  $dstWb.Save()
  Write-Output ('FinalSheetCount=' + $dstWb.Worksheets.Count)
  Write-Output ('ExpectedSheetCount=' + $srcWb.Worksheets.Count)
  foreach($check in @('getAllUsers','depositToWallet','createVipPurchase_Service')){ $ws=$dstWb.Worksheets.Item($check); Write-Output ('CHECK|' + $check + '|module=' + [string]$ws.Cells.Item(1,3).Text + '|method=' + [string]$ws.Cells.Item(1,12).Text + '|P=' + [string]$ws.Cells.Item(5,1).Text + '|F=' + [string]$ws.Cells.Item(5,3).Text + '|U=' + [string]$ws.Cells.Item(5,6).Text + '|T=' + [string]$ws.Cells.Item(5,15).Text) }

  $srcWb.Close($false); $dstWb.Close($true)
}
finally { $excel.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel); [gc]::Collect(); [gc]::WaitForPendingFinalizers() }
