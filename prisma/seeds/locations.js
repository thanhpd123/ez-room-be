/**
 * Seed data cho Locations (Địa điểm)
 */

// Data mẫu cho Locations
const locationsData = [
    {
        address: '123 Đường Nguyễn Trãi',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
        latitude: 10.7626,
        longitude: 106.6822,
    },
    {
        address: '456 Đường Lê Văn Sỹ',
        district: 'Quận 3',
        city: 'TP. Hồ Chí Minh',
        latitude: 10.7891,
        longitude: 106.6789,
    },
    {
        address: '789 Đường Cách Mạng Tháng 8',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        latitude: 10.7912,
        longitude: 106.6523,
    },
    {
        address: '321 Đường Nguyễn Văn Cừ',
        district: 'Quận 5',
        city: 'TP. Hồ Chí Minh',
        latitude: 10.7589,
        longitude: 106.6701,
    },
];

/**
 * Seed locations vào database
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<any[]>}
 */
async function seedLocations(prisma) {
    console.log('\n📍 Seeding Locations...');

    const locations = [];

    for (const data of locationsData) {
        // Check existing by address
        const existing = await prisma.location.findFirst({
            where: { address: data.address },
        });

        if (existing) {
            locations.push(existing);
            console.log(`   ⏭️  Đã tồn tại: ${data.address}`);
        } else {
            const location = await prisma.location.create({ data });
            locations.push(location);
            console.log(`   ✅ ${data.address}, ${data.district}`);
        }
    }

    return locations;
}

module.exports = { seedLocations, locationsData };
