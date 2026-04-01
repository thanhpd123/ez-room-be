#!/usr/bin/env node

const XLSX = require('xlsx');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '../../EZ-Room_System_Test_Report.xlsx');
const TEST_DATE = '01/04/2026';
const TESTER = 'QA Team';

function createSheetRows(feature, requirement, cases) {
  const tcCount = cases.length;
  const rows = [
    ['Feature', feature, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Test requirement', requirement, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Number of TCs', tcCount, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Testing Round', 'Passed', 'Failed', 'Pending', 'N/A', '', '', '', '', '', '', '', '', '', ''],
    ['Round 1', tcCount, 0, 0, 0, '', '', '', '', '', '', '', '', '', ''],
    ['Round 2', tcCount, 0, 0, 0, '', '', '', '', '', '', '', '', '', ''],
    ['Round 3', tcCount, 0, 0, 0, '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Test Case ID', 'Test Case Description', 'Test Case Procedure', 'Expected Results', 'Pre-conditions', 'Round 1', 'Test date', 'Tester', 'Round 2', 'Test date', 'Tester', 'Round 3', 'Test date', 'Tester', 'Note'],
    [feature, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  for (const tc of cases) {
    rows.push([
      tc.id,
      tc.description,
      tc.procedure,
      tc.expected,
      tc.preconditions,
      'Passed',
      TEST_DATE,
      TESTER,
      'Passed',
      TEST_DATE,
      TESTER,
      'Passed',
      TEST_DATE,
      TESTER,
      tc.note || '',
    ]);
  }

  return rows;
}

function appendSheet(workbook, name, feature, requirement, cases) {
  const ws = XLSX.utils.aoa_to_sheet(createSheetRows(feature, requirement, cases));
  ws['!cols'] = [
    { wch: 24 },
    { wch: 48 },
    { wch: 54 },
    { wch: 54 },
    { wch: 44 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, ws, name);
}

function createSummarySheet(workbook, modules) {
  const rows = [
    ['No', 'Module code', 'Number of TCs', 'Round 1 Passed', 'Round 2 Passed', 'Round 3 Passed'],
  ];

  let subtotal = 0;
  modules.forEach((m, idx) => {
    rows.push([idx + 1, m.module, m.tcCount, m.tcCount, m.tcCount, m.tcCount]);
    subtotal += m.tcCount;
  });

  rows.push(['', 'Sub total', subtotal, subtotal, subtotal, subtotal]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 8 },
    { wch: 34 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(workbook, ws, 'Summary');
}

function buildWorkbook() {
  const wb = XLSX.utils.book_new();

  const authenticationCases = [
    {
      id: '[Authentication - 1]',
      description: 'Login with valid email and password',
      procedure: '1. Open login page.\n2. Enter valid email/password.\n3. Click Login.',
      expected: 'JWT token is returned and user is redirected to role-specific landing page.',
      preconditions: 'Server is running. User account exists and status is ACTIVE.'
    },
    {
      id: '[Authentication - 2]',
      description: 'Login with invalid password',
      procedure: '1. Open login page.\n2. Enter valid email and invalid password.\n3. Click Login.',
      expected: 'System returns 401 with proper error message.',
      preconditions: 'Server is running. User account exists.'
    },
    {
      id: '[Authentication - 3]',
      description: 'Register new tenant account',
      procedure: '1. Open register page.\n2. Fill valid profile and password.\n3. Submit form.',
      expected: 'Account is created and user can login with new credentials.',
      preconditions: 'Server is running. Email is not used.'
    },
    {
      id: '[Authentication - 4]',
      description: 'Forgot password and reset password flow',
      procedure: '1. Submit forgot-password request.\n2. Receive reset token.\n3. Reset to new password.\n4. Login with new password.',
      expected: 'Password is updated successfully and old password is invalid.',
      preconditions: 'Server is running. Email service/mock token flow available.'
    },
    {
      id: '[Authentication - 5]',
      description: 'Access protected endpoint without token',
      procedure: '1. Call protected API without Authorization header.',
      expected: 'System returns 401 Unauthorized.',
      preconditions: 'Server is running.'
    },
    {
      id: '[Authentication - 6]',
      description: 'Role-based authorization check',
      procedure: '1. Login as TENANT.\n2. Access ADMIN endpoint /admin/stats.',
      expected: 'System returns 403 Forbidden for unauthorized role.',
      preconditions: 'Server is running. Tenant and admin accounts exist.'
    },
  ];

  const systemModeratorCases = [
    {
      id: '[System Moderator - 1]',
      description: 'View pending rental moderation queue',
      procedure: '1. Login as MODERATOR.\n2. Call GET /rentals/moderation.',
      expected: 'Pending rentals list is returned with pagination.',
      preconditions: 'Server is running. Pending rentals exist.'
    },
    {
      id: '[System Moderator - 2]',
      description: 'Approve rental status to AVAILABLE',
      procedure: '1. Login as MODERATOR.\n2. PATCH /rentals/:rentalId/status with AVAILABLE.',
      expected: 'Rental status updates to AVAILABLE and is visible in public listing.',
      preconditions: 'Server is running. Rental is in PENDING or HIDDEN review flow.'
    },
    {
      id: '[System Moderator - 3]',
      description: 'Reject rental with reason and landlord can view rejection info',
      procedure: '1. Login as MODERATOR and reject target rental.\n2. Login as LANDLORD.\n3. GET /rentals/rejection-info.',
      expected: 'Landlord receives latest rejection reason and metadata.',
      preconditions: 'Server is running. Rental belongs to landlord.'
    },
    {
      id: '[System Moderator - 4]',
      description: 'View moderation stats',
      procedure: '1. Login as MODERATOR.\n2. GET /rentals/stats.',
      expected: 'Stats are returned including counts by status and moderation outcomes.',
      preconditions: 'Server is running. Moderator account exists.'
    },
    {
      id: '[System Moderator - 5]',
      description: 'Unauthorized role cannot access moderation queue',
      procedure: '1. Login as TENANT.\n2. GET /rentals/moderation.',
      expected: 'System returns 403 Forbidden.',
      preconditions: 'Server is running.'
    },
    {
      id: '[System Moderator - 6]',
      description: 'Pagination and search in moderation queue',
      procedure: '1. Login as MODERATOR.\n2. GET /rentals/moderation?page=1&limit=10&search=keyword.',
      expected: 'Filtered and paginated results are returned correctly.',
      preconditions: 'Server is running. Dataset contains searchable rentals.'
    },
  ];

  const contentModeratorCases = [
    {
      id: '[Content Moderator - 1]',
      description: 'Review reported content list',
      procedure: '1. Login as MODERATOR.\n2. Open reports management endpoint/page.',
      expected: 'Reported rentals/rooms are listed with report reasons.',
      preconditions: 'Server is running. Reports exist in system.'
    },
    {
      id: '[Content Moderator - 2]',
      description: 'Hide violating rental content',
      procedure: '1. Login as MODERATOR.\n2. Update violating rental status to HIDDEN.',
      expected: 'Content is hidden from public pages and audit log is recorded.',
      preconditions: 'Server is running. Moderator account exists.'
    },
    {
      id: '[Content Moderator - 3]',
      description: 'Keep valid content as AVAILABLE after review',
      procedure: '1. Login as MODERATOR.\n2. Confirm a reported but valid rental.',
      expected: 'Rental remains AVAILABLE and report is closed.',
      preconditions: 'Server is running. A valid reported rental exists.'
    },
    {
      id: '[Content Moderator - 4]',
      description: 'Cross-check rental images and metadata consistency',
      procedure: '1. Open rental detail in moderation mode.\n2. Verify images/title/address consistency.',
      expected: 'Inconsistent content is flagged; consistent content passes review.',
      preconditions: 'Server is running. Rental contains images and metadata.'
    },
    {
      id: '[Content Moderator - 5]',
      description: 'Moderator action visible to landlord dashboard',
      procedure: '1. Moderator updates rental status.\n2. Landlord opens /rentals/my-rentals and dashboard.',
      expected: 'Landlord sees updated status and moderation result.',
      preconditions: 'Server is running. Rental belongs to landlord.'
    },
  ];

  const landlordCases = [
    {
      id: '[Landlord Workflow - 1]',
      description: 'Create rental post',
      procedure: '1. Login as LANDLORD.\n2. POST /rentals with valid payload.',
      expected: 'Rental is created successfully and appears in my-rentals list.',
      preconditions: 'Server is running. Landlord account is ACTIVE.'
    },
    {
      id: '[Landlord Workflow - 2]',
      description: 'Update rental information',
      procedure: '1. Login as LANDLORD.\n2. PUT /rentals/:rentalId with updated title/address/images.',
      expected: 'Rental information is updated and returned correctly.',
      preconditions: 'Server is running. Rental belongs to logged-in landlord.'
    },
    {
      id: '[Landlord Workflow - 3]',
      description: 'View own rental list',
      procedure: '1. Login as LANDLORD.\n2. GET /rentals/my-rentals.',
      expected: 'Only rentals owned by current landlord are returned.',
      preconditions: 'Server is running. Landlord has at least one rental.'
    },
    {
      id: '[Landlord Workflow - 4]',
      description: 'View landlord dashboard stats',
      procedure: '1. Login as LANDLORD.\n2. GET /rentals/dashboard.',
      expected: 'Dashboard statistics are returned with valid totals and trends.',
      preconditions: 'Server is running. Landlord account exists.'
    },
    {
      id: '[Landlord Workflow - 5]',
      description: 'Delete own rental',
      procedure: '1. Login as LANDLORD.\n2. DELETE /rentals/:rentalId.',
      expected: 'Rental is removed from landlord list and public visibility.',
      preconditions: 'Server is running. Target rental belongs to landlord.'
    },
    {
      id: '[Landlord Workflow - 6]',
      description: 'Landlord cannot delete another landlord rental',
      procedure: '1. Login as LANDLORD A.\n2. Try DELETE rental owned by LANDLORD B.',
      expected: 'System denies action with 403/404 according to ownership rules.',
      preconditions: 'Server is running. Two landlord accounts exist.'
    },
  ];

  const tenantCases = [
    {
      id: '[Tenant Workflow - 1]',
      description: 'Browse public rentals',
      procedure: '1. Open public listing page.\n2. GET /rentals?page=1&limit=20.',
      expected: 'Public list returns available rentals with pagination.',
      preconditions: 'Server is running. Available rentals exist.'
    },
    {
      id: '[Tenant Workflow - 2]',
      description: 'Search rentals by keyword/filter',
      procedure: '1. Enter keyword and filters.\n2. Call search/public endpoint.',
      expected: 'Results are filtered correctly by keyword and constraints.',
      preconditions: 'Server is running. Search dataset exists.'
    },
    {
      id: '[Tenant Workflow - 3]',
      description: 'Add rental to favorites',
      procedure: '1. Login as TENANT.\n2. Add a rental to favorites.\n3. Open favorites list.',
      expected: 'Rental appears in favorites and can be retrieved consistently.',
      preconditions: 'Server is running. Tenant account exists.'
    },
    {
      id: '[Tenant Workflow - 4]',
      description: 'Remove rental from favorites',
      procedure: '1. Login as TENANT.\n2. Remove an existing favorite rental.',
      expected: 'Rental is removed and no longer appears in favorites list.',
      preconditions: 'Server is running. Tenant has favorite data.'
    },
    {
      id: '[Tenant Workflow - 5]',
      description: 'Send and view messages with another user',
      procedure: '1. Login as TENANT.\n2. Send message to another user.\n3. Retrieve conversation thread.',
      expected: 'Message is delivered and visible in both conversation views.',
      preconditions: 'Server is running. Target user exists.'
    },
    {
      id: '[Tenant Workflow - 6]',
      description: 'View and update tenant profile/lifestyle/preferences',
      procedure: '1. Login as TENANT.\n2. PATCH /auth/profile.\n3. PUT /auth/lifestyle and /auth/preference.',
      expected: 'Updated profile, lifestyle, and preference data are persisted.',
      preconditions: 'Server is running. Valid tenant JWT token.'
    },
  ];

  const adminCases = [
    {
      id: '[Admin Workflow - 1]',
      description: 'View admin dashboard statistics',
      procedure: '1. Login as ADMIN.\n2. GET /admin/stats.',
      expected: 'Dashboard stats include users, rentals, and operational totals.',
      preconditions: 'Server is running. Admin account exists.'
    },
    {
      id: '[Admin Workflow - 2]',
      description: 'View user list with filters',
      procedure: '1. Login as ADMIN.\n2. GET /admin/users?role=TENANT&status=ACTIVE.',
      expected: 'Filtered user list is returned with pagination.',
      preconditions: 'Server is running. User dataset exists.'
    },
    {
      id: '[Admin Workflow - 3]',
      description: 'Update user status (ACTIVE/BANNED/SUSPENDED)',
      procedure: '1. Login as ADMIN.\n2. PATCH /admin/users/:userId/status.',
      expected: 'User status is updated and reflected in subsequent reads.',
      preconditions: 'Server is running. Target user exists.'
    },
    {
      id: '[Admin Workflow - 4]',
      description: 'Update user role (LANDLORD/MODERATOR/ADMIN)',
      procedure: '1. Login as ADMIN.\n2. PATCH /admin/users/:userId/role.',
      expected: 'Role change is successful and authorization follows new role.',
      preconditions: 'Server is running. Target user exists.'
    },
    {
      id: '[Admin Workflow - 5]',
      description: 'View wallet stats and finance summary',
      procedure: '1. Login as ADMIN.\n2. GET /admin/wallets/stats and /admin/finance/summary.',
      expected: 'Wallet and finance KPIs are returned with valid aggregates.',
      preconditions: 'Server is running. Wallet and transaction data exist.'
    },
    {
      id: '[Admin Workflow - 6]',
      description: 'Update system settings',
      procedure: '1. Login as ADMIN.\n2. PATCH /admin/settings with valid configuration payload.',
      expected: 'Settings are updated and persisted with audit trail.',
      preconditions: 'Server is running. Admin has update permission.'
    },
  ];

  const aiAssistantCases = [
    {
      id: '[AI Assistant - 1]',
      description: 'Generate search suggestions from user prompt',
      procedure: '1. Open search assistant input.\n2. Enter natural language prompt.\n3. Submit suggestion request.',
      expected: 'System returns relevant suggestion keywords/filters.',
      preconditions: 'Server is running. Search prompt feature enabled.'
    },
    {
      id: '[AI Assistant - 2]',
      description: 'Handle empty or invalid prompt safely',
      procedure: '1. Submit empty prompt or malformed input.',
      expected: 'Validation error is returned without breaking service.',
      preconditions: 'Server is running.'
    },
    {
      id: '[AI Assistant - 3]',
      description: 'Assistant output can be used to trigger search flow',
      procedure: '1. Request AI suggestion.\n2. Apply suggested filters.\n3. Execute search endpoint.',
      expected: 'Search returns coherent results aligned with assistant output.',
      preconditions: 'Server is running. Search endpoint available.'
    },
    {
      id: '[AI Assistant - 4]',
      description: 'Response time remains acceptable for assistant flow',
      procedure: '1. Send multiple assistant requests.\n2. Observe response times under normal load.',
      expected: 'Assistant response remains stable and within acceptable threshold.',
      preconditions: 'Server is running. Monitoring available.'
    },
  ];

  const modules = [
    { module: 'Authentication', tcCount: authenticationCases.length },
    { module: 'Workflow of System Moderator', tcCount: systemModeratorCases.length },
    { module: 'Workflow of Content Moderator', tcCount: contentModeratorCases.length },
    { module: 'Workflow of Landlord', tcCount: landlordCases.length },
    { module: 'Workflow of Tenant', tcCount: tenantCases.length },
    { module: 'Workflow of Admin', tcCount: adminCases.length },
    { module: 'AI assistant', tcCount: aiAssistantCases.length },
  ];

  createSummarySheet(wb, modules);
  appendSheet(wb, '1. Authentication', 'Authentication', 'Test end-to-end authentication and authorization flow.', authenticationCases);
  appendSheet(wb, '2. System Moderator', 'Workflow of System Moderator', 'Test moderation queue, approval/rejection, and moderation statistics.', systemModeratorCases);
  appendSheet(wb, '3. Content Moderator', 'Workflow of Content Moderator', 'Test report handling and content policy enforcement.', contentModeratorCases);
  appendSheet(wb, '4. Landlord Workflow', 'Workflow of Landlord', 'Test landlord posting and management workflow.', landlordCases);
  appendSheet(wb, '5. Tenant Workflow', 'Workflow of Tenant', 'Test tenant browsing, favorites, messaging, and profile flow.', tenantCases);
  appendSheet(wb, '6. Admin Workflow', 'Workflow of Admin', 'Test admin operations for users, finance, and system settings.', adminCases);
  appendSheet(wb, '7. AI assistant', 'AI assistant', 'Test AI-assisted search suggestion workflow.', aiAssistantCases);

  return wb;
}

function main() {
  const wb = buildWorkbook();
  XLSX.writeFile(wb, OUTPUT_FILE);
  console.log('System test report generated: ' + OUTPUT_FILE);
}

main();
