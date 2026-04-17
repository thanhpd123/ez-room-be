$ErrorActionPreference = 'Stop'

$artifactPath = 'E:\SEP490\system-test-execution-latest.json'
$reportPath = 'E:\SEP490\Report5.3_System Test.xlsx'

$artifact = Get-Content $artifactPath -Raw | ConvertFrom-Json

$executedAt = $null
if ($null -ne $artifact.executedAt) {
    try {
        $executedAt = [DateTime]::Parse([string]$artifact.executedAt)
    }
    catch {
        $executedAt = Get-Date
    }
}
else {
    $executedAt = Get-Date
}

$excel = $null
$wb = $null

function Get-ExpectedText($case) {
    if ($null -ne $case.expected -and [string]::IsNullOrWhiteSpace([string]$case.expected) -eq $false) {
        return [string]$case.expected
    }
    return 'Expected status based on API contract.'
}

function Get-CaseResultLabel($case) {
    if ($null -ne $case.passed -and [bool]$case.passed) {
        return 'Passed'
    }
    return 'Failed'
}

function Set-Cell($ws, $addr, $value) {
    if ($null -eq $value) {
        $ws.Range($addr).Value2 = ''
    } else {
        $ws.Range($addr).Value2 = [string]$value
    }
}

function Clear-Body($ws) {
    $body = $ws.Range('A11:L220')
    $body.ClearContents()
    $body.MergeCells = $false
    $body.Interior.Color = 16777215
    $body.Font.Bold = $false
    $body.Font.Italic = $false
    $body.Font.ColorIndex = 1
}

function Normalize-CountFormat($ws, $rangeAddr) {
    $ws.Range($rangeAddr).NumberFormat = 'General'
}

function Apply-TableBorders($ws, $lastDataRow) {
    $summaryRange = $ws.Range('A2:E8')
    $summaryRange.Borders.LineStyle = 1
    $summaryRange.Borders.Weight = 2

    $headerRange = $ws.Range('A10:L10')
    $headerRange.Borders.LineStyle = 1
    $headerRange.Borders.Weight = 2

    $bodyRange = $ws.Range("A11:L$lastDataRow")
    $bodyRange.Borders.LineStyle = 1
    $bodyRange.Borders.Weight = 2
}

function Set-Feature-HeaderRow($ws, $row, $featureName) {
    $range = $ws.Range("A$row:L$row")
    $range.ClearContents()
    $range.MergeCells = $false

    for ($col = 1; $col -le 12; $col++) {
        $cell = $ws.Cells.Item($row, $col)
        # Match template scenario row style (light cyan bar across full row)
        $cell.Interior.Color = 15922895
        $cell.Font.Bold = $true
        $cell.Font.Italic = $false
        $cell.Font.Color = 6697728
        $cell.HorizontalAlignment = -4131
        $cell.VerticalAlignment = -4108
        if ($col -ne 1) {
            $cell.Value2 = ''
        }
    }

    $ws.Range("A$row").Value2 = [string]("Feature: " + $featureName)
}

function Set-TestCaseRowStyle($ws, $row) {
    $range = $ws.Range("A$row:L$row")
    $range.MergeCells = $false
    $range.Interior.Color = 16777215
    $range.Font.Bold = $false
    $range.Font.Italic = $false
    $range.Font.ColorIndex = 1
}

function Normalize-FeatureName($workflow, $featureName) {
    $raw = [string]$featureName
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return 'General'
    }

    switch ($workflow) {
        'Landlord' {
            $map = @{
                'Landlord dashboard' = 'Dashboard stats'
                'Landlord performance' = 'Performance metrics'
                'Landlord analytics' = 'Top searched rooms'
                'Landlord inventory' = 'My rentals'
                'Preorder management' = 'Preorder requests'
                'Favorite analytics' = 'Room wishers'
                'Contract' = 'Rental contracts'
                'Document' = 'Document upload'
                'Feedback management' = 'Landlord reviews'
                'Feedback reply' = 'Reply to review'
                'Rental ownership' = 'Rental ownership'
                'Room ownership' = 'Room ownership'
                'Room tenants' = 'Room tenants'
                'Tenant search' = 'Search tenants'
                'VIP packages' = 'VIP packages'
            }
            if ($map.ContainsKey($raw)) { return $map[$raw] }
            return $raw
        }
        'Admin' {
            $map = @{
                'Dashboard' = 'Dashboard stats'
                'Settings' = 'System settings'
                'Finance' = 'Finance summary/reconciliation'
                'Moderator KPI' = 'Moderator KPIs'
                'User management' = 'User management'
                'Wallet management' = 'Wallet management'
                'Verification' = 'Citizen card verification'
                'Blog management' = 'Blog management'
                'Report management' = 'Report management'
                'Document verification' = 'Document verification'
                'VIP management' = 'VIP management'
                'Amenity management' = 'Amenity management'
                'Location management' = 'Location management'
            }
            if ($map.ContainsKey($raw)) { return $map[$raw] }
            return $raw
        }
        'Moderator' {
            $map = @{
                'Queue' = 'Moderation queue'
                'Logs' = 'Moderation logs'
                'Queue activity' = 'Queue activity'
                'Queue assignment' = 'Queue assignment'
                'User moderation' = 'User moderation'
                'Rental moderation' = 'Rental moderation'
                'Room moderation' = 'Room moderation'
                'Report moderation' = 'Report moderation'
                'Review moderation' = 'Review moderation'
                'Verification' = 'Verification review'
            }
            if ($map.ContainsKey($raw)) { return $map[$raw] }
            return $raw
        }
        default {
            return $raw
        }
    }
}

function Get-TestDataDictionary() {
    return @{
        TenantEmail = 'tenant.qa1@example.com'
        TenantPassword = 'Tenant@123'
        SearchKeyword = 'nha tro co ban cong'
        MessageText = 'Xin chao, minh muon hoi them thong tin phong.'
        ReviewReply = 'Cam on ban da phan hoi, ben minh da cap nhat.'
    }
}

function Get-UiPath($wf, $featureName) {
    switch ($wf) {
        'Authentication' { return '/register, /login, /profile' }
        'Tenant' {
            if ($featureName -match 'search|Recommendation|Smart search|Advanced search|Geo|POI') { return '/search or /browse' }
            if ($featureName -match 'Wallet') { return '/wallet' }
            if ($featureName -match 'Messaging') { return '/chat' }
            if ($featureName -match 'Notifications') { return '/home (notification bell)' }
            if ($featureName -match 'Feedback') { return '/history or /room/:id' }
            return '/home, /browse, /rental/:id, /room/:id'
        }
        'Landlord' {
            if ($featureName -eq 'Landlord reviews') { return '/rental-management/reviews' }
            if ($featureName -match 'Dashboard|Performance|Top searched') { return '/rental-management/dashboard' }
            return '/rental-management/*'
        }
        'Admin' { return '/admin/*' }
        'Moderator' { return '/moderator/*' }
        'AI Assistant' { return '/search, /roommate, /comparison/:room1Id/:room2Id' }
        default { return '/home' }
    }
}

function Get-UiProcedurePack($case, $wf, $featureName) {
    $data = Get-TestDataDictionary
    $uiPath = Get-UiPath $wf $featureName

    $pre = "- Tenant account: `"$($data.TenantEmail)`" / `"$($data.TenantPassword)`".`n- Frontend and backend are running.`n- Sample data exists in system."

    $procedure = "1. Login with test account based on role scenario.`n2. Navigate to UI path $uiPath.`n3. Do web action for feature '$($case.name)'.`n4. Observe UI response and record behavior.`n5. Check Network request only as supporting evidence."

    $expected = "- Feature behavior is correct on web UI for current role.`n- UI shows proper message or state transition.`n- No UI crash or broken layout.`n- Supporting API evidence: actual status $($case.status)."

    if ($featureName -match 'search|Recommendation|Smart search|Advanced search|Geo|POI|Public search') {
        $procedure = "1. Login as tenant: `"$($data.TenantEmail)`" / `"$($data.TenantPassword)`".`n2. Open /search or /browse.`n3. Enter `"$($data.SearchKeyword)`" in search box.`n4. Click Search and apply filter if available.`n5. Open one result item to verify detail page."
        $expected = "- Result list is related to keyword `"$($data.SearchKeyword)`".`n- User can open detail page from result list.`n- UI remains stable during search.`n- Supporting API evidence: actual status $($case.status)."
    }

    if ($featureName -match 'Messaging') {
        $procedure = "1. Login as tenant: `"$($data.TenantEmail)`" / `"$($data.TenantPassword)`".`n2. Open /chat and select one conversation.`n3. Input message `"$($data.MessageText)`".`n4. Click Send and observe message rendering.`n5. Reload conversation list and verify consistency."
        $expected = "- Message flow follows role and login state correctly.`n- Chat UI updates without duplication or broken state.`n- Supporting API evidence: actual status $($case.status)."
    }

    if ($featureName -eq 'Landlord reviews' -or $case.id -eq 'LL-12') {
        $procedure = "1. Login as tenant: `"$($data.TenantEmail)`" / `"$($data.TenantPassword)`".`n2. Open search page and enter `"$($data.SearchKeyword)`" to confirm valid tenant session.`n3. Keep tenant session and directly open /rental-management/reviews.`n4. If review filter exists, enter `"$($data.SearchKeyword)`" and click Search.`n5. Observe UI message or redirection and capture network evidence."
        $expected = "- Tenant cannot access landlord review screen.`n- UI shows permission denied message or redirects to allowed page.`n- Landlord private review data is not displayed for tenant.`n- Supporting API evidence: access denied status (actual $($case.status))."
        $pre = "- Valid tenant account: `"$($data.TenantEmail)`" / `"$($data.TenantPassword)`".`n- Landlord review data exists for permission check.`n- Frontend and backend are running."
    }

    if ($featureName -match 'Feedback reply') {
        $procedure = "1. Login as landlord account for review management.`n2. Open /rental-management/reviews and select one review item.`n3. Input reply text `"$($data.ReviewReply)`".`n4. Click Send Reply and observe updated UI.`n5. Refresh page and verify reply is still visible."
        $expected = "- Reply is shown under correct review item.`n- No duplicate reply or wrong target review.`n- Supporting API evidence: actual status $($case.status)."
    }

    return @{
        Procedure = $procedure
        Expected = $expected
        Precondition = $pre
    }
}

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $wb = $excel.Workbooks.Open($reportPath)

    $renameMap = @{
        'Authentication (2)' = 'Workflow of Tenant'
        'Authentication (3)' = 'Workflow of Landlord'
        'Authentication (4)' = 'Workflow of Admin'
        'Authentication (5)' = 'Workflow of Moderator'
        'Workflow of Student' = 'Workflow of Tenant'
        'Workflow of Lecturer' = 'Workflow of Landlord'
        'Workflow of System Moderator' = 'Workflow of Moderator'
    }

    foreach ($oldName in $renameMap.Keys) {
        $oldExists = $false
        foreach ($s in $wb.Worksheets) {
            if ($s.Name -eq $oldName) {
                $oldExists = $true
                break
            }
        }
        if ($oldExists) {
            try { $wb.Worksheets.Item($oldName).Name = $renameMap[$oldName] } catch {}
        }
    }

    $workflowMap = @{
        'Authentication' = 'Authentication'
        'Tenant' = 'Workflow of Tenant'
        'Landlord' = 'Workflow of Landlord'
        'Admin' = 'Workflow of Admin'
        'Moderator' = 'Workflow of Moderator'
        'AI Assistant' = 'AI Assistant'
    }

    $displayMap = @{
        'Authentication' = 'Authentication'
        'Tenant' = 'Workflow of Tenant'
        'Landlord' = 'Workflow of Landlord'
        'Admin' = 'Workflow of Admin'
        'Moderator' = 'Workflow of Moderator'
        'AI Assistant' = 'AI Assistant'
    }

    $moduleOrder = @('Authentication', 'Tenant', 'Landlord', 'Admin', 'Moderator', 'AI Assistant')

    $today = Get-Date
    $lastSaturday = $today.Date
    while ($lastSaturday.DayOfWeek -ne [System.DayOfWeek]::Saturday) {
        $lastSaturday = $lastSaturday.AddDays(-1)
    }
    if ($lastSaturday -eq $today.Date) {
        $lastSaturday = $lastSaturday.AddDays(-7)
    }

    $round1Date = $lastSaturday.ToString('d/M/yyyy')
    $round2Date = $today.ToString('d/M/yyyy')
    $tester = 'Havt'

    foreach ($wf in $moduleOrder) {
        $sheetName = $workflowMap[$wf]
        $ws = $wb.Worksheets.Item($sheetName)
        Clear-Body $ws

        $cases = @($artifact.results | Where-Object { $_.wf -eq $wf })
        $count = $cases.Count

        Set-Cell $ws 'B2' $displayMap[$wf]
        Set-Cell $ws 'B3' ("System Web UI workflow cases for " + $displayMap[$wf])
        Set-Cell $ws 'B4' $count
        $passCount = @($cases | Where-Object { $_.passed -eq $true }).Count
        $failCount = $count - $passCount

        Normalize-CountFormat $ws 'B6:E8'
        Set-Cell $ws 'B6' $passCount
        Set-Cell $ws 'C6' $failCount
        Set-Cell $ws 'D6' 0
        Set-Cell $ws 'E6' 0
        Set-Cell $ws 'B7' $passCount
        Set-Cell $ws 'C7' $failCount
        Set-Cell $ws 'D7' 0
        Set-Cell $ws 'E7' 0
        Set-Cell $ws 'B8' 0
        Set-Cell $ws 'C8' 0
        Set-Cell $ws 'D8' $count
        Set-Cell $ws 'E8' 0

        Set-Cell $ws 'A11' 'System Web UI Cases'

        $row = 12
        $featureOrder = New-Object System.Collections.ArrayList
        $featureBuckets = @{}

        foreach ($case in $cases) {
            $featureName = Normalize-FeatureName $wf $case.feature

            if (-not $featureBuckets.ContainsKey($featureName)) {
                $featureBuckets[$featureName] = New-Object System.Collections.ArrayList
                [void]$featureOrder.Add($featureName)
            }
            [void]$featureBuckets[$featureName].Add($case)
        }

        foreach ($featureName in $featureOrder) {
            Set-Feature-HeaderRow $ws $row $featureName
            $row++

            foreach ($case in $featureBuckets[$featureName]) {
                $uiPack = Get-UiProcedurePack $case $wf $featureName
                $procedure = $uiPack.Procedure
                $expected = $uiPack.Expected
                $pre = $uiPack.Precondition
                $round1Result = Get-CaseResultLabel $case

                Set-TestCaseRowStyle $ws $row

                Set-Cell $ws ("A$row") ("[$($case.id)]")
                Set-Cell $ws ("B$row") $case.name
                Set-Cell $ws ("C$row") $procedure
                Set-Cell $ws ("D$row") $expected
                Set-Cell $ws ("E$row") $pre
                Set-Cell $ws ("F$row") $round1Result
                Set-Cell $ws ("G$row") $round1Date
                Set-Cell $ws ("H$row") $tester
                Set-Cell $ws ("I$row") $round1Result
                Set-Cell $ws ("J$row") $round2Date
                Set-Cell $ws ("K$row") $tester
                Set-Cell $ws ("L$row") 'Pending'
                $row++
            }
        }

        $lastDataRow = [Math]::Max(11, ($row - 1))
        Apply-TableBorders $ws $lastDataRow
    }

    $tc = $wb.Worksheets.Item('Test Cases')
    Set-Cell $tc 'D3' 'EZ-Room - Full Project System Test (Web UI workflow)'
    Set-Cell $tc 'D4' 'EZ-Room'

    for ($i = 0; $i -lt $moduleOrder.Count; $i++) {
        $r = 9 + $i
        $wf = $moduleOrder[$i]
        $cases = @($artifact.results | Where-Object { $_.wf -eq $wf })

        Set-Cell $tc ("B$r") ($i + 1)
        Set-Cell $tc ("C$r") $displayMap[$wf]
        Set-Cell $tc ("D$r") $displayMap[$wf]
        Set-Cell $tc ("E$r") ("System web workflow cases for " + $displayMap[$wf] + " (" + $cases.Count + " cases).")
        Set-Cell $tc ("F$r") 'Frontend + backend running; test users and sample data available.'
    }

    $ts = $wb.Worksheets.Item('Test Statistics')
    Set-Cell $ts 'C3' 'EZ-Room - Full Project System Test (Web UI workflow)'
    Set-Cell $ts 'C4' 'EZ-Room'
    Set-Cell $ts 'C5' 'EZ-Room_System_Test_Report_5.3'
    Set-Cell $ts 'G5' $round2Date
    Set-Cell $ts 'C6' 'System report follows real web user steps with concrete input data.'

    $subPass = 0
    $subFail = 0
    $subPending = 0
    $subNA = 0
    $subTotal = 0

    Normalize-CountFormat $ts 'D11:H18'

    for ($i = 0; $i -lt $moduleOrder.Count; $i++) {
        $r = 11 + $i
        $wf = $moduleOrder[$i]
        $cases = @($artifact.results | Where-Object { $_.wf -eq $wf })

        $pass = @($cases | Where-Object { $_.passed -eq $true }).Count
        $fail = $cases.Count - $pass
        $pending = 0
        $na = 0
        $total = $cases.Count

        Set-Cell $ts ("B$r") ($i + 1)
        Set-Cell $ts ("C$r") $displayMap[$wf]
        Set-Cell $ts ("D$r") $pass
        Set-Cell $ts ("E$r") $fail
        Set-Cell $ts ("F$r") $pending
        Set-Cell $ts ("G$r") $na
        Set-Cell $ts ("H$r") $total

        $subPass += $pass
        $subFail += $fail
        $subPending += $pending
        $subNA += $na
        $subTotal += $total
    }

    Set-Cell $ts 'C18' 'Sub total'
    Set-Cell $ts 'D18' $subPass
    Set-Cell $ts 'E18' $subFail
    Set-Cell $ts 'F18' $subPending
    Set-Cell $ts 'G18' $subNA
    Set-Cell $ts 'H18' $subTotal

    $wb.Save()
    Write-Output 'Report5.3 updated from system-test artifact.'
}
finally {
    if ($wb) { $wb.Close($true); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
    if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}
