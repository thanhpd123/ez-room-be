/**
 * 🌱 EZ-Room Database Seeder
 * 
 * File điều phối chính (Nhạc trưởng) - chạy các seed modules theo thứ tự
 * 
 * Cấu trúc:
 * prisma/
 * ├── schema.prisma      # Cấu trúc database
 * ├── seed.js            # File chạy chính (file này)
 * └── seeds/             # Thư mục chứa các kịch bản data riêng lẻ
 *     ├── users.js       # Data tài khoản
 *     ├── locations.js   # Data địa điểm
 *     ├── amenities.js   # Data tiện ích
 *     ├── rentals.js     # Data nhà trọ & phòng
 *     └── index.js       # Export modules
 * 
 * Sử dụng: npm run db:seed
 */

const { PrismaClient } = require('@prisma/client');
const {
    seedUsers,
    seedLocations,
    seedAmenities,
    seedRentals,
} = require('./seeds');

const prisma = new PrismaClient();

async function main() {
    console.log('═'.repeat(50));
    console.log('🌱 EZ-ROOM DATABASE SEEDER');
    console.log('═'.repeat(50));

    // 1. Seed Users (Chủ trọ, Người thuê)
    const { landlords, tenants } = await seedUsers(prisma);

    // 2. Seed Locations (Địa điểm)
    const locations = await seedLocations(prisma);

    // 3. Seed Amenities (Tiện ích)
    const amenities = await seedAmenities(prisma);

    // 4. Seed Rentals & Rooms (Nhà trọ & Phòng)
    const { rentals, rooms } = await seedRentals(prisma, landlords, locations, amenities);

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('🎉 SEED HOÀN TẤT!');
    console.log('═'.repeat(50));
    console.log('📊 Tóm tắt:');
    console.log(`   👤 Chủ trọ (LANDLORD): ${landlords.length}`);
    console.log(`   👥 Người thuê (TENANT): ${tenants.length}`);
    console.log(`   📍 Địa điểm: ${locations.length}`);
    console.log(`   ✨ Tiện ích: ${amenities.length}`);
    console.log(`   🏠 Nhà trọ: ${rentals.length}`);
    console.log(`   🛏️  Phòng trọ: ${rooms.length}`);
    console.log('═'.repeat(50));
}

main()
    .catch((e) => {
        console.error('\n❌ Lỗi seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

