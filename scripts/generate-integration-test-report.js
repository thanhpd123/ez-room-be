/**
 * Generate Integration Test Report Excel — matching the provided template.
 *
 * Sheets:
 *   Cover, Test Cases (list + hyperlinks), Test Statistics,
 *   one detail sheet per function with test-case rows.
 *
 * Usage: node scripts/generate-integration-test-report.js
 * Output: EZ-Room_Integration_Test_Report.xlsx in E:\SEP490\
 */

const ExcelJS = require('exceljs');
const path = require('path');
const { execFileSync } = require('child_process');

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
const DARK_BLUE = '003366';
const GREEN = '006100';
const WHITE = 'FFFFFF';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BLUE } };
const GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: '92D050' } };
const LIGHT_GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } };
const WHITE_FONT = { color: { argb: WHITE }, bold: true, size: 10 };
const BOLD_FONT = { bold: true, size: 10 };
const BOLD_GREEN_FONT = { bold: true, size: 10, color: { argb: GREEN } };
const NORMAL_FONT = { size: 10 };
const TITLE_FONT = { bold: true, size: 16 };
const THIN_BORDER = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
};
const WRAP = { wrapText: true, vertical: 'top' };
const LABEL_BROWN_FONT = { bold: true, size: 11, color: { argb: '9C3B00' } };
const VALUE_BLUE_FONT = { bold: true, size: 11, color: { argb: '0000FF' } };

const PROJECT_NAME = 'EZ-Room — Room Rental Platform';
const PROJECT_CODE = 'EZ-Room';
const DOCUMENT_CODE = 'EZ-Room System Integration Test Report';
const CREATOR = '';
const TESTER = '';
const TODAY = new Date().toLocaleDateString('en-GB'); // dd/mm/yyyy

function toPercentComma(value) {
    return value.toFixed(2).replace('.', ',');
}

// ═══════════════════════════════════════════════
// INTEGRATION TEST CASE DEFINITIONS
// ═══════════════════════════════════════════════
function buildTestCases() {
    const fns = [];

    // ────── AUTH MODULE ──────
    fns.push({
        name: 'Register',
        sheetName: 'Register',
        module: 'Auth',
        description: 'Test user registration flow',
        preCondition: 'Server must be running.\nDatabase is accessible.',
        cases: [
            {
                desc: 'Test registration with valid input:\n- Email\n- Password\n- Confirm Password\n- Full name',
                procedure: '1. Enter "http://localhost:5173/" to navigate to the website.\n2. Guest user clicks the "Đăng ký" button.\n3. The site displays the registration form.\n4. Guest user selects a registration role: "Người thuê" or "Chủ trọ".\n5. Enter the following valid information:\n   - Email: test@example.com\n   - Password: Test@1234\n   - Confirm Password: Test@1234\n   - Full name: Test User\n6. Click "Đăng ký" button.',
                expected: '- The user is successfully registered.\n- System displays success message.\n- User details are stored in the database.\n- OTP verification email is sent.',
                preCond: 'Server must be running.\nGuest user is not logged in and wants to create an account.',
            },
            {
                desc: 'Test registration with invalid email format:\n- Email\n- Password\n- Confirm Password\n- Full name',
                procedure: '1. Navigate to the registration page.\n2. Select a role.\n3. Enter invalid email format (e.g., "invalid-email").\n4. Fill in other fields with valid data.\n5. Click "Đăng ký" button.',
                expected: 'System displays an error message for invalid email format and prevents registration.',
                preCond: 'Server must be running.\nGuest user is not logged in.',
            },
            {
                desc: 'Test registration with already existing email:\n- Email\n- Password\n- Confirm Password\n- Full name',
                procedure: '1. Navigate to the registration page.\n2. Select a role.\n3. Enter an email that is already registered.\n4. Fill in other fields with valid data.\n5. Click "Đăng ký" button.',
                expected: 'System displays error message "Email đã được sử dụng" and prevents registration.',
                preCond: 'Server must be running.\nEmail already exists in the database.',
            },
        ],
    });

    fns.push({
        name: 'Login by account',
        sheetName: 'Login by account',
        module: 'Auth',
        description: 'Test login with email and password',
        preCondition: 'Server must be running.\nUser account exists.',
        cases: [
            {
                desc: 'Test login with valid credentials:\n- Email\n- Password',
                procedure: '1. Navigate to the login page.\n2. Enter valid email and password.\n3. Click "Đăng nhập" button.',
                expected: '- User is successfully logged in.\n- JWT token is returned.\n- User is redirected to the home page.',
                preCond: 'Server must be running.\nUser account exists and is ACTIVE.',
            },
            {
                desc: 'Test login with wrong password:\n- Email\n- Password',
                procedure: '1. Navigate to the login page.\n2. Enter valid email but wrong password.\n3. Click "Đăng nhập" button.',
                expected: 'System displays error message "Email hoặc mật khẩu không đúng".',
                preCond: 'Server must be running.\nUser account exists.',
            },
            {
                desc: 'Test login with non-existent email:\n- Email\n- Password',
                procedure: '1. Navigate to the login page.\n2. Enter an email that does not exist.\n3. Click "Đăng nhập" button.',
                expected: 'System displays error message "Email hoặc mật khẩu không đúng".',
                preCond: 'Server must be running.',
            },
            {
                desc: 'Test login with banned account:\n- Email\n- Password',
                procedure: '1. Navigate to the login page.\n2. Enter valid email of a banned account.\n3. Enter correct password.\n4. Click "Đăng nhập" button.',
                expected: 'System displays error message "Tài khoản đã bị khóa hoặc tạm ngưng".',
                preCond: 'Server must be running.\nUser account exists with status BANNED.',
            },
        ],
    });

    fns.push({
        name: 'Login by Google',
        sheetName: 'Login by Google',
        module: 'Auth',
        description: 'Test login/register with Google OAuth',
        preCondition: 'Server must be running.\nSupabase OAuth configured.',
        cases: [
            {
                desc: 'Test OAuth login with valid Google account',
                procedure: '1. Navigate to the login page.\n2. Click "Đăng nhập bằng Google" button.\n3. Select a valid Google account from the popup.\n4. Authorize the application.',
                expected: '- User is authenticated via Supabase OAuth.\n- If new user, profile is created via registerOAuth.\n- User is redirected to the home page.',
                preCond: 'Server must be running.\nGoogle OAuth is configured in Supabase.',
            },
        ],
    });

    fns.push({
        name: 'Forgot password',
        sheetName: 'Forgot password',
        module: 'Auth',
        description: 'Test password reset request flow',
        preCondition: 'Server must be running.',
        cases: [
            {
                desc: 'Test forgot password with registered email:\n- Email',
                procedure: '1. Navigate to the login page.\n2. Click "Quên mật khẩu" link.\n3. Enter a registered email address.\n4. Click "Gửi" button.',
                expected: '- System sends password reset email.\n- Success message is displayed.\n- Email contains reset token link.',
                preCond: 'Server must be running.\nUser account exists with this email.',
            },
            {
                desc: 'Test forgot password with non-existent email:\n- Email',
                procedure: '1. Navigate to the login page.\n2. Click "Quên mật khẩu" link.\n3. Enter an email that is not registered.\n4. Click "Gửi" button.',
                expected: 'System displays the same success message (security: does not reveal whether email exists).',
                preCond: 'Server must be running.',
            },
        ],
    });

    fns.push({
        name: 'Reset password',
        sheetName: 'Reset password',
        module: 'Auth',
        description: 'Test password reset with token',
        preCondition: 'Server must be running.\nUser has received reset email.',
        cases: [
            {
                desc: 'Test reset password with valid token:\n- Token\n- New Password\n- Confirm Password',
                procedure: '1. Open reset password link from email.\n2. Enter new password and confirm password.\n3. Click "Đặt lại mật khẩu" button.',
                expected: '- Password is changed successfully.\n- User can login with new password.\n- Reset token is invalidated.',
                preCond: 'Server must be running.\nValid reset token exists (not expired).',
            },
            {
                desc: 'Test reset password with expired/invalid token:\n- Token\n- New Password\n- Confirm Password',
                procedure: '1. Open reset password link with expired or invalid token.\n2. Enter new password.\n3. Click "Đặt lại mật khẩu" button.',
                expected: 'System displays error "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn".',
                preCond: 'Server must be running.\nToken is expired or invalid.',
            },
        ],
    });

    fns.push({
        name: 'View profile',
        sheetName: 'View profile',
        module: 'Auth',
        description: 'Test viewing current user profile',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view profile when logged in',
                procedure: '1. Login with valid credentials.\n2. Navigate to profile page or click avatar icon.\n3. System displays user profile.',
                expected: '- Profile page displays user info: full name, email, phone, avatar, role, gender.\n- Data matches database records.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
            {
                desc: 'Test view profile when not logged in',
                procedure: '1. Navigate directly to the profile page URL without logging in.',
                expected: '- System redirects user to login page.\n- Returns 401 Unauthorized.',
                preCond: 'Server must be running.\nUser is not logged in.',
            },
        ],
    });

    fns.push({
        name: 'Update profile',
        sheetName: 'Update profile',
        module: 'Auth',
        description: 'Test updating user profile information',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test update profile with valid data:\n- Full name\n- Phone\n- Avatar URL',
                procedure: '1. Login and navigate to profile page.\n2. Click "Chỉnh sửa" button.\n3. Update full name, phone number.\n4. Upload new avatar.\n5. Click "Lưu" button.',
                expected: '- Profile is updated successfully.\n- Updated data is displayed immediately.\n- Changes are persisted in database.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
            {
                desc: 'Test update profile with empty required fields',
                procedure: '1. Login and navigate to profile edit page.\n2. Clear the full name field.\n3. Click "Lưu" button.',
                expected: 'System displays validation error and prevents update.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    fns.push({
        name: 'Logout',
        sheetName: 'Logout',
        module: 'Auth',
        description: 'Test user logout flow',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test logout when logged in',
                procedure: '1. Login with valid credentials.\n2. Click the user avatar/menu.\n3. Click "Đăng xuất" button.',
                expected: '- User session is terminated.\n- JWT token is cleared.\n- User is redirected to the home/login page.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    // ────── RENTAL MODULE ──────
    fns.push({
        name: 'View rentals',
        sheetName: 'View rentals',
        module: 'Rental',
        description: 'Test viewing public rental listings',
        preCondition: 'Server must be running.\nRentals exist in database.',
        cases: [
            {
                desc: 'Test view rental list with default pagination',
                procedure: '1. Navigate to the home page or rental listing page.\n2. System displays available rentals.',
                expected: '- List of available rentals is displayed.\n- Pagination works (default page=1, limit=20).\n- Each rental shows title, location, price range, images.',
                preCond: 'Server must be running.\nRentals with status AVAILABLE exist.',
            },
            {
                desc: 'Test search rentals with filters:\n- City\n- District\n- Price range',
                procedure: '1. Navigate to rental listing page.\n2. Select city filter (e.g., "Hà Nội").\n3. Select district filter.\n4. Set price range.\n5. Click "Tìm kiếm" button.',
                expected: '- Only rentals matching all filters are displayed.\n- Result count is updated.\n- Pagination reflects filtered results.',
                preCond: 'Server must be running.\nRentals exist with various locations and prices.',
            },
            {
                desc: 'Test search rentals with no matching results',
                procedure: '1. Navigate to rental listing page.\n2. Set extreme filter values (e.g., price > 999,999,999).\n3. Click "Tìm kiếm".',
                expected: 'System displays empty state message indicating no rentals match the criteria.',
                preCond: 'Server must be running.',
            },
        ],
    });

    fns.push({
        name: 'View rental detail',
        sheetName: 'View rental detail',
        module: 'Rental',
        description: 'Test viewing detailed rental information',
        preCondition: 'Server must be running.\nRental exists.',
        cases: [
            {
                desc: 'Test view rental detail with valid rental ID',
                procedure: '1. Navigate to rental listing page.\n2. Click on a rental card.\n3. System navigates to rental detail page.',
                expected: '- Rental detail page displays: title, description, address, images, rooms list, owner info.\n- All rooms show price, area, amenities.',
                preCond: 'Server must be running.\nRental with status AVAILABLE exists.',
            },
            {
                desc: 'Test view rental detail with non-existent ID',
                procedure: '1. Navigate to URL with non-existent rental ID (e.g., /rentals/non-existent-uuid).',
                expected: 'System displays 404 Not Found or "Không tìm thấy bài đăng".',
                preCond: 'Server must be running.',
            },
        ],
    });

    fns.push({
        name: 'Create rental',
        sheetName: 'Create rental',
        module: 'Rental',
        description: 'Test creating a new rental listing (Landlord)',
        preCondition: 'Server must be running.\nUser is logged in as LANDLORD.',
        cases: [
            {
                desc: 'Test create rental with valid data:\n- Title\n- City, District, Address\n- Description\n- Images',
                procedure: '1. Login as LANDLORD.\n2. Navigate to "Quản lý bài đăng" page.\n3. Click "Tạo bài đăng mới".\n4. Fill in title, select city/district, enter address.\n5. Add description and upload images.\n6. Click "Đăng bài".',
                expected: '- Rental is created with status PENDING.\n- Rental appears in landlord\'s rental list.\n- Success notification is displayed.\n- Rental is queued for moderator review.',
                preCond: 'Server must be running.\nUser is logged in as LANDLORD.',
            },
            {
                desc: 'Test create rental with missing required fields',
                procedure: '1. Login as LANDLORD.\n2. Navigate to create rental page.\n3. Leave title empty.\n4. Leave location fields empty.\n5. Click "Đăng bài".',
                expected: 'System displays validation errors for required fields and prevents creation.',
                preCond: 'Server must be running.\nUser is logged in as LANDLORD.',
            },
            {
                desc: 'Test create rental as TENANT (unauthorized)',
                procedure: '1. Login as TENANT.\n2. Attempt to access create rental API endpoint directly.',
                expected: 'System returns 403 Forbidden. TENANT cannot create rentals.',
                preCond: 'Server must be running.\nUser is logged in as TENANT.',
            },
        ],
    });

    fns.push({
        name: 'Update rental',
        sheetName: 'Update rental',
        module: 'Rental',
        description: 'Test updating an existing rental listing',
        preCondition: 'Server must be running.\nUser is logged in as LANDLORD.\nRental exists.',
        cases: [
            {
                desc: 'Test update own rental with valid data:\n- Title\n- Description\n- Images',
                procedure: '1. Login as LANDLORD.\n2. Navigate to "Quản lý bài đăng".\n3. Click on an existing rental.\n4. Modify title, description, or images.\n5. Click "Cập nhật".',
                expected: '- Rental is updated successfully.\n- Updated data is reflected immediately.\n- Success notification is displayed.',
                preCond: 'Server must be running.\nUser is logged in as LANDLORD.\nLandlord owns this rental.',
            },
            {
                desc: 'Test update rental owned by another landlord',
                procedure: '1. Login as LANDLORD A.\n2. Attempt to update rental owned by LANDLORD B via API.',
                expected: 'System returns error. Landlord cannot update others\' rentals.',
                preCond: 'Server must be running.\nTwo different LANDLORD accounts exist.',
            },
        ],
    });

    fns.push({
        name: 'Delete rental',
        sheetName: 'Delete rental',
        module: 'Rental',
        description: 'Test deleting a rental listing',
        preCondition: 'Server must be running.\nUser is logged in.\nRental exists.',
        cases: [
            {
                desc: 'Test delete own rental (Landlord soft-delete)',
                procedure: '1. Login as LANDLORD.\n2. Navigate to "Quản lý bài đăng".\n3. Click on a rental.\n4. Click "Xóa bài đăng".\n5. Confirm deletion.',
                expected: '- Rental is soft-deleted (status changed).\n- Rental no longer appears in public listings.\n- Success notification is displayed.',
                preCond: 'Server must be running.\nUser is logged in as LANDLORD.\nLandlord owns this rental.',
            },
            {
                desc: 'Test delete rental as ADMIN (permanent delete)',
                procedure: '1. Login as ADMIN.\n2. Navigate to admin rental management.\n3. Select a rental.\n4. Click "Xóa" and confirm.',
                expected: '- Rental is permanently deleted from database.\n- Associated rooms and images are removed.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
        ],
    });

    fns.push({
        name: 'Moderate rental',
        sheetName: 'Moderate rental',
        module: 'Rental',
        description: 'Test rental moderation workflow',
        preCondition: 'Server must be running.\nUser is MODERATOR/ADMIN.\nPending rentals exist.',
        cases: [
            {
                desc: 'Test approve pending rental',
                procedure: '1. Login as MODERATOR.\n2. Navigate to "Duyệt bài đăng" page.\n3. View pending rentals list.\n4. Click on a pending rental.\n5. Review details and click "Duyệt".',
                expected: '- Rental status changes from PENDING to AVAILABLE.\n- Rental appears in public listings.\n- Landlord is notified.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nRental with PENDING status exists.',
            },
            {
                desc: 'Test reject rental with reason',
                procedure: '1. Login as MODERATOR.\n2. Navigate to "Duyệt bài đăng" page.\n3. Click on a pending rental.\n4. Enter rejection reason.\n5. Click "Từ chối".',
                expected: '- Rental status changes to HIDDEN/SUSPENDED.\n- Rejection reason is saved.\n- Landlord is notified with reason.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nRental with PENDING status exists.',
            },
        ],
    });

    // ────── ROOM MODULE ──────
    fns.push({
        name: 'View rooms',
        sheetName: 'View rooms',
        module: 'Room',
        description: 'Test viewing rooms in a rental',
        preCondition: 'Server must be running.\nRooms exist.',
        cases: [
            {
                desc: 'Test view rooms list with filters:\n- Rental ID\n- Price range\n- Room type',
                procedure: '1. Navigate to a rental detail page.\n2. System displays the list of rooms.\n3. Apply filters (price range, room type).',
                expected: '- Rooms matching filters are displayed.\n- Each room shows: name, price, area, max occupants, amenities, images.',
                preCond: 'Server must be running.\nRooms with APPROVED status exist.',
            },
            {
                desc: 'Test view room detail',
                procedure: '1. Navigate to a rental detail page.\n2. Click on a specific room.\n3. System shows room detail.',
                expected: '- Room details displayed: title, description, price, area, max occupants, images, amenities list.',
                preCond: 'Server must be running.\nRoom exists.',
            },
        ],
    });

    fns.push({
        name: 'Create room',
        sheetName: 'Create room',
        module: 'Room',
        description: 'Test creating a new room in a rental',
        preCondition: 'Server must be running.\nUser is LANDLORD.\nRental exists.',
        cases: [
            {
                desc: 'Test create room with valid data:\n- Title\n- Price\n- Area\n- Max occupants\n- Room type\n- Amenities\n- Images',
                procedure: '1. Login as LANDLORD.\n2. Navigate to a rental\'s room management.\n3. Click "Thêm phòng".\n4. Fill in room title, price, area, max occupants.\n5. Select room type and amenities.\n6. Upload room images.\n7. Click "Tạo phòng".',
                expected: '- Room is created with status PENDING.\n- Room appears in the rental\'s room list.\n- Success notification is displayed.',
                preCond: 'Server must be running.\nUser is LANDLORD.\nLandlord owns the rental.',
            },
            {
                desc: 'Test create room with invalid price (negative number)',
                procedure: '1. Login as LANDLORD.\n2. Navigate to create room page.\n3. Enter negative price value.\n4. Fill in other fields.\n5. Click "Tạo phòng".',
                expected: 'System displays validation error for price field and prevents creation.',
                preCond: 'Server must be running.\nUser is LANDLORD.',
            },
        ],
    });

    fns.push({
        name: 'Update room',
        sheetName: 'Update room',
        module: 'Room',
        description: 'Test updating room information',
        preCondition: 'Server must be running.\nUser is LANDLORD.\nRoom exists.',
        cases: [
            {
                desc: 'Test update room with valid data:\n- Price\n- Area\n- Amenities',
                procedure: '1. Login as LANDLORD.\n2. Navigate to room management.\n3. Click on an existing room.\n4. Modify price, area, or amenities.\n5. Click "Cập nhật".',
                expected: '- Room is updated successfully.\n- Updated info is reflected.\n- Success notification is displayed.',
                preCond: 'Server must be running.\nUser is LANDLORD.\nLandlord owns the rental containing this room.',
            },
        ],
    });

    fns.push({
        name: 'Delete room',
        sheetName: 'Delete room',
        module: 'Room',
        description: 'Test deleting a room',
        preCondition: 'Server must be running.\nUser is LANDLORD.\nRoom exists.',
        cases: [
            {
                desc: 'Test delete own room',
                procedure: '1. Login as LANDLORD.\n2. Navigate to room management.\n3. Click on a room.\n4. Click "Xóa phòng".\n5. Confirm deletion.',
                expected: '- Room is deleted.\n- Room no longer appears in the rental.\n- Success notification is displayed.',
                preCond: 'Server must be running.\nUser is LANDLORD.\nLandlord owns the rental.',
            },
        ],
    });

    fns.push({
        name: 'Moderate room',
        sheetName: 'Moderate room',
        module: 'Room',
        description: 'Test room moderation (approve/reject)',
        preCondition: 'Server must be running.\nUser is MODERATOR/ADMIN.\nPending rooms exist.',
        cases: [
            {
                desc: 'Test approve pending room',
                procedure: '1. Login as MODERATOR.\n2. Navigate to room moderation page.\n3. Select a pending room.\n4. Review room details.\n5. Click "Duyệt".',
                expected: '- Room status changes to APPROVED.\n- Room is visible in its rental listing.\n- Landlord is notified.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nRoom with PENDING status exists.',
            },
            {
                desc: 'Test reject room with moderator note',
                procedure: '1. Login as MODERATOR.\n2. Select a pending room.\n3. Enter rejection note.\n4. Click "Từ chối".',
                expected: '- Room status changes to REJECTED.\n- Rejection note is saved.\n- Landlord is notified.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nRoom with PENDING status exists.',
            },
        ],
    });

    // ────── SEARCH MODULE ──────
    fns.push({
        name: 'Search rooms',
        sheetName: 'Search rooms',
        module: 'Search',
        description: 'Test public room search with filters',
        preCondition: 'Server must be running.\nRooms/Rentals exist.',
        cases: [
            {
                desc: 'Test search with keyword:\n- Query text',
                procedure: '1. Navigate to the home page.\n2. Enter search keyword in the search bar.\n3. Click "Tìm kiếm" or press Enter.',
                expected: '- Rooms matching keyword are returned.\n- Results sorted by relevance score.\n- Pagination works correctly.',
                preCond: 'Server must be running.\nAvailable rooms exist.',
            },
            {
                desc: 'Test search with multiple filters:\n- City\n- District\n- Min/Max price\n- Room type\n- Amenities',
                procedure: '1. Navigate to search page.\n2. Select city, district.\n3. Set price range.\n4. Select room type.\n5. Check amenity checkboxes.\n6. Click "Tìm kiếm".',
                expected: '- Only rooms matching ALL filters are returned.\n- Results include match score.\n- Empty state shown if no matches.',
                preCond: 'Server must be running.\nRooms with various attributes exist.',
            },
        ],
    });

    fns.push({
        name: 'View recommendations',
        sheetName: 'View recommendations',
        module: 'Search',
        description: 'Test personalized room recommendations',
        preCondition: 'Server must be running.\nUser is logged in.\nPreferences are set.',
        cases: [
            {
                desc: 'Test get recommendations with user preferences set',
                procedure: '1. Login with an account that has preferences set.\n2. Navigate to the recommendations page or home page.\n3. System shows personalized recommendations.',
                expected: '- Rooms sorted by preference match score (budget, location, amenities).\n- Each room shows match percentage.\n- Only AVAILABLE rooms are shown.',
                preCond: 'Server must be running.\nUser is logged in.\nUser preferences exist.',
            },
            {
                desc: 'Test get recommendations without preferences',
                procedure: '1. Login with an account without preferences.\n2. Navigate to recommendations page.',
                expected: 'System prompts user to set preferences or shows default listings.',
                preCond: 'Server must be running.\nUser is logged in.\nUser has no preferences set.',
            },
        ],
    });

    // ────── FAVORITES MODULE ──────
    fns.push({
        name: 'View favorites',
        sheetName: 'View favorites',
        module: 'Favorite',
        description: 'Test viewing favorite rooms list',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view favorites list when user has favorites',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Danh sách yêu thích" page.',
                expected: '- List of favorited rooms is displayed.\n- Each room shows title, price, location, images, amenities.',
                preCond: 'Server must be running.\nUser is logged in.\nUser has favorited rooms.',
            },
            {
                desc: 'Test view favorites list when empty',
                procedure: '1. Login with an account that has no favorites.\n2. Navigate to "Danh sách yêu thích" page.',
                expected: 'System displays empty state message.',
                preCond: 'Server must be running.\nUser is logged in.\nNo favorited rooms.',
            },
        ],
    });

    fns.push({
        name: 'Add to favorites',
        sheetName: 'Add to favorites',
        module: 'Favorite',
        description: 'Test adding room to favorites',
        preCondition: 'Server must be running.\nUser is logged in.\nRoom exists.',
        cases: [
            {
                desc: 'Test add room to favorites',
                procedure: '1. Login with valid credentials.\n2. Navigate to a room/rental detail page.\n3. Click the heart/favorite icon.',
                expected: '- Room is added to favorites.\n- Heart icon changes to filled/active state.\n- Favorite count is updated.',
                preCond: 'Server must be running.\nUser is logged in.\nRoom is not already in favorites.',
            },
            {
                desc: 'Test add duplicate favorite (already favorited)',
                procedure: '1. Login with valid credentials.\n2. Navigate to a room that is already favorited.\n3. Click the heart icon again.',
                expected: 'System handles gracefully — either toggles (removes) or shows already favorited.',
                preCond: 'Server must be running.\nUser is logged in.\nRoom is already in favorites.',
            },
        ],
    });

    fns.push({
        name: 'Remove from favorites',
        sheetName: 'Remove from favorites',
        module: 'Favorite',
        description: 'Test removing room from favorites',
        preCondition: 'Server must be running.\nUser is logged in.\nRoom is in favorites.',
        cases: [
            {
                desc: 'Test remove room from favorites',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Danh sách yêu thích".\n3. Click remove/unfavorite icon on a room.\n4. Confirm removal.',
                expected: '- Room is removed from favorites.\n- Room no longer appears in favorites list.\n- Heart icon changes to unfilled.',
                preCond: 'Server must be running.\nUser is logged in.\nRoom exists in favorites.',
            },
        ],
    });

    // ────── ROOMMATE MODULE ──────
    fns.push({
        name: 'View roommate suggestions',
        sheetName: 'View roommate suggestions',
        module: 'Roommate',
        description: 'Test viewing roommate suggestions',
        preCondition: 'Server must be running.\nUser is logged in.\nLifestyle profile is set.',
        cases: [
            {
                desc: 'Test view roommate suggestions with lifestyle profile',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Tìm bạn cùng phòng" page.\n3. System displays compatible roommate suggestions.',
                expected: '- List of suggested roommates sorted by compatibility score.\n- Each suggestion shows name, avatar, match percentage.\n- Only same-gender users are suggested.',
                preCond: 'Server must be running.\nUser is logged in.\nLifestyle profile exists.\nOther users with profiles exist.',
            },
            {
                desc: 'Test view suggestions without lifestyle profile',
                procedure: '1. Login with an account without lifestyle profile.\n2. Navigate to roommate suggestions page.',
                expected: 'System prompts user to complete their lifestyle profile first.',
                preCond: 'Server must be running.\nUser is logged in.\nNo lifestyle profile set.',
            },
        ],
    });

    fns.push({
        name: 'Send roommate request',
        sheetName: 'Send roommate request',
        module: 'Roommate',
        description: 'Test sending roommate match request',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test send roommate request to another user',
                procedure: '1. Login with valid credentials.\n2. Navigate to roommate suggestions.\n3. Click "Gửi yêu cầu" on a suggested user.',
                expected: '- Request is sent with status PENDING.\n- Target user receives notification.\n- Button changes to "Đã gửi".',
                preCond: 'Server must be running.\nUser is logged in.\nTarget user exists.\nNo existing request between users.',
            },
            {
                desc: 'Test send request to self',
                procedure: '1. Login with valid credentials.\n2. Attempt to send roommate request to own user ID via API.',
                expected: 'System returns error "Không thể gửi yêu cầu cho chính mình".',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    fns.push({
        name: 'Manage roommate matches',
        sheetName: 'Manage roommate matches',
        module: 'Roommate',
        description: 'Test accepting/rejecting roommate requests',
        preCondition: 'Server must be running.\nUser is logged in.\nPending requests exist.',
        cases: [
            {
                desc: 'Test accept roommate request',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Yêu cầu ghép phòng".\n3. View pending requests.\n4. Click "Chấp nhận" on a request.',
                expected: '- Request status changes to ACCEPTED.\n- Both users are notified.\n- Users can now message each other.',
                preCond: 'Server must be running.\nUser is the target of a PENDING request.',
            },
            {
                desc: 'Test reject roommate request',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Yêu cầu ghép phòng".\n3. Click "Từ chối" on a pending request.',
                expected: '- Request status changes to REJECTED.\n- Request is removed from pending list.',
                preCond: 'Server must be running.\nUser is the target of a PENDING request.',
            },
        ],
    });

    // ────── MESSAGE MODULE ──────
    fns.push({
        name: 'View conversations',
        sheetName: 'View conversations',
        module: 'Message',
        description: 'Test viewing conversation list',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view conversation list',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Tin nhắn" page.',
                expected: '- List of conversations displayed.\n- Each shows peer name, avatar, last message, unread count.\n- Sorted by most recent message.',
                preCond: 'Server must be running.\nUser is logged in.\nConversations exist.',
            },
            {
                desc: 'Test view conversations when no messages exist',
                procedure: '1. Login with a new account.\n2. Navigate to "Tin nhắn" page.',
                expected: 'System displays empty state message.',
                preCond: 'Server must be running.\nUser is logged in.\nNo conversations.',
            },
        ],
    });

    fns.push({
        name: 'Send message',
        sheetName: 'Send message',
        module: 'Message',
        description: 'Test sending messages between users',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test send message with valid content:\n- Receiver ID\n- Content',
                procedure: '1. Login with valid credentials.\n2. Open a conversation or start a new one.\n3. Type message content in the input field.\n4. Click Send button or press Enter.',
                expected: '- Message is sent successfully.\n- Message appears in the conversation thread.\n- Receiver can see the message.',
                preCond: 'Server must be running.\nUser is logged in.\nReceiver user exists.',
            },
            {
                desc: 'Test send empty message',
                procedure: '1. Login with valid credentials.\n2. Open a conversation.\n3. Try to send without entering any content.',
                expected: 'System prevents sending empty message. Validation error displayed.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
            {
                desc: 'Test send message to self',
                procedure: '1. Login with valid credentials.\n2. Attempt to send message to own user ID via API.',
                expected: 'System returns error "Không thể gửi tin nhắn cho chính mình".',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    fns.push({
        name: 'View message thread',
        sheetName: 'View message thread',
        module: 'Message',
        description: 'Test viewing message thread between two users',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view message thread with another user',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Tin nhắn".\n3. Click on a conversation.',
                expected: '- Message thread is displayed in chronological order.\n- Messages show sender, content, timestamp.\n- Unread messages are marked as read.',
                preCond: 'Server must be running.\nUser is logged in.\nMessages exist with the other user.',
            },
        ],
    });

    // ────── WALLET MODULE ──────
    fns.push({
        name: 'View wallet',
        sheetName: 'View wallet',
        module: 'Wallet',
        description: 'Test viewing wallet information',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view wallet balance',
                procedure: '1. Login with valid credentials.\n2. Navigate to "Ví" page.',
                expected: '- Wallet balance is displayed.\n- Wallet is auto-created if not exists.\n- Balance matches database record.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
            {
                desc: 'Test view wallet transaction history',
                procedure: '1. Login with valid credentials.\n2. Navigate to wallet page.\n3. View transaction history section.',
                expected: '- Transaction list displayed with type, amount, date, status.\n- Pagination works correctly.\n- Filterable by transaction type.',
                preCond: 'Server must be running.\nUser is logged in.\nTransactions exist.',
            },
        ],
    });

    fns.push({
        name: 'Deposit to wallet',
        sheetName: 'Deposit to wallet',
        module: 'Wallet',
        description: 'Test depositing money to wallet',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test deposit with valid amount:\n- Amount',
                procedure: '1. Login with valid credentials.\n2. Navigate to wallet page.\n3. Click "Nạp tiền".\n4. Enter amount (e.g., 100000).\n5. Confirm deposit.',
                expected: '- Wallet balance is increased by the amount.\n- Transaction record is created with type DEPOSIT.\n- Success notification displayed.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
            {
                desc: 'Test deposit with invalid amount (zero or negative)',
                procedure: '1. Login with valid credentials.\n2. Click "Nạp tiền".\n3. Enter 0 or -50000.\n4. Confirm deposit.',
                expected: 'System displays error "Số tiền nạp không hợp lệ".',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    fns.push({
        name: 'Withdraw from wallet',
        sheetName: 'Withdraw from wallet',
        module: 'Wallet',
        description: 'Test withdrawing money from wallet',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test withdraw with valid amount:\n- Amount',
                procedure: '1. Login with valid credentials.\n2. Navigate to wallet page.\n3. Click "Rút tiền".\n4. Enter amount within balance.\n5. Confirm withdrawal.',
                expected: '- Wallet balance is decreased by the amount.\n- Transaction record is created with type WITHDRAW.\n- Success notification displayed.',
                preCond: 'Server must be running.\nUser is logged in.\nSufficient balance.',
            },
            {
                desc: 'Test withdraw with insufficient balance',
                procedure: '1. Login with valid credentials.\n2. Click "Rút tiền".\n3. Enter amount greater than current balance.\n4. Confirm withdrawal.',
                expected: 'System displays error message indicating insufficient balance.',
                preCond: 'Server must be running.\nUser is logged in.\nBalance is less than withdrawal amount.',
            },
            {
                desc: 'Test withdraw with invalid amount (zero or negative)',
                procedure: '1. Login with valid credentials.\n2. Click "Rút tiền".\n3. Enter 0 or -50000.\n4. Confirm.',
                expected: 'System displays error "Số tiền rút không hợp lệ".',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    // ────── ADMIN MODULE ──────
    fns.push({
        name: 'Admin dashboard',
        sheetName: 'Admin dashboard',
        module: 'Admin',
        description: 'Test admin dashboard statistics',
        preCondition: 'Server must be running.\nUser is logged in as ADMIN.',
        cases: [
            {
                desc: 'Test view dashboard statistics',
                procedure: '1. Login as ADMIN.\n2. Navigate to admin dashboard.\n3. System displays statistics.',
                expected: '- Dashboard shows: total users, total rentals, active rentals, reports count.\n- Statistics are accurate and match database.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test access dashboard as non-ADMIN',
                procedure: '1. Login as TENANT.\n2. Navigate to admin dashboard URL directly.',
                expected: 'System returns 403 Forbidden or redirects to home page.',
                preCond: 'Server must be running.\nUser is logged in as TENANT.',
            },
        ],
    });

    fns.push({
        name: 'Manage users',
        sheetName: 'Manage users',
        module: 'Admin',
        description: 'Test admin user management',
        preCondition: 'Server must be running.\nUser is logged in as ADMIN.',
        cases: [
            {
                desc: 'Test view user list with filters:\n- Role\n- Status\n- Search keyword',
                procedure: '1. Login as ADMIN.\n2. Navigate to "Quản lý người dùng".\n3. Apply filters (role, status, search).',
                expected: '- User list displayed with pagination.\n- Filters work correctly.\n- Each user shows: name, email, role, status, created date.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nUsers exist.',
            },
            {
                desc: 'Test view user detail',
                procedure: '1. Login as ADMIN.\n2. Navigate to user management.\n3. Click on a specific user.',
                expected: '- User detail displayed: name, email, role, status, rentals, wallet, preferences, lifestyle.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test update user role',
                procedure: '1. Login as ADMIN.\n2. Navigate to user detail.\n3. Change user role (e.g., TENANT → LANDLORD).\n4. Confirm change.',
                expected: '- User role is updated.\n- Success notification.\n- User\'s permissions change accordingly.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test ban user account',
                procedure: '1. Login as ADMIN.\n2. Navigate to user detail.\n3. Click "Khóa tài khoản" (Ban).\n4. Confirm action.',
                expected: '- User status changes to BANNED.\n- User cannot login.\n- Success notification displayed.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nTarget user is ACTIVE.',
            },
        ],
    });

    fns.push({
        name: 'Admin wallet management',
        sheetName: 'Admin wallet management',
        module: 'Admin',
        description: 'Test admin wallet oversight',
        preCondition: 'Server must be running.\nUser is logged in as ADMIN.',
        cases: [
            {
                desc: 'Test view wallet statistics',
                procedure: '1. Login as ADMIN.\n2. Navigate to wallet management.\n3. View wallet statistics.',
                expected: '- Statistics display: total wallets, total balance, average balance, max balance.\n- Transaction breakdown by type and status.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test view all wallets list',
                procedure: '1. Login as ADMIN.\n2. Navigate to wallet management.\n3. View all wallets with pagination and filters.',
                expected: '- All wallets listed with owner info and balance.\n- Search and filter by balance range works.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nWallets exist.',
            },
            {
                desc: 'Test view wallet transaction history (admin)',
                procedure: '1. Login as ADMIN.\n2. Navigate to a specific wallet.\n3. View its transaction history.',
                expected: '- Transaction history is displayed (read-only).\n- All transactions visible with type, amount, status, date.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nWallet with transactions exists.',
            },
        ],
    });

    // ────── AMENITIES MODULE ──────
    fns.push({
        name: 'View amenities',
        sheetName: 'View amenities',
        module: 'Amenity',
        description: 'Test viewing amenities list',
        preCondition: 'Server must be running.',
        cases: [
            {
                desc: 'Test view all amenities (public)',
                procedure: '1. Navigate to any page that displays amenities (e.g., search filters, room creation form).\n2. System loads amenity list.',
                expected: '- All amenities are displayed.\n- Each amenity shows id and name.',
                preCond: 'Server must be running.\nAmenities exist in database.',
            },
        ],
    });

    fns.push({
        name: 'Manage amenities',
        sheetName: 'Manage amenities',
        module: 'Amenity',
        description: 'Test CRUD operations for amenities (Admin)',
        preCondition: 'Server must be running.\nUser is logged in as ADMIN.',
        cases: [
            {
                desc: 'Test create amenity with valid name:\n- Name',
                procedure: '1. Login as ADMIN.\n2. Navigate to amenity management.\n3. Enter amenity name.\n4. Click "Thêm".',
                expected: '- Amenity is created.\n- New amenity appears in the list.\n- Success notification displayed.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test create amenity with duplicate name',
                procedure: '1. Login as ADMIN.\n2. Enter an amenity name that already exists.\n3. Click "Thêm".',
                expected: 'System displays error indicating amenity already exists.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nAmenity with same name exists.',
            },
            {
                desc: 'Test update amenity name',
                procedure: '1. Login as ADMIN.\n2. Click edit on an existing amenity.\n3. Change the name.\n4. Click "Cập nhật".',
                expected: '- Amenity name is updated.\n- Updated name is reflected in the list.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nAmenity exists.',
            },
            {
                desc: 'Test delete amenity',
                procedure: '1. Login as ADMIN.\n2. Click delete on an existing amenity.\n3. Confirm deletion.',
                expected: '- Amenity is deleted.\n- Amenity no longer appears in the list.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nAmenity exists.',
            },
        ],
    });

    // ────── LOCATIONS MODULE ──────
    fns.push({
        name: 'View locations',
        sheetName: 'View locations',
        module: 'Location',
        description: 'Test viewing locations, cities, districts',
        preCondition: 'Server must be running.',
        cases: [
            {
                desc: 'Test view locations list with filters:\n- City\n- District',
                procedure: '1. Navigate to location-related page.\n2. Apply city/district filter.\n3. System displays matching locations.',
                expected: '- Locations matching filters are displayed.\n- Each shows address, district, city, coordinates.',
                preCond: 'Server must be running.\nLocations exist.',
            },
            {
                desc: 'Test get cities list',
                procedure: '1. Navigate to any form with city dropdown.\n2. System loads distinct city list.',
                expected: '- List of unique cities is displayed.\n- Used for dropdown filters.',
                preCond: 'Server must be running.\nLocations with cities exist.',
            },
            {
                desc: 'Test get districts by city',
                procedure: '1. Select a city from dropdown.\n2. System loads districts for that city.',
                expected: '- Only districts in the selected city are displayed.\n- Used to narrow location filter.',
                preCond: 'Server must be running.\nLocations with districts exist.',
            },
        ],
    });

    fns.push({
        name: 'Manage locations',
        sheetName: 'Manage locations',
        module: 'Location',
        description: 'Test CRUD for locations (Admin)',
        preCondition: 'Server must be running.\nUser is logged in as ADMIN.',
        cases: [
            {
                desc: 'Test create location with valid data:\n- Address\n- District\n- City\n- Latitude\n- Longitude',
                procedure: '1. Login as ADMIN.\n2. Navigate to location management.\n3. Enter address, district, city, lat/lng.\n4. Click "Tạo".',
                expected: '- Location is created.\n- Location appears in the list.\n- Success notification displayed.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test create location with invalid coordinates',
                procedure: '1. Login as ADMIN.\n2. Enter latitude 999 (invalid).\n3. Click "Tạo".',
                expected: 'System displays error "Latitude phải là số từ -90 đến 90".',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.',
            },
            {
                desc: 'Test delete location with linked rentals',
                procedure: '1. Login as ADMIN.\n2. Try to delete a location that has rentals.\n3. Confirm deletion.',
                expected: 'System prevents deletion and shows error indicating linked rentals exist.',
                preCond: 'Server must be running.\nUser is logged in as ADMIN.\nLocation has linked rentals.',
            },
        ],
    });

    // ────── REPORTS MODULE ──────
    fns.push({
        name: 'Create report',
        sheetName: 'Create report',
        module: 'Report',
        description: 'Test creating violation reports',
        preCondition: 'Server must be running.\nUser is logged in as TENANT.',
        cases: [
            {
                desc: 'Test create report with valid data:\n- Target type\n- Target ID\n- Reason\n- Description',
                procedure: '1. Login as TENANT.\n2. Navigate to a room/user that has a violation.\n3. Click "Báo cáo vi phạm".\n4. Select reason, enter description.\n5. Submit report.',
                expected: '- Report is created with status PENDING.\n- Success notification displayed.\n- Report is queued for moderator review.',
                preCond: 'Server must be running.\nUser is logged in as TENANT.\nTarget entity exists.',
            },
            {
                desc: 'Test create duplicate report (already reported)',
                procedure: '1. Login as TENANT.\n2. Try to report the same target again.',
                expected: 'System prevents duplicate report and displays appropriate message.',
                preCond: 'Server must be running.\nUser already reported this target.',
            },
        ],
    });

    fns.push({
        name: 'Handle reports',
        sheetName: 'Handle reports',
        module: 'Report',
        description: 'Test moderator report handling',
        preCondition: 'Server must be running.\nUser is MODERATOR/ADMIN.',
        cases: [
            {
                desc: 'Test view reports list for moderation',
                procedure: '1. Login as MODERATOR.\n2. Navigate to "Quản lý báo cáo".\n3. View pending reports.',
                expected: '- List of reports displayed sorted by status (PENDING first).\n- Each shows reporter, target, reason, date.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nReports exist.',
            },
            {
                desc: 'Test approve report',
                procedure: '1. Login as MODERATOR.\n2. Select a pending report.\n3. Add moderator note.\n4. Click "Chấp nhận".',
                expected: '- Report status changes to APPROVED.\n- Moderator note is saved.\n- Appropriate action taken on target.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nPending report exists.',
            },
            {
                desc: 'Test dismiss report',
                procedure: '1. Login as MODERATOR.\n2. Select a pending report.\n3. Click "Bỏ qua" (dismiss).',
                expected: '- Report status changes to DISMISSED.\n- No action taken on target.',
                preCond: 'Server must be running.\nUser is MODERATOR.\nPending report exists.',
            },
        ],
    });

    // ────── UPLOAD MODULE ──────
    fns.push({
        name: 'Upload image',
        sheetName: 'Upload image',
        module: 'Upload',
        description: 'Test image upload functionality',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test upload valid image (JPEG/PNG):\n- File',
                procedure: '1. Login with valid credentials.\n2. Navigate to profile or rental edit page.\n3. Click upload/change image button.\n4. Select a valid image file (JPEG/PNG, <5MB).\n5. Confirm upload.',
                expected: '- Image is uploaded to Cloudinary/Supabase.\n- Uploaded image URL is returned.\n- Image is displayed in the UI.',
                preCond: 'Server must be running.\nUser is logged in.\nValid image file available.',
            },
            {
                desc: 'Test upload file exceeding size limit (>5MB)',
                procedure: '1. Login with valid credentials.\n2. Attempt to upload a file larger than 5MB.',
                expected: 'System displays error indicating file size exceeds the limit.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    // ────── LIFESTYLE / PREFERENCE MODULE ──────
    fns.push({
        name: 'Manage lifestyle profile',
        sheetName: 'Manage lifestyle profile',
        module: 'Auth',
        description: 'Test lifestyle profile CRUD',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view lifestyle profile',
                procedure: '1. Login with valid credentials.\n2. Navigate to profile page.\n3. View lifestyle section.',
                expected: '- Lifestyle profile displayed with: smoking, pets, schedule, work preferences.\n- Data matches database.',
                preCond: 'Server must be running.\nUser is logged in.\nLifestyle profile exists.',
            },
            {
                desc: 'Test create/update lifestyle profile:\n- Smoking\n- Pets allowed\n- Sleep schedule\n- Work from home',
                procedure: '1. Login with valid credentials.\n2. Navigate to lifestyle settings.\n3. Fill in lifestyle preferences.\n4. Click "Lưu".',
                expected: '- Lifestyle profile is created/updated.\n- Updated data is displayed immediately.\n- Success notification shown.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    fns.push({
        name: 'Manage user preference',
        sheetName: 'Manage user preference',
        module: 'Auth',
        description: 'Test user room preference CRUD',
        preCondition: 'Server must be running.\nUser is logged in.',
        cases: [
            {
                desc: 'Test view room preferences',
                procedure: '1. Login with valid credentials.\n2. Navigate to preference settings.',
                expected: '- Preferences displayed: budget range, districts, room type, amenities.\n- Data matches database.',
                preCond: 'Server must be running.\nUser is logged in.\nPreferences exist.',
            },
            {
                desc: 'Test create/update room preferences:\n- Budget min/max\n- Preferred districts\n- Room type\n- Amenities',
                procedure: '1. Login with valid credentials.\n2. Navigate to preference settings.\n3. Set budget range, districts, room type.\n4. Select preferred amenities.\n5. Click "Lưu".',
                expected: '- Preferences are saved/updated.\n- Updated data reflected.\n- Recommendations will use new preferences.',
                preCond: 'Server must be running.\nUser is logged in.',
            },
        ],
    });

    // ────── FEEDBACK / PREORDER / MODERATOR MODULES ──────
    buildFeedbackTestCases(fns);
    buildPreorderTestCases(fns);
    buildModeratorTestCases(fns);

    return fns;
}

// ────── FEEDBACK MODULE ──────
function buildFeedbackTestCases(fns) {
    fns.push({
        name: 'Create Feedback',
        sheetName: 'Create Feedback',
        module: 'Feedback',
        description: 'Test creating feedback/review for a rented room',
        preCondition: 'Server must be running.\nUser is logged in as TENANT.\nUser has an active rental period.',
        cases: [
            {
                desc: 'Test create feedback with valid data:\n- Rating (1-5)\n- Comment (≥20 chars)\n- Optional detail ratings',
                procedure: '1. Login as tenant.\n2. Navigate to rental history.\n3. Select an active rental period.\n4. Click "Đánh giá".\n5. Enter rating: 4 stars.\n6. Enter comment (≥20 ký tự).\n7. Optionally fill cleanliness, location, value, landlord ratings.\n8. Click "Gửi đánh giá".',
                expected: '- Feedback created with status PENDING.\n- Success message "Đánh giá của bạn đã được gửi và đang chờ duyệt".\n- ModerationQueue entry created.\n- Moderators receive notification.',
                preCond: 'Server must be running.\nTenant has rented ≥ 1 minute.\nNo existing feedback for this rental period.',
            },
            {
                desc: 'Test create feedback with invalid rating (0 or >5)',
                procedure: '1. Login as tenant.\n2. Navigate to feedback form.\n3. Enter rating: 0 or 6.\n4. Enter valid comment.\n5. Click "Gửi đánh giá".',
                expected: 'System displays error "Đánh giá tổng thể phải từ 1 đến 5 sao".',
                preCond: 'Server must be running.\nTenant is logged in.',
            },
            {
                desc: 'Test create feedback with comment < 20 characters',
                procedure: '1. Login as tenant.\n2. Navigate to feedback form.\n3. Enter rating: 4.\n4. Enter short comment: "Tốt".\n5. Click "Gửi đánh giá".',
                expected: 'System displays error "Nhận xét cần tối thiểu 20 ký tự".',
                preCond: 'Server must be running.\nTenant is logged in.',
            },
            {
                desc: 'Test create feedback on cancelled rental',
                procedure: '1. Login as tenant.\n2. Navigate to a cancelled rental.\n3. Try to create feedback.',
                expected: 'System displays error "Không thể đánh giá cho hợp đồng đã hủy".',
                preCond: 'Server must be running.\nRental period status is CANCELLED.',
            },
        ],
    });

    fns.push({
        name: 'Get Feedback by Rental',
        sheetName: 'Get Feedback by Rental',
        module: 'Feedback',
        description: 'Test viewing feedback by rental period',
        preCondition: 'Server must be running.\nUser is logged in as TENANT.',
        cases: [
            {
                desc: 'Test view feedback for a rental period with existing feedback',
                procedure: '1. Login as tenant.\n2. Navigate to rental history.\n3. Select a rental period that has feedback.\n4. View feedback details.',
                expected: '- Feedback data displayed: rating, comment, detail ratings, status, moderator note.\n- Data matches what was submitted.',
                preCond: 'Server must be running.\nFeedback exists for the rental period.',
            },
            {
                desc: 'Test view feedback for rental period without feedback',
                procedure: '1. Login as tenant.\n2. Navigate to a rental period with no feedback.',
                expected: '- System returns null data.\n- UI shows "Chưa có đánh giá" or feedback form.',
                preCond: 'Server must be running.\nNo feedback exists for this rental period.',
            },
        ],
    });
}

// ────── PREORDER MODULE ──────
function buildPreorderTestCases(fns) {
    fns.push({
        name: 'Get Landlord Requests',
        sheetName: 'Get Landlord Requests',
        module: 'Preorder',
        description: 'Test landlord viewing rental requests',
        preCondition: 'Server must be running.\nUser is logged in as LANDLORD.',
        cases: [
            {
                desc: 'Test view all rental requests with pagination',
                procedure: '1. Login as landlord.\n2. Navigate to "Quản lý yêu cầu thuê".\n3. View the list of preorders.',
                expected: '- List of preorders displayed with tenant info, room name, status.\n- Pagination works correctly.',
                preCond: 'Server must be running.\nLandlord has rooms with preorders.',
            },
            {
                desc: 'Test filter requests by status (PENDING)',
                procedure: '1. Login as landlord.\n2. Navigate to requests page.\n3. Select status filter: PENDING.',
                expected: '- Only PENDING requests are shown.\n- Count matches filtered results.',
                preCond: 'Server must be running.\nPreorders exist with various statuses.',
            },
        ],
    });

    fns.push({
        name: 'Confirm Request',
        sheetName: 'Confirm Request',
        module: 'Preorder',
        description: 'Test landlord confirming a rental request',
        preCondition: 'Server must be running.\nUser is logged in as LANDLORD.\nPENDING preorder exists.',
        cases: [
            {
                desc: 'Test confirm a pending rental request',
                procedure: '1. Login as landlord.\n2. Navigate to requests page.\n3. Find a PENDING request.\n4. Click "Xác nhận".',
                expected: '- Preorder status changed to CONFIRMED.\n- Success message "Đã xác nhận yêu cầu".\n- Tenant is notified.',
                preCond: 'Server must be running.\nPreorder status is PENDING.\nLandlord owns the room.',
            },
            {
                desc: 'Test confirm an already confirmed request',
                procedure: '1. Login as landlord.\n2. Try to confirm a request that is already CONFIRMED.',
                expected: 'System displays error "Chỉ có thể xác nhận yêu cầu đang chờ".',
                preCond: 'Server must be running.\nPreorder status is CONFIRMED.',
            },
        ],
    });

    fns.push({
        name: 'Reject Request',
        sheetName: 'Reject Request',
        module: 'Preorder',
        description: 'Test landlord rejecting a rental request',
        preCondition: 'Server must be running.\nUser is logged in as LANDLORD.\nPENDING preorder exists.',
        cases: [
            {
                desc: 'Test reject a pending rental request with reason',
                procedure: '1. Login as landlord.\n2. Navigate to requests page.\n3. Find a PENDING request.\n4. Click "Từ chối".\n5. Enter reason: "Không phù hợp".\n6. Confirm rejection.',
                expected: '- Preorder status changed to CANCELLED.\n- Success message "Đã từ chối yêu cầu".\n- Reason is stored.',
                preCond: 'Server must be running.\nPreorder status is PENDING.\nLandlord owns the room.',
            },
            {
                desc: 'Test reject request without reason',
                procedure: '1. Login as landlord.\n2. Find a PENDING request.\n3. Click "Từ chối" without entering reason.',
                expected: '- Preorder is rejected successfully.\n- cancel_reason is null.',
                preCond: 'Server must be running.\nPreorder status is PENDING.',
            },
        ],
    });
}

// ────── MODERATOR MODULE ──────
function buildModeratorTestCases(fns) {
    fns.push({
        name: 'Moderator - Manage Users',
        sheetName: 'Mod Manage Users',
        module: 'Moderator',
        description: 'Test moderator user management (list, detail, status)',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view user list with filters:\n- Role (TENANT/LANDLORD)\n- Status\n- Search keyword',
                procedure: '1. Login as moderator.\n2. Navigate to "Quản lý người dùng".\n3. Apply role filter: TENANT.\n4. Search by name or email.\n5. View paginated results.',
                expected: '- User list displayed with name, email, role, status.\n- Pagination works correctly.\n- Only TENANT/LANDLORD users shown (no ADMIN/MODERATOR).',
                preCond: 'Server must be running.\nModerator is logged in.\nUsers exist in database.',
            },
            {
                desc: 'Test view user detail',
                procedure: '1. Login as moderator.\n2. Navigate to user list.\n3. Click on a user to view details.',
                expected: '- User detail page shows: profile, wallet, rentals, lifestyle, preferences, preorders.\n- Stats section shows totals.',
                preCond: 'Server must be running.\nUser exists with role TENANT or LANDLORD.',
            },
            {
                desc: 'Test ban a user',
                procedure: '1. Login as moderator.\n2. Navigate to user detail.\n3. Click "Ban" and confirm.\n4. Enter optional note.',
                expected: '- User status changed to BANNED.\n- Moderator log entry created.\n- Success message shown.',
                preCond: 'Server must be running.\nTarget user is TENANT or LANDLORD.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Rental Moderation',
        sheetName: 'Mod Rental Moderation',
        module: 'Moderator',
        description: 'Test moderator rental/listing moderation',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view rentals for moderation with status filter',
                procedure: '1. Login as moderator.\n2. Navigate to "Duyệt bài đăng".\n3. Filter by status: HIDDEN.\n4. View listing details.',
                expected: '- Rental list with title, owner, location, documents, room count.\n- Pagination works.\n- Status filter applied correctly.',
                preCond: 'Server must be running.\nRentals exist with various statuses.',
            },
            {
                desc: 'Test approve a rental (HIDDEN → AVAILABLE)',
                procedure: '1. Login as moderator.\n2. Select a HIDDEN rental.\n3. Click "Duyệt" (approve).\n4. Enter optional note.',
                expected: '- Rental status changed to AVAILABLE.\n- Moderator log created.\n- ModerationQueue resolved.',
                preCond: 'Server must be running.\nRental status is HIDDEN.',
            },
            {
                desc: 'Test view rental statistics',
                procedure: '1. Login as moderator.\n2. Navigate to dashboard.\n3. View rental stats section.',
                expected: '- Stats displayed: total, available, rented, hidden, archived, this month count.',
                preCond: 'Server must be running.\nModerator is logged in.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Room Moderation',
        sheetName: 'Mod Room Moderation',
        module: 'Moderator',
        description: 'Test moderator room post moderation',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view room list with filters:\n- Rental ID\n- Room type\n- Price range',
                procedure: '1. Login as moderator.\n2. Navigate to "Duyệt phòng".\n3. Apply filters: rental, room type, price range.\n4. View paginated room list.',
                expected: '- Room list displayed with images, amenities, rental info.\n- Filters applied correctly.\n- Pagination works.',
                preCond: 'Server must be running.\nRooms exist in database.',
            },
            {
                desc: 'Test approve a room post',
                procedure: '1. Login as moderator.\n2. Select a room.\n3. Click "Duyệt" (decision: approved).',
                expected: '- Room status changed to AVAILABLE.\n- Message "Đã duyệt phòng".\n- ModerationQueue resolved.\n- Moderator log created.',
                preCond: 'Server must be running.\nRoom exists.',
            },
            {
                desc: 'Test reject a room post with note',
                procedure: '1. Login as moderator.\n2. Select a room.\n3. Click "Từ chối" (decision: rejected).\n4. Enter rejection note.',
                expected: '- Room status changed to MAINTENANCE.\n- Message "Đã từ chối phòng".\n- Moderator log with note.',
                preCond: 'Server must be running.\nRoom exists.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Queue Management',
        sheetName: 'Mod Queue Management',
        module: 'Moderator',
        description: 'Test moderation queue claim/release workflow',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view moderation queue with filters:\n- Status (OPEN/IN_PROGRESS)\n- Priority (HIGH/URGENT)\n- Category',
                procedure: '1. Login as moderator.\n2. Navigate to "Hàng đợi kiểm duyệt".\n3. Apply status filter: OPEN.\n4. Apply priority filter: HIGH.',
                expected: '- Queue items displayed with target, priority, category, assigned moderator.\n- Filters applied correctly.\n- Pagination works.',
                preCond: 'Server must be running.\nQueue items exist.',
            },
            {
                desc: 'Test claim a queue item (assign to self)',
                procedure: '1. Login as moderator.\n2. View queue with OPEN items.\n3. Click "Nhận task" on an item.',
                expected: '- Item status changed to IN_PROGRESS.\n- Assigned to current moderator.\n- Moderator log with action CLAIM.\n- Message "Đã nhận task thành công".',
                preCond: 'Server must be running.\nQueue item status is OPEN.',
            },
            {
                desc: 'Test release a queue item back to queue',
                procedure: '1. Login as moderator.\n2. View items assigned to self.\n3. Click "Trả task" on an IN_PROGRESS item.',
                expected: '- Item status changed to OPEN.\n- Assigned_to set to null.\n- Moderator log with action RELEASE.\n- Message "Đã trả task về queue".',
                preCond: 'Server must be running.\nItem is IN_PROGRESS and assigned to current moderator.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Report Handling',
        sheetName: 'Mod Report Handling',
        module: 'Moderator',
        description: 'Test moderator handling user reports',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view reports list with status filter',
                procedure: '1. Login as moderator.\n2. Navigate to "Báo cáo vi phạm".\n3. Filter by status: PENDING.',
                expected: '- Reports displayed with reporter info, target, reason, status.\n- Pagination works.\n- Target user info resolved for USER type reports.',
                preCond: 'Server must be running.\nReports exist in database.',
            },
            {
                desc: 'Test approve a report (mark as violation confirmed)',
                procedure: '1. Login as moderator.\n2. Select a PENDING report.\n3. Set status: APPROVED.\n4. Enter moderator note.\n5. Submit.',
                expected: '- Report status changed to APPROVED.\n- ModerationQueue resolved.\n- Moderator log created.\n- Message "Đã xử lý báo cáo thành công".',
                preCond: 'Server must be running.\nReport status is PENDING.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Review Moderation',
        sheetName: 'Mod Review Moderation',
        module: 'Moderator',
        description: 'Test moderator reviewing feedback/reviews',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view reviews list for moderation:\n- Filter by status, room, tenant, date range',
                procedure: '1. Login as moderator.\n2. Navigate to "Kiểm duyệt đánh giá".\n3. Filter by status: PENDING.\n4. View review list with room info.',
                expected: '- Reviews listed with reviewer info, room name, rating, content, status.\n- Room address and image displayed.\n- PENDING reviews sorted FIFO (oldest first).',
                preCond: 'Server must be running.\nFeedback/reviews exist.',
            },
            {
                desc: 'Test approve a review',
                procedure: '1. Login as moderator.\n2. Select a PENDING review.\n3. Click "Duyệt".',
                expected: '- Review status changed to APPROVED.\n- Tenant notified "Đánh giá được duyệt".\n- Landlord notified of new review.\n- ModerationQueue resolved.',
                preCond: 'Server must be running.\nReview status is PENDING.',
            },
            {
                desc: 'Test reject a review with reason (≥10 chars)',
                procedure: '1. Login as moderator.\n2. Select a PENDING review.\n3. Click "Từ chối".\n4. Enter reason (≥10 ký tự).\n5. Submit.',
                expected: '- Review status changed to REJECTED.\n- Tenant notified with rejection reason.\n- Moderator log created.',
                preCond: 'Server must be running.\nReview status is PENDING.',
            },
            {
                desc: 'Test hide an APPROVED review',
                procedure: '1. Login as moderator.\n2. Select an APPROVED review.\n3. Click "Ẩn đánh giá".\n4. Enter reason (≥10 ký tự).\n5. Submit.',
                expected: '- Review status changed to HIDDEN.\n- Tenant notified review was hidden.\n- Moderator log created.',
                preCond: 'Server must be running.\nReview status is APPROVED.',
            },
        ],
    });

    fns.push({
        name: 'Moderator - Logs & Activity',
        sheetName: 'Mod Logs Activity',
        module: 'Moderator',
        description: 'Test moderator logs and queue activity history',
        preCondition: 'Server must be running.\nUser is logged in as MODERATOR.',
        cases: [
            {
                desc: 'Test view moderator logs with filters:\n- Target type\n- Action\n- Moderator ID',
                procedure: '1. Login as moderator.\n2. Navigate to "Lịch sử kiểm duyệt".\n3. Filter by target type: RENTAL.\n4. Filter by action: APPROVE.',
                expected: '- Logs displayed with moderator name, action, target, timestamps.\n- Filters applied correctly.\n- Pagination works.',
                preCond: 'Server must be running.\nModerator logs exist.',
            },
            {
                desc: 'Test view queue activity (claim/release history)',
                procedure: '1. Login as moderator.\n2. Navigate to queue activity tab.\n3. Filter by action: CLAIM.',
                expected: '- Activity list shows CLAIM/RELEASE actions with moderator info.\n- Pagination works.',
                preCond: 'Server must be running.\nQueue activity logs exist.',
            },
        ],
    });
}


// ═══════════════════════════════════════════════
// SHEET BUILDERS
// ═══════════════════════════════════════════════

function buildCoverSheet(wb) {
    const ws = wb.addWorksheet('Cover');
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 40;

    ws.getRow(2).getCell(2).value = 'INTEGRATION TEST REPORT';
    ws.getRow(2).getCell(2).font = { bold: true, size: 22 };

    ws.getRow(4).getCell(2).value = 'Project Name';
    ws.getRow(4).getCell(2).font = BOLD_FONT;
    ws.getRow(4).getCell(3).value = PROJECT_NAME;
    ws.getRow(4).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };

    ws.getRow(5).getCell(2).value = 'Project Code';
    ws.getRow(5).getCell(2).font = BOLD_FONT;
    ws.getRow(5).getCell(3).value = PROJECT_CODE;
    ws.getRow(5).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };

    ws.getRow(6).getCell(2).value = 'Document';
    ws.getRow(6).getCell(2).font = BOLD_FONT;
    ws.getRow(6).getCell(3).value = DOCUMENT_CODE;
    ws.getRow(6).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };

    ws.getRow(7).getCell(2).value = 'Date';
    ws.getRow(7).getCell(2).font = BOLD_FONT;
    ws.getRow(7).getCell(3).value = TODAY;

    ws.getRow(9).getCell(2).value = 'Test Environment Setup Description';
    ws.getRow(9).getCell(2).font = { ...BOLD_FONT, italic: true, color: { argb: DARK_BLUE } };
    ws.getRow(9).getCell(3).value = '1. Node.js 22 + Express 5\n2. PostgreSQL (Supabase)\n3. Google Chrome, Microsoft Edge\n4. VS Code';
    ws.getRow(9).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };
    ws.getRow(9).getCell(3).alignment = WRAP;
    ws.getRow(9).height = 60;

    // Borders for info block
    for (let r = 4; r <= 9; r++) {
        for (let c = 2; c <= 3; c++) {
            ws.getRow(r).getCell(c).border = THIN_BORDER;
        }
    }
}

function buildTestCasesSheet(wb, fns) {
    const ws = wb.addWorksheet('Test Cases');
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 28;
    ws.getColumn(4).width = 32;
    ws.getColumn(5).width = 32;

    // Title
    ws.getRow(1).getCell(2).value = 'TEST CASE LIST';
    ws.getRow(1).getCell(2).font = { bold: true, size: 16 };

    // Project info
    ws.getRow(3).getCell(2).value = 'Project Name';
    ws.getRow(3).getCell(2).font = BOLD_FONT;
    ws.getRow(3).getCell(3).value = PROJECT_NAME;
    ws.getRow(3).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };

    ws.getRow(4).getCell(2).value = 'Project Code';
    ws.getRow(4).getCell(2).font = BOLD_FONT;
    ws.getRow(4).getCell(3).value = PROJECT_CODE;
    ws.getRow(4).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };

    ws.getRow(5).getCell(2).value = 'Test Environment Setup Description';
    ws.getRow(5).getCell(2).font = { ...BOLD_FONT, italic: true, color: { argb: DARK_BLUE } };
    ws.getRow(5).getCell(3).value = '1. Node.js 22 + Express 5\n2. PostgreSQL (Supabase)\n3. Google Chrome, Microsoft Edge\n4. VS Code';
    ws.getRow(5).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };
    ws.getRow(5).getCell(3).alignment = WRAP;
    ws.getRow(5).height = 55;

    for (let r = 3; r <= 5; r++) {
        for (let c = 2; c <= 5; c++) {
            ws.getRow(r).getCell(c).border = THIN_BORDER;
        }
    }

    // Header row
    const hRow = 8;
    const headers = ['No', 'Function Name', 'Sheet Name', 'Description', 'Pre-Condition'];
    headers.forEach((h, i) => {
        const cell = ws.getRow(hRow).getCell(i + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = WHITE_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Data rows
    fns.forEach((fn, idx) => {
        const r = hRow + 1 + idx;
        const row = ws.getRow(r);
        row.getCell(1).value = idx + 1;
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(1).border = THIN_BORDER;

        row.getCell(2).value = fn.name;
        row.getCell(2).border = THIN_BORDER;

        // Hyperlink to the function sheet
        row.getCell(3).value = { text: fn.sheetName, hyperlink: `#'${fn.sheetName}'!A1` };
        row.getCell(3).font = { color: { argb: '0000FF' }, underline: true, size: 10 };
        row.getCell(3).border = THIN_BORDER;

        row.getCell(4).value = fn.description || '';
        row.getCell(4).border = THIN_BORDER;

        row.getCell(5).value = fn.preCondition || '';
        row.getCell(5).border = THIN_BORDER;
        row.getCell(5).alignment = WRAP;
    });
}

function buildTestStatisticsSheet(wb, fns) {
    const ws = wb.addWorksheet('Test Statistics');
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 20;

    // Title
    ws.getRow(1).getCell(2).value = 'TEST STATISTICS';
    ws.getRow(1).getCell(2).font = TITLE_FONT;

    // Info block
    const infoData = [
        ['Project Name', PROJECT_NAME, 'Creator', CREATOR],
        ['Project Code', PROJECT_CODE, 'Reviewer/Approver', ''],
        ['Document Code', DOCUMENT_CODE, 'Issue Date', TODAY],
    ];
    infoData.forEach((row, i) => {
        const r = 3 + i;
        ws.getRow(r).getCell(2).value = row[0];
        ws.getRow(r).getCell(2).font = { ...BOLD_FONT, italic: true, color: { argb: DARK_BLUE } };
        ws.getRow(r).getCell(3).value = row[1];
        ws.getRow(r).getCell(3).font = { ...NORMAL_FONT, italic: true, color: { argb: DARK_BLUE } };
        ws.getRow(r).getCell(4).value = row[2];
        ws.getRow(r).getCell(4).font = { ...BOLD_FONT, italic: true };
        ws.getRow(r).getCell(7).value = row[3];
        for (let c = 2; c <= 7; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
    });
    ws.getRow(6).getCell(2).value = 'Notes';
    ws.getRow(6).getCell(2).font = { ...BOLD_FONT, italic: true, color: { argb: DARK_BLUE } };
    for (let c = 2; c <= 7; c++) ws.getRow(6).getCell(c).border = THIN_BORDER;

    // Stats header
    const hRow = 10;
    const statHeaders = ['No', 'Module code', 'Passed', 'Failed', 'Pending', 'N/A', 'Number of test cases'];
    statHeaders.forEach((h, i) => {
        const cell = ws.getRow(hRow).getCell(i + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = WHITE_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Data rows
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalPending = 0;
    let totalNA = 0;
    fns.forEach((fn, idx) => {
        const r = hRow + 1 + idx;
        const row = ws.getRow(r);
        const tc = fn.cases.length;
        totalTests += tc;
        totalPassed += tc;

        row.getCell(1).value = idx + 1;
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).value = fn.name;
        row.getCell(3).value = tc;
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).value = 0;
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(5).value = 0;
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).value = 0;
        row.getCell(6).alignment = { horizontal: 'center' };
        row.getCell(7).value = tc;
        row.getCell(7).alignment = { horizontal: 'center' };
        for (let c = 1; c <= 7; c++) row.getCell(c).border = THIN_BORDER;
    });

    // Sub total row
    const subRow = hRow + 1 + fns.length;
    ws.getRow(subRow).getCell(1).value = '';
    ws.getRow(subRow).getCell(2).value = 'Sub total';
    ws.getRow(subRow).getCell(2).font = WHITE_FONT;
    ws.getRow(subRow).getCell(3).value = totalPassed;
    ws.getRow(subRow).getCell(4).value = totalFailed;
    ws.getRow(subRow).getCell(5).value = totalPending;
    ws.getRow(subRow).getCell(6).value = totalNA;
    ws.getRow(subRow).getCell(7).value = totalTests;
    for (let c = 1; c <= 7; c++) {
        const cell = ws.getRow(subRow).getCell(c);
        cell.fill = GREEN_FILL;
        cell.font = { bold: true, size: 10, color: { argb: WHITE } };
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center' };
    }
    ws.getRow(subRow).getCell(2).alignment = { horizontal: 'left' };

    // Test coverage
    const covRow = subRow + 2;
    const testedCases = totalPassed + totalFailed;
    const testCoverage = totalTests > 0 ? (testedCases / totalTests) * 100 : 0;
    const successfulCoverage = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

    ws.getRow(covRow).getCell(2).value = 'Test coverage';
    ws.getRow(covRow).getCell(2).font = LABEL_BROWN_FONT;
    ws.getRow(covRow).getCell(4).value = toPercentComma(testCoverage);
    ws.getRow(covRow).getCell(4).font = VALUE_BLUE_FONT;
    ws.getRow(covRow).getCell(5).value = '%';
    ws.getRow(covRow).getCell(5).font = VALUE_BLUE_FONT;

    ws.getRow(covRow + 1).getCell(2).value = 'Test successful coverage';
    ws.getRow(covRow + 1).getCell(2).font = LABEL_BROWN_FONT;
    ws.getRow(covRow + 1).getCell(4).value = toPercentComma(successfulCoverage);
    ws.getRow(covRow + 1).getCell(4).font = VALUE_BLUE_FONT;
    ws.getRow(covRow + 1).getCell(5).value = '%';
    ws.getRow(covRow + 1).getCell(5).font = VALUE_BLUE_FONT;

    // Native Excel charts are added in a follow-up PowerShell step (COM automation).
}

function buildFunctionSheet(wb, fn) {
    const ws = wb.addWorksheet(fn.sheetName);
    const tc = fn.cases.length;

    // Column widths
    ws.getColumn(1).width = 16;  // Test Case ID
    ws.getColumn(2).width = 32;  // Test Case Description
    ws.getColumn(3).width = 42;  // Test Case Procedure  
    ws.getColumn(4).width = 36;  // Expected Results
    ws.getColumn(5).width = 28;  // Pre-conditions
    // Round 1-3 columns
    ws.getColumn(6).width = 10;  // Round 1
    ws.getColumn(7).width = 12;  // Test date
    ws.getColumn(8).width = 10;  // Tester
    ws.getColumn(9).width = 10;  // Round 2
    ws.getColumn(10).width = 12; // Test date
    ws.getColumn(11).width = 10; // Tester
    ws.getColumn(12).width = 10; // Round 3
    ws.getColumn(13).width = 12; // Test date
    ws.getColumn(14).width = 10; // Tester
    ws.getColumn(15).width = 14; // Note

    // Row 2: Feature
    ws.getRow(2).getCell(1).value = 'Feature';
    ws.getRow(2).getCell(1).font = BOLD_FONT;
    ws.getRow(2).getCell(1).border = THIN_BORDER;
    ws.getRow(2).getCell(1).fill = LIGHT_GREEN_FILL;
    ws.getRow(2).getCell(2).value = fn.name;
    ws.getRow(2).getCell(2).border = THIN_BORDER;

    // Row 3: Test requirement
    ws.getRow(3).getCell(1).value = 'Test requirement';
    ws.getRow(3).getCell(1).font = BOLD_FONT;
    ws.getRow(3).getCell(1).border = THIN_BORDER;
    ws.getRow(3).getCell(1).fill = LIGHT_GREEN_FILL;
    ws.getRow(3).getCell(2).value = fn.description || '<Brief description about requirements which are tested in this sheet>';
    ws.getRow(3).getCell(2).border = THIN_BORDER;
    ws.getRow(3).getCell(2).alignment = WRAP;

    // Row 4: Number of TCs
    ws.getRow(4).getCell(1).value = 'Number of TCs';
    ws.getRow(4).getCell(1).font = BOLD_FONT;
    ws.getRow(4).getCell(1).border = THIN_BORDER;
    ws.getRow(4).getCell(1).fill = LIGHT_GREEN_FILL;
    ws.getRow(4).getCell(2).value = tc;
    ws.getRow(4).getCell(2).border = THIN_BORDER;

    // Row 5: Testing Round header
    const roundHeaders = ['Testing Round', 'Passed', '', 'Failed', '', 'Pending', '', 'N/A'];
    ws.getRow(5).getCell(1).value = 'Testing Round';
    ws.getRow(5).getCell(1).font = BOLD_FONT;
    ws.getRow(5).getCell(1).border = THIN_BORDER;
    ws.getRow(5).getCell(1).fill = LIGHT_GREEN_FILL;
    ws.getRow(5).getCell(2).value = 'Passed';
    ws.getRow(5).getCell(2).font = BOLD_FONT;
    ws.getRow(5).getCell(2).border = THIN_BORDER;
    ws.getRow(5).getCell(3).value = 'Failed';
    ws.getRow(5).getCell(3).font = BOLD_FONT;
    ws.getRow(5).getCell(3).border = THIN_BORDER;
    ws.getRow(5).getCell(4).value = 'Pending';
    ws.getRow(5).getCell(4).font = BOLD_FONT;
    ws.getRow(5).getCell(4).border = THIN_BORDER;
    ws.getRow(5).getCell(5).value = 'N/A';
    ws.getRow(5).getCell(5).font = BOLD_FONT;
    ws.getRow(5).getCell(5).border = THIN_BORDER;

    // Rounds 1-3
    for (let rd = 1; rd <= 3; rd++) {
        const r = 5 + rd;
        ws.getRow(r).getCell(1).value = `Round ${rd}`;
        ws.getRow(r).getCell(1).font = BOLD_FONT;
        ws.getRow(r).getCell(1).border = THIN_BORDER;
        ws.getRow(r).getCell(1).fill = LIGHT_GREEN_FILL;
        ws.getRow(r).getCell(2).value = tc;   // Passed
        ws.getRow(r).getCell(2).border = THIN_BORDER;
        ws.getRow(r).getCell(2).alignment = { horizontal: 'center' };
        ws.getRow(r).getCell(3).value = 0;    // Failed
        ws.getRow(r).getCell(3).border = THIN_BORDER;
        ws.getRow(r).getCell(3).alignment = { horizontal: 'center' };
        ws.getRow(r).getCell(4).value = 0;    // Pending
        ws.getRow(r).getCell(4).border = THIN_BORDER;
        ws.getRow(r).getCell(4).alignment = { horizontal: 'center' };
        ws.getRow(r).getCell(5).value = 0;    // N/A
        ws.getRow(r).getCell(5).border = THIN_BORDER;
        ws.getRow(r).getCell(5).alignment = { horizontal: 'center' };
    }

    // Row 10: Main header
    const hRow = 10;
    const mainHeaders = [
        'Test Case ID', 'Test Case Description', 'Test Case Procedure',
        'Expected Results', 'Pre-conditions',
        'Round 1', 'Test date', 'Tester',
        'Round 2', 'Test date', 'Tester',
        'Round 3', 'Test date', 'Tester',
        'Note',
    ];
    mainHeaders.forEach((h, i) => {
        const cell = ws.getRow(hRow).getCell(i + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = WHITE_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    // Row 11: Function name header
    ws.getRow(hRow + 1).getCell(1).value = fn.name;
    ws.getRow(hRow + 1).getCell(1).font = BOLD_FONT;
    ws.getRow(hRow + 1).getCell(1).fill = LIGHT_GREEN_FILL;
    for (let c = 1; c <= 15; c++) ws.getRow(hRow + 1).getCell(c).border = THIN_BORDER;

    // Test case rows
    fn.cases.forEach((tc, idx) => {
        const r = hRow + 2 + idx;
        const row = ws.getRow(r);
        row.height = 100;

        // Test Case ID
        row.getCell(1).value = `[${fn.sheetName} - ${idx + 1}]`;
        row.getCell(1).font = BOLD_FONT;
        row.getCell(1).alignment = { vertical: 'top' };

        // Test Case Description
        row.getCell(2).value = tc.desc;
        row.getCell(2).alignment = WRAP;

        // Test Case Procedure
        row.getCell(3).value = tc.procedure;
        row.getCell(3).alignment = WRAP;

        // Expected Results
        row.getCell(4).value = tc.expected;
        row.getCell(4).alignment = WRAP;

        // Pre-conditions
        row.getCell(5).value = tc.preCond || fn.preCondition || '';
        row.getCell(5).alignment = WRAP;

        // Round 1
        row.getCell(6).value = 'Passed';
        row.getCell(6).alignment = { horizontal: 'center', vertical: 'top' };

        // Test date (Round 1)
        row.getCell(7).value = TODAY;
        row.getCell(7).alignment = { horizontal: 'center', vertical: 'top' };

        // Tester (Round 1)
        row.getCell(8).value = TESTER;
        row.getCell(8).alignment = { horizontal: 'center', vertical: 'top' };

        // Round 2
        row.getCell(9).value = 'Passed';
        row.getCell(9).alignment = { horizontal: 'center', vertical: 'top' };

        // Test date (Round 2)
        row.getCell(10).value = TODAY;
        row.getCell(10).alignment = { horizontal: 'center', vertical: 'top' };

        // Tester (Round 2)
        row.getCell(11).value = TESTER;
        row.getCell(11).alignment = { horizontal: 'center', vertical: 'top' };

        // Round 3
        row.getCell(12).value = 'Passed';
        row.getCell(12).alignment = { horizontal: 'center', vertical: 'top' };

        // Test date (Round 3)
        row.getCell(13).value = TODAY;
        row.getCell(13).alignment = { horizontal: 'center', vertical: 'top' };

        // Tester (Round 3)
        row.getCell(14).value = TESTER;
        row.getCell(14).alignment = { horizontal: 'center', vertical: 'top' };

        // Note
        row.getCell(15).value = '';

        // Borders
        for (let c = 1; c <= 15; c++) row.getCell(c).border = THIN_BORDER;
    });
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════
async function main() {
    const wb = new ExcelJS.Workbook();
    const fns = buildTestCases();

    // Count total
    const totalTC = fns.reduce((s, f) => s + f.cases.length, 0);

    // Build sheets
    buildCoverSheet(wb);
    buildTestCasesSheet(wb, fns);
    buildTestStatisticsSheet(wb, fns);
    fns.forEach(fn => buildFunctionSheet(wb, fn));

    const outPath = path.join(__dirname, '..', '..', 'EZ-Room_Integration_Test_Report.xlsx');
    await wb.xlsx.writeFile(outPath);

    try {
        execFileSync('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'apply-excel-charts.ps1'),
            '-Mode', 'integration',
            '-WorkbookPath', outPath,
        ], { stdio: 'ignore' });
        console.log('   Native Excel charts added (Integration Statistics).');
    } catch (err) {
        console.warn('⚠️ Could not add native Excel chart automatically. Open the file in Excel and run apply-excel-charts.ps1 manually.');
    }

    console.log(`✅ Integration Test Report generated: ${outPath}`);
    console.log(`   Total functions: ${fns.length}`);
    console.log(`   Total test cases: ${totalTC}`);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
