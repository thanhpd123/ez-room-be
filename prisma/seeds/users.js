/**
 * Seed data cho Users (Chủ trọ, Người thuê)
 */

// Data mẫu cho Users
const usersData = {
    landlords: [
        {
            fullName: 'Nguyễn Văn Chủ Trọ',
            email: 'chutro@ezroom.vn',
            password_hash: '$2b$10$dummyhashfortest123456789',
            phone: '0901234567',
            role: 'LANDLORD',
            status: 'ACTIVE',
        },
        {
            fullName: 'Trần Thị Lan',
            email: 'lantt@ezroom.vn',
            password_hash: '$2b$10$dummyhashfortest123456789',
            phone: '0909876543',
            role: 'LANDLORD',
            status: 'ACTIVE',
        },
    ],
    tenants: [
        {
            fullName: 'Trần Văn Thuê',
            email: 'thuetro@ezroom.vn',
            password_hash: '$2b$10$dummyhashfortest123456789',
            phone: '0912345678',
            role: 'TENANT',
            status: 'ACTIVE',
        },
        {
            fullName: 'Lê Minh Sinh Viên',
            email: 'minhsv@ezroom.vn',
            password_hash: '$2b$10$dummyhashfortest123456789',
            phone: '0987654321',
            role: 'TENANT',
            status: 'ACTIVE',
        },
    ],
};

/**
 * Seed users vào database
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{landlords: any[], tenants: any[]}>}
 */
async function seedUsers(prisma) {
    console.log('\n👥 Seeding Users...');

    const landlords = [];
    const tenants = [];

    // Tạo Landlords
    for (const data of usersData.landlords) {
        const user = await prisma.user.upsert({
            where: { email: data.email },
            update: {},
            create: data,
        });
        landlords.push(user);
        console.log(`   ✅ Chủ trọ: ${user.fullName}`);
    }

    // Tạo Tenants
    for (const data of usersData.tenants) {
        const user = await prisma.user.upsert({
            where: { email: data.email },
            update: {},
            create: data,
        });
        tenants.push(user);
        console.log(`   ✅ Người thuê: ${user.fullName}`);
    }

    // Tạo wallet cho landlords
    for (const landlord of landlords) {
        await prisma.wallet.upsert({
            where: { userId: landlord.id },
            update: {},
            create: {
                userId: landlord.id,
                balance: 0,
            },
        });
    }
    console.log(`   ✅ Tạo ví cho ${landlords.length} chủ trọ`);

    return { landlords, tenants };
}

module.exports = { seedUsers, usersData };
