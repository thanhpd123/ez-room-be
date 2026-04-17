$ErrorActionPreference = 'Stop'

$unitPath = 'E:\SEP490\EZ-Room_Unit_Test_Report.xlsx'
$integrationPath = 'E:\SEP490\EZ-Room_Integration_Test_Report.xlsx'

function Get-LastDataRow {
    param($ws, [int]$column, [int]$startRow)
    $row = $startRow
    while ($true) {
        $v = $ws.Cells.Item($row, $column).Value2
        if ($null -eq $v -or $v -eq '') { break }
        $row++
    }
    return $row - 1
}

function Ensure-UnitSheet {
    param($wb, [string]$templateSheetName, [string]$newName, [string]$module, [string]$method, [int]$pass, [int]$fail, [int]$total)

    foreach ($s in $wb.Worksheets) {
        if ($s.Name -eq $newName) { return $s }
    }

    $template = $wb.Worksheets.Item($templateSheetName)
    $template.Copy($wb.Worksheets.Item($wb.Worksheets.Count))
    $newSheet = $wb.Worksheets.Item($wb.Worksheets.Count)
    $newSheet.Name = $newName

    $newSheet.Cells.Item(1, 2).Value2 = $module
    $newSheet.Cells.Item(1, 4).Value2 = $method
    $newSheet.Cells.Item(3, 2).Value2 = "Unit tests for $module > $method"

    $newSheet.Cells.Item(5, 1).Value2 = $pass
    $newSheet.Cells.Item(5, 3).Value2 = $fail
    $newSheet.Cells.Item(5, 7).Value2 = 0
    $newSheet.Cells.Item(5, 9).Value2 = $total
    $newSheet.Cells.Item(5, 10).Value2 = 0
    $newSheet.Cells.Item(5, 11).Value2 = 0
    $newSheet.Cells.Item(5, 12).Value2 = $total

    for ($c = 5; $c -le 10; $c++) {
        $newSheet.Cells.Item(7, $c).Value2 = ''
    }
    for ($i = 1; $i -le $total; $i++) {
        $newSheet.Cells.Item(7, 4 + $i).Value2 = ('UTCID' + $i.ToString('00'))
    }

    return $newSheet
}

function Ensure-IntegrationSheet {
    param($wb, [string]$templateSheetName, [string]$newName, [string]$feature, [string]$requirement, [array]$cases)

    foreach ($s in $wb.Worksheets) {
        if ($s.Name -eq $newName) { return $s }
    }

    $template = $wb.Worksheets.Item($templateSheetName)
    $template.Copy($wb.Worksheets.Item($wb.Worksheets.Count))
    $newSheet = $wb.Worksheets.Item($wb.Worksheets.Count)
    $newSheet.Name = $newName

    $tcCount = $cases.Count
    $newSheet.Cells.Item(2, 2).Value2 = $feature
    $newSheet.Cells.Item(3, 2).Value2 = $requirement
    $newSheet.Cells.Item(4, 2).Value2 = [string]$tcCount

    $newSheet.Cells.Item(6, 2).Value2 = '0'
    $newSheet.Cells.Item(6, 3).Value2 = '0'
    $newSheet.Cells.Item(6, 4).Value2 = [string]$tcCount
    $newSheet.Cells.Item(6, 5).Value2 = '0'
    $newSheet.Cells.Item(7, 2).Value2 = '0'
    $newSheet.Cells.Item(7, 3).Value2 = '0'
    $newSheet.Cells.Item(7, 4).Value2 = [string]$tcCount
    $newSheet.Cells.Item(7, 5).Value2 = '0'
    $newSheet.Cells.Item(8, 2).Value2 = '0'
    $newSheet.Cells.Item(8, 3).Value2 = '0'
    $newSheet.Cells.Item(8, 4).Value2 = [string]$tcCount
    $newSheet.Cells.Item(8, 5).Value2 = '0'

    $row = 12
    $idx = 1
    foreach ($case in $cases) {
        $newSheet.Cells.Item($row, 1).Value2 = "[$feature - $idx]"
        $newSheet.Cells.Item($row, 2).Value2 = $case.Description
        $newSheet.Cells.Item($row, 3).Value2 = $case.Procedure
        $newSheet.Cells.Item($row, 4).Value2 = $case.Expected
        $newSheet.Cells.Item($row, 5).Value2 = $case.Precondition
        $newSheet.Cells.Item($row, 6).Value2 = 'Pending'
        $newSheet.Cells.Item($row, 7).Value2 = '03/04/2026'
        $newSheet.Cells.Item($row, 8).Value2 = 'QA'
        $newSheet.Cells.Item($row, 9).Value2 = 'Pending'
        $newSheet.Cells.Item($row, 10).Value2 = '03/04/2026'
        $newSheet.Cells.Item($row, 11).Value2 = 'QA'
        $newSheet.Cells.Item($row, 12).Value2 = 'Pending'
        $row++
        $idx++
    }

    return $newSheet
}

$excel = $null
$unitWb = $null
$intWb = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    # -------- Unit workbook --------
    $unitWb = $excel.Workbooks.Open($unitPath)
    $methodList = $unitWb.Worksheets.Item('MethodList')
    $stats = $unitWb.Worksheets.Item('Statistics')

    $unitNewMethods = @(
        @{ Module='VIP Controller'; Method='getVipPackages'; Sheet='getVipPackages'; Desc='Unit test for getVipPackages (1 test case)'; Pre='User authenticated, server running'; Pass=1; Fail=0; Total=1 },
        @{ Module='VIP Controller'; Method='createVipPurchase'; Sheet='createVipPurchase'; Desc='Unit test for createVipPurchase (2 test cases)'; Pre='User authenticated, server running'; Pass=2; Fail=0; Total=2 },
        @{ Module='VIP Controller'; Method='verifyVipPurchase'; Sheet='verifyVipPurchase'; Desc='Unit test for verifyVipPurchase (1 test case)'; Pre='User authenticated, server running'; Pass=1; Fail=0; Total=1 },
        @{ Module='VIP Service'; Method='getVipPackages_Service'; Sheet='getVipPackages_Service'; Desc='Unit test for VIP service getVipPackages (1 test case)'; Pre='Mock Prisma and PayOS configured'; Pass=1; Fail=0; Total=1 },
        @{ Module='VIP Service'; Method='createVipPurchase_Service'; Sheet='createVipPurchase_Service'; Desc='Unit test for VIP service createVipPurchase (2 test cases)'; Pre='Mock Prisma and PayOS configured'; Pass=0; Fail=2; Total=2 },
        @{ Module='VIP Service'; Method='verifyVipPurchase_Service'; Sheet='verifyVipPurchase_Service'; Desc='Unit test for VIP service verifyVipPurchase (1 test case)'; Pre='Mock Prisma and PayOS configured'; Pass=1; Fail=0; Total=1 },
        @{ Module='Room Service'; Method='createRoom_VIPPolicy'; Sheet='createRoom_VIPPolicy'; Desc='Unit test for room VIP policy in createRoom (2 test cases)'; Pre='Landlord account and rental context mocked'; Pass=2; Fail=0; Total=2 }
    )

    foreach ($m in $unitNewMethods) {
        [void](Ensure-UnitSheet -wb $unitWb -templateSheetName 'getRecommend' -newName $m.Sheet -module $m.Module -method $m.Method -pass $m.Pass -fail $m.Fail -total $m.Total)
    }

    $mlLast = Get-LastDataRow -ws $methodList -column 1 -startRow 11
    $stLast = Get-LastDataRow -ws $stats -column 1 -startRow 12

    foreach ($m in $unitNewMethods) {
        $exists = $false
        for ($r = 11; $r -le $mlLast; $r++) {
            if ($methodList.Cells.Item($r, 3).Text -eq $m.Method) { $exists = $true; break }
        }
        if (-not $exists) {
            $mlLast++
            $methodList.Rows.Item($mlLast - 1).Copy()
            $methodList.Rows.Item($mlLast).PasteSpecial(-4122)
            $methodList.Cells.Item($mlLast, 1).Value2 = [string]($mlLast - 10)
            $methodList.Cells.Item($mlLast, 2).Value2 = $m.Module
            $methodList.Cells.Item($mlLast, 3).Value2 = $m.Method
            $methodList.Cells.Item($mlLast, 4).Value2 = $m.Sheet
            $methodList.Cells.Item($mlLast, 5).Value2 = $m.Desc
            $methodList.Cells.Item($mlLast, 6).Value2 = $m.Pre
        }

        $existsSt = $false
        for ($r = 12; $r -le $stLast; $r++) {
            if ($stats.Cells.Item($r, 2).Text -eq $m.Method) { $existsSt = $true; break }
        }
        if (-not $existsSt) {
            $stLast++
            $stats.Rows.Item($stLast - 1).Copy()
            $stats.Rows.Item($stLast).PasteSpecial(-4122)
            $stats.Cells.Item($stLast, 1).Value2 = [string]($stLast - 11)
            $stats.Cells.Item($stLast, 2).Value2 = $m.Method
            $stats.Cells.Item($stLast, 3).Value2 = [string]$m.Pass
            $stats.Cells.Item($stLast, 4).Value2 = [string]$m.Fail
            $stats.Cells.Item($stLast, 5).Value2 = '0'
            $stats.Cells.Item($stLast, 6).Value2 = [string]$m.Total
            $stats.Cells.Item($stLast, 7).Value2 = '0'
            $stats.Cells.Item($stLast, 8).Value2 = '0'
            $stats.Cells.Item($stLast, 9).Value2 = [string]$m.Total
        }
    }

    $unitWb.Save()
    $unitWb.Close($true)

    # -------- Integration workbook --------
    $intWb = $excel.Workbooks.Open($integrationPath)
    $tcSheet = $intWb.Worksheets.Item('Test Cases')
    $tsSheet = $intWb.Worksheets.Item('Test Statistics')

    $integrationModules = @(
        @{
            Feature='View VIP packages';
            Sheet='View VIP packages';
            Desc='Test viewing active VIP packages by role';
            Pre='Server must be running. VIP package data exists.';
            Cases=@(
                @{ Description='Get all active VIP packages'; Procedure='1. Call GET /vip/packages.`n2. Verify response data.'; Expected='Return 200 and package list.'; Precondition='Server is running.' },
                @{ Description='Filter packages by TENANT role'; Procedure='1. Call GET /vip/packages?targetRole=TENANT.`n2. Verify all returned targetRole.'; Expected='Return 200 and only TENANT packages.'; Precondition='Active TENANT package exists.' },
                @{ Description='Filter packages by LANDLORD role'; Procedure='1. Call GET /vip/packages?targetRole=LANDLORD.`n2. Verify all returned targetRole.'; Expected='Return 200 and only LANDLORD packages.'; Precondition='Active LANDLORD package exists.' },
                @{ Description='Invalid role filter'; Procedure='1. Call GET /vip/packages?targetRole=INVALID.`n2. Observe validation behavior.'; Expected='Return validation error or empty list by design.'; Precondition='Server is running.' }
            )
        },
        @{
            Feature='Create VIP purchase';
            Sheet='Create VIP purchase';
            Desc='Test creating VIP purchase payment order';
            Pre='Server must be running. User logged in. Package exists.';
            Cases=@(
                @{ Description='Create purchase for matching role package'; Procedure='1. Login as TENANT/LANDLORD.`n2. POST /vip/purchase with valid packageId.'; Expected='Return 201 with payment checkout data.'; Precondition='Valid token and packageId.' },
                @{ Description='Reject when package role mismatch'; Procedure='1. Login as TENANT.`n2. POST package of LANDLORD role.'; Expected='Return 403 forbidden by role mismatch.'; Precondition='Mismatched package exists.' },
                @{ Description='Reject invalid packageId'; Procedure='1. Login user.`n2. POST /vip/purchase with invalid packageId.'; Expected='Return 400/404 by validation.'; Precondition='Valid token.' },
                @{ Description='Reject missing token'; Procedure='1. POST /vip/purchase without Authorization header.'; Expected='Return 401 unauthorized.'; Precondition='Server is running.' }
            )
        },
        @{
            Feature='Verify VIP purchase';
            Sheet='Verify VIP purchase';
            Desc='Test verifying and activating VIP purchase';
            Pre='Server must be running. Payment order was created.';
            Cases=@(
                @{ Description='Verify paid order successfully'; Procedure='1. Login user.`n2. GET /vip/verify?orderCode=<paid>.'; Expected='Return 200 and activated=true.'; Precondition='Order status PAID.' },
                @{ Description='Verify pending order'; Procedure='1. Login user.`n2. GET /vip/verify?orderCode=<pending>.'; Expected='Return pending status and not activate VIP.'; Precondition='Order status PENDING.' },
                @{ Description='Verify with invalid orderCode'; Procedure='1. Login user.`n2. GET /vip/verify?orderCode=invalid.'; Expected='Return 404/400 error.'; Precondition='Invalid order code.' },
                @{ Description='Verify without token'; Procedure='1. GET /vip/verify without Authorization.'; Expected='Return 401 unauthorized.'; Precondition='Server is running.' }
            )
        }
    )

    foreach ($m in $integrationModules) {
        [void](Ensure-IntegrationSheet -wb $intWb -templateSheetName 'View wallet' -newName $m.Sheet -feature $m.Feature -requirement $m.Desc -cases $m.Cases)
    }

    $tcLast = Get-LastDataRow -ws $tcSheet -column 1 -startRow 9
    $tsLast = Get-LastDataRow -ws $tsSheet -column 1 -startRow 11

    foreach ($m in $integrationModules) {
        $existsTc = $false
        for ($r = 9; $r -le $tcLast; $r++) {
            if ($tcSheet.Cells.Item($r, 2).Text -eq $m.Feature) { $existsTc = $true; break }
        }
        if (-not $existsTc) {
            $tcLast++
            $tcSheet.Rows.Item($tcLast - 1).Copy()
            $tcSheet.Rows.Item($tcLast).PasteSpecial(-4122)
            $tcSheet.Cells.Item($tcLast, 1).Value2 = [string]($tcLast - 8)
            $tcSheet.Cells.Item($tcLast, 2).Value2 = $m.Feature
            $tcSheet.Cells.Item($tcLast, 3).Value2 = $m.Sheet
            $tcSheet.Cells.Item($tcLast, 4).Value2 = $m.Desc
            $tcSheet.Cells.Item($tcLast, 5).Value2 = $m.Pre
        }

        $existsTs = $false
        for ($r = 11; $r -le $tsLast; $r++) {
            if ($tsSheet.Cells.Item($r, 2).Text -eq $m.Feature) { $existsTs = $true; break }
        }
        if (-not $existsTs) {
            $tsLast++
            $tsSheet.Rows.Item($tsLast - 1).Copy()
            $tsSheet.Rows.Item($tsLast).PasteSpecial(-4122)
            $tsSheet.Cells.Item($tsLast, 1).Value2 = [string]($tsLast - 10)
            $tsSheet.Cells.Item($tsLast, 2).Value2 = $m.Feature
            $tsSheet.Cells.Item($tsLast, 3).Value2 = '0'
            $tsSheet.Cells.Item($tsLast, 4).Value2 = '0'
            $tsSheet.Cells.Item($tsLast, 5).Value2 = [string]$m.Cases.Count
            $tsSheet.Cells.Item($tsLast, 6).Value2 = '0'
            $tsSheet.Cells.Item($tsLast, 7).Value2 = [string]$m.Cases.Count
        }
    }

    # Update total integration test cases cell on Test Cases sheet if numeric
    $currentTotal = $tcSheet.Cells.Item(6, 3).Value2
    if ($currentTotal -is [double] -or $currentTotal -is [int]) {
        $tcSheet.Cells.Item(6, 3).Value2 = [string]([int]$currentTotal + 12)
    }

    $intWb.Save()
    $intWb.Close($true)

    Write-Output 'Updated both Excel reports successfully.'
}
finally {
    if ($unitWb) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($unitWb) }
    if ($intWb) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($intWb) }
    if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}
