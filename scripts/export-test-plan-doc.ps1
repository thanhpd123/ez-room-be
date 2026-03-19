param(
    [string]$OutputPath = "E:\SEP490\TestPlan_Section3.docx"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$wdBorderSingle = 1
$wdLineStyleSingle = 1
$wdLineWidth075pt = 4
$wdColorAutomatic = -16777216
$wdCollapseEnd = 0

function Add-Heading {
    param(
        [object]$Selection,
        [string]$Text,
        [int]$Size = 12,
        [bool]$Bold = $true
    )

    $Selection.Font.Bold = $Bold
    $Selection.Font.Size = $Size
    $Selection.TypeText($Text)
    $Selection.TypeParagraph()
}

function Add-NormalLine {
    param(
        [object]$Selection,
        [string]$Text,
        [bool]$Italic = $false,
        [int]$Size = 10
    )

    $Selection.Font.Bold = $false
    $Selection.Font.Italic = $Italic
    $Selection.Font.Size = $Size
    $Selection.TypeText($Text)
    $Selection.TypeParagraph()
}

function Apply-TableBorders {
    param([object]$Table)

    $Table.Borders.Enable = 1
    foreach ($border in $Table.Borders) {
        $border.LineStyle = $wdLineStyleSingle
        $border.LineWidth = $wdLineWidth075pt
        $border.Color = $wdColorAutomatic
    }
}

function Fill-Cell {
    param(
        [object]$Table,
        [int]$Row,
        [int]$Col,
        [string]$Text,
        [bool]$Header = $false
    )

    $cellRange = $Table.Cell($Row, $Col).Range
    $cellRange.Text = $Text
    $cellRange.Font.Size = 10
    $cellRange.Font.Bold = $Header
    $cellRange.ParagraphFormat.SpaceAfter = 0
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $doc = $word.Documents.Add()
    $sel = $word.Selection

    Add-Heading -Selection $sel -Text "3. Test Plan" -Size 13 -Bold $true

    Add-Heading -Selection $sel -Text "3.1 Test Environment" -Size 11 -Bold $true
    Add-NormalLine -Selection $sel -Text "[List and provide the details about the tools (software, hardware, infrastructure) which the project would use for testing. The information can be provided in the table format as below]" -Italic $true

    $envRows = @(
        @("Purpose", "Tool", "Provider", "Version"),
        @("Source code editor & debugging", "Visual Studio Code", "Microsoft", "1.97+"),
        @("Runtime backend", "Node.js", "OpenJS Foundation", "22.11.0"),
        @("Backend framework", "Express.js", "Express.js Foundation", "5.2.1"),
        @("ORM/database access", "Prisma ORM", "Prisma", "6.19.2"),
        @("Relational database", "PostgreSQL", "Supabase", "PostgreSQL 15+"),
        @("API functional testing", "Postman", "Postman Inc.", "11+"),
        @("Unit test runner", "node:test", "Node.js built-in", "22.11.0"),
        @("Assertion library", "node:assert/strict", "Node.js built-in", "22.11.0"),
        @("HTTP request testing (optional)", "Supertest", "Open Source", "7+"),
        @("Frontend build/dev server", "Vite", "Vite Team", "6+"),
        @("Frontend framework", "React + TypeScript", "Meta / Microsoft", "React 18+, TS 5+"),
        @("Browser validation", "Google Chrome, Microsoft Edge", "Google / Microsoft", "Latest stable"),
        @("API docs validation", "Swagger UI Express", "SmartBear / OSS", "5.0.1"),
        @("Security/static quality scan (optional)", "SonarQube for IDE", "SonarSource", "Latest"),
        @("Version control", "Git + GitHub", "Git SCM / GitHub", "Git 2.4x+"),
        @("CI/CD test automation (optional)", "GitHub Actions", "GitHub", "Latest"),
        @("OS test host", "Windows 10/11 Pro", "Microsoft", "64-bit"),
        @("Hardware baseline (dev machine)", "CPU 4 cores, RAM 16GB, SSD 256GB+", "N/A", "N/A"),
        @("Infrastructure", "Supabase Cloud Project + local dev machine", "Supabase + Local", "Active project")
    )

    $envTable = $doc.Tables.Add($sel.Range, $envRows.Count, 4)
    $envTable.Rows.Alignment = 1
    $envTable.Range.ParagraphFormat.Alignment = 1
    $envTable.Columns.Item(1).PreferredWidth = 220
    $envTable.Columns.Item(2).PreferredWidth = 160
    $envTable.Columns.Item(3).PreferredWidth = 120
    $envTable.Columns.Item(4).PreferredWidth = 90

    for ($r = 1; $r -le $envRows.Count; $r++) {
        for ($c = 1; $c -le 4; $c++) {
            Fill-Cell -Table $envTable -Row $r -Col $c -Text $envRows[$r - 1][$c - 1] -Header ($r -eq 1)
        }
    }

    Apply-TableBorders -Table $envTable

    $sel.SetRange($envTable.Range.End, $envTable.Range.End)
    $sel.Collapse($wdCollapseEnd)
    $sel.TypeParagraph()
    $sel.TypeParagraph()

    Add-Heading -Selection $sel -Text "3.2 Test Milestones" -Size 11 -Bold $true
    Add-NormalLine -Selection $sel -Text "[Separate test milestones, which should be identified to communicate project status accomplishments. The information can be provided in the table format as below]" -Italic $true

    $milestoneRows = @(
        @("Milestone Task", "Start Date", "End Date"),
        @("Finalize test scope, strategy, and acceptance criteria", "2026-03-14", "2026-03-15"),
        @("Prepare test environment (DB seed, env vars, test data)", "2026-03-15", "2026-03-16"),
        @("Build/refresh unit tests for controllers/services", "2026-03-16", "2026-03-18"),
        @("Execute full unit test cycle and fix regressions", "2026-03-18", "2026-03-19"),
        @("Execute integration/API test cycle (critical flows)", "2026-03-19", "2026-03-21"),
        @("Re-test bug fixes and regression verification", "2026-03-21", "2026-03-22"),
        @("Generate Unit + Integration Test Reports", "2026-03-22", "2026-03-22"),
        @("Stakeholder review, sign-off, release readiness", "2026-03-23", "2026-03-23")
    )

    $milestoneTable = $doc.Tables.Add($sel.Range, $milestoneRows.Count, 3)
    $milestoneTable.Rows.Alignment = 1
    $milestoneTable.Range.ParagraphFormat.Alignment = 1
    $milestoneTable.Columns.Item(1).PreferredWidth = 330
    $milestoneTable.Columns.Item(2).PreferredWidth = 90
    $milestoneTable.Columns.Item(3).PreferredWidth = 90

    for ($r = 1; $r -le $milestoneRows.Count; $r++) {
        for ($c = 1; $c -le 3; $c++) {
            Fill-Cell -Table $milestoneTable -Row $r -Col $c -Text $milestoneRows[$r - 1][$c - 1] -Header ($r -eq 1)
        }
    }

    Apply-TableBorders -Table $milestoneTable

    $doc.SaveAs([ref]$OutputPath)
    $doc.Close()

    Write-Host "Generated DOCX: $OutputPath"
}
finally {
    if ($word) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}
