/**
 * Seed data cho Amenities (Tiện ích)
 */

// Data mẫu cho Amenities
const amenitiesData = [
    'WiFi miễn phí',
    'Máy lạnh',
    'Nóng lạnh',
    'Chỗ để xe',
    'Tủ lạnh',
    'Giường',
    'Tủ quần áo',
    'Bàn làm việc',
    'Ban công',
    'Bếp riêng',
    'WC riêng',
    'Thang máy',
    'Bảo vệ 24/7',
    'Camera an ninh',
    'Máy giặt chung',
];

/**
 * Seed amenities vào database
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<any[]>}
 */
async function seedAmenities(prisma) {
    console.log('\n✨ Seeding Amenities...');

    const amenities = [];

    for (const name of amenitiesData) {
        const amenity = await prisma.amenities.upsert({
            where: { name },
            update: {},
            create: { name },
        });
        amenities.push(amenity);
    }

    console.log(`   ✅ ${amenities.length} tiện ích: ${amenitiesData.slice(0, 5).join(', ')}...`);

    return amenities;
}

module.exports = { seedAmenities, amenitiesData };
