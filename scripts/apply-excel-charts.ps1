param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('unit', 'integration')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Remove-ExistingCharts {
    param([object]$Worksheet)

    $toDelete = @()
    foreach ($chartObj in $Worksheet.ChartObjects()) {
        if ($chartObj.Name -like 'AutoChart_*') {
            $toDelete += $chartObj
        }
    }

    foreach ($chart in $toDelete) {
        $chart.Delete() | Out-Null
    }
}

function Add-PieChart {
    param(
        [object]$Worksheet,
        [string]$Name,
        [string]$Title,
        [string]$RangeAddress,
        [double]$Left,
        [double]$Top,
        [double]$Width,
        [double]$Height,
        [bool]$ShowPercent = $true
    )

    $chartObj = $Worksheet.ChartObjects().Add($Left, $Top, $Width, $Height)
    $chartObj.Name = $Name
    $chart = $chartObj.Chart

    # 5 = xlPie
    $chart.ChartType = 5
    $chart.SetSourceData($Worksheet.Range($RangeAddress))
    $chart.HasTitle = $true
    $chart.ChartTitle.Text = $Title
    $chart.HasLegend = $true

    # Some Office builds throw "Parameter not valid" when setting DataLabels
    # properties individually; use conservative defaults for compatibility.
    try {
        $series = $chart.SeriesCollection(1)
        $series.HasDataLabels = $true
    } catch {
        # Ignore label configuration errors and keep chart creation successful.
    }

    return $chartObj
}

function Apply-UnitCharts {
    param([object]$Workbook)

    $ws = $Workbook.Worksheets.Item('Statistics')
    Remove-ExistingCharts -Worksheet $ws

    $used = $ws.UsedRange
    $rowCount = $used.Rows.Count

    $totalRow = $null
    for ($r = 1; $r -le $rowCount; $r++) {
        $text = [string]$ws.Cells.Item($r, 2).Value2
        if ($text -eq 'TOTAL') {
            $totalRow = $r
            break
        }
    }

    if (-not $totalRow) {
        throw 'Cannot find TOTAL row in Statistics sheet.'
    }

    $passed = [int]($ws.Cells.Item($totalRow, 3).Value2)
    $failed = [int]($ws.Cells.Item($totalRow, 4).Value2)
    $untested = [int]($ws.Cells.Item($totalRow, 5).Value2)
    $nCount = [int]($ws.Cells.Item($totalRow, 6).Value2)
    $aCount = [int]($ws.Cells.Item($totalRow, 7).Value2)
    $bCount = [int]($ws.Cells.Item($totalRow, 8).Value2)

    # Data area (hidden helper columns)
    $ws.Cells.Item(4, 20).Value2 = 'Passed Percent'
    $ws.Cells.Item(5, 20).Value2 = 'Passed'
    $ws.Cells.Item(5, 21).Value2 = $passed
    $ws.Cells.Item(6, 20).Value2 = 'Failed'
    $ws.Cells.Item(6, 21).Value2 = $failed
    $ws.Cells.Item(7, 20).Value2 = 'Untested'
    $ws.Cells.Item(7, 21).Value2 = $untested

    $ws.Cells.Item(4, 23).Value2 = 'Test Type'
    $ws.Cells.Item(5, 23).Value2 = 'N'
    $ws.Cells.Item(5, 24).Value2 = $nCount
    $ws.Cells.Item(6, 23).Value2 = 'A'
    $ws.Cells.Item(6, 24).Value2 = $aCount
    $ws.Cells.Item(7, 23).Value2 = 'B'
    $ws.Cells.Item(7, 24).Value2 = $bCount

    # Keep helper columns hidden
    $ws.Columns.Item('T:X').Hidden = $true

    Add-PieChart -Worksheet $ws -Name 'AutoChart_Unit_Passed' -Title 'Passed Percent' -RangeAddress 'T5:U7' -Left 35 -Top 360 -Width 340 -Height 215 -ShowPercent $true | Out-Null
    Add-PieChart -Worksheet $ws -Name 'AutoChart_Unit_Type' -Title 'Test Type' -RangeAddress 'W5:X7' -Left 400 -Top 360 -Width 340 -Height 215 -ShowPercent $false | Out-Null
}

function Apply-IntegrationCharts {
    param([object]$Workbook)

    $ws = $Workbook.Worksheets.Item('Test Statistics')
    Remove-ExistingCharts -Worksheet $ws

    $used = $ws.UsedRange
    $rowCount = $used.Rows.Count

    $subRow = $null
    for ($r = 1; $r -le $rowCount; $r++) {
        $text = [string]$ws.Cells.Item($r, 2).Value2
        if ($text -eq 'Sub total') {
            $subRow = $r
            break
        }
    }

    if (-not $subRow) {
        throw 'Cannot find Sub total row in Test Statistics sheet.'
    }

    $passed = [int]($ws.Cells.Item($subRow, 3).Value2)
    $failed = [int]($ws.Cells.Item($subRow, 4).Value2)
    $pending = [int]($ws.Cells.Item($subRow, 5).Value2)
    $na = [int]($ws.Cells.Item($subRow, 6).Value2)

    $ws.Cells.Item(4, 20).Value2 = 'Integration Status'
    $ws.Cells.Item(5, 20).Value2 = 'Passed'
    $ws.Cells.Item(5, 21).Value2 = $passed
    $ws.Cells.Item(6, 20).Value2 = 'Failed'
    $ws.Cells.Item(6, 21).Value2 = $failed
    $ws.Cells.Item(7, 20).Value2 = 'Pending'
    $ws.Cells.Item(7, 21).Value2 = $pending
    $ws.Cells.Item(8, 20).Value2 = 'N/A'
    $ws.Cells.Item(8, 21).Value2 = $na

    $ws.Columns.Item('T:U').Hidden = $true

    Add-PieChart -Worksheet $ws -Name 'AutoChart_Integration_Status' -Title 'Integration Status' -RangeAddress 'T5:U8' -Left 210 -Top 370 -Width 360 -Height 230 -ShowPercent $true | Out-Null
}

if (-not (Test-Path $WorkbookPath)) {
    throw "Workbook not found: $WorkbookPath"
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($WorkbookPath)

    if ($Mode -eq 'unit') {
        Apply-UnitCharts -Workbook $wb
    } else {
        Apply-IntegrationCharts -Workbook $wb
    }

    $wb.Save()
    $wb.Close($true)
} finally {
    if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
    if ($excel) {
        $excel.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
