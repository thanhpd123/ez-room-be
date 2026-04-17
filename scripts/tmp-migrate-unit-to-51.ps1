$ErrorActionPreference='Stop'
$srcPath='E:\SEP490\EZ-Room_Unit_Test_Report.xlsx'
$dstPath='E:\SEP490\Report5.1_Unit Test (1).xlsx'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
try {
  $src=$excel.Workbooks.Open($srcPath)
  $dst=$excel.Workbooks.Open($dstPath)
  if($dst.ReadOnly){ throw 'Destination workbook is read-only' }

  $srcSummary=@('Cover','MethodList','Statistics')
  $srcMethodNames=@()
  foreach($ws in $src.Worksheets){
    if($srcSummary -notcontains [string]$ws.Name){ $srcMethodNames += [string]$ws.Name }
  }

  $templateName='methodName2'
  if(@($dst.Worksheets | Where-Object { $_.Name -eq $templateName }).Count -eq 0){ $templateName='getAllUsers' }

  $keepNames=@('Guideline','Cover','MethodList','Statistics',$templateName)
  $toDelete=@()
  foreach($ws in $dst.Worksheets){ if($keepNames -notcontains [string]$ws.Name){ $toDelete += [string]$ws.Name } }
  foreach($n in $toDelete){ $dst.Worksheets.Item($n).Delete() }

  foreach($name in $srcMethodNames){
    if(@($dst.Worksheets | Where-Object { $_.Name -eq $name }).Count -gt 0){ $dst.Worksheets.Item($name).Delete() }

    $templateSheet=$dst.Worksheets.Item($templateName)
    $afterSheet=$dst.Worksheets.Item($dst.Worksheets.Count)
    $templateSheet.Copy([Type]::Missing, $afterSheet)
    $newWs=$dst.Worksheets.Item($dst.Worksheets.Count)
    $newWs.Name=$name
    $newWs.Range('A1:Z1000').ClearContents()

    $srcWs=$src.Worksheets.Item($name)
    $used=$srcWs.UsedRange
    $rows=$used.Rows.Count
    $cols=$used.Columns.Count
    $vals=$srcWs.Range($srcWs.Cells.Item(1,1),$srcWs.Cells.Item($rows,$cols)).Value2
    $newWs.Range($newWs.Cells.Item(1,1),$newWs.Cells.Item($rows,$cols)).Value2=$vals
  }

  foreach($sumName in $srcSummary){
    if(@($dst.Worksheets | Where-Object { $_.Name -eq $sumName }).Count -gt 0){
      $srcWs=$src.Worksheets.Item($sumName)
      $dstWs=$dst.Worksheets.Item($sumName)
      $dstWs.Range('A1:Z1000').ClearContents()
      $used=$srcWs.UsedRange
      $rows=$used.Rows.Count
      $cols=$used.Columns.Count
      $vals=$srcWs.Range($srcWs.Cells.Item(1,1),$srcWs.Cells.Item($rows,$cols)).Value2
      $dstWs.Range($dstWs.Cells.Item(1,1),$dstWs.Cells.Item($rows,$cols)).Value2=$vals
    }
  }

  if(@($dst.Worksheets | Where-Object { $_.Name -eq $templateName }).Count -gt 0){ $dst.Worksheets.Item($templateName).Delete() }

  $dst.Save()
  Write-Output ('Copied methods=' + $srcMethodNames.Count)
  Write-Output ('Destination sheets=' + $dst.Worksheets.Count)
  foreach($check in @('Cover','MethodList','Statistics','getAllUsers','depositToWallet','createVipPurchase_Service')){
    if(@($dst.Worksheets | Where-Object { $_.Name -eq $check }).Count -gt 0){
      $ws=$dst.Worksheets.Item($check)
      Write-Output ('CHECK|' + $check + '|B1=' + [string]$ws.Cells.Item(1,2).Text + '|D1=' + [string]$ws.Cells.Item(1,4).Text + '|B2=' + [string]$ws.Cells.Item(2,2).Text)
    } else {
      Write-Output ('CHECK|' + $check + '|MISSING')
    }
  }

  $src.Close($false)
  $dst.Close($true)
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
