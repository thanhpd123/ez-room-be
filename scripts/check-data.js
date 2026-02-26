const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log('📊 Kiểm tra dữ liệu trong database:\n');

    // Count users
    const userCount = await prisma.user.count();
    const landlords = await prisma.user.findMany({ where: { role: 'LANDLORD' } });
    const tenants = await prisma.user.findMany({ where: { role: 'TENANT' } });

    console.log(`👥 Users: ${userCount} (${landlords.length} chủ trọ, ${tenants.length} người thuê)`);

    for (const u of [...landlords, ...tenants]) {
        console.log(`   - ${u.fullName} | ${u.email} | ${u.role}`);
    }

    // Locations
    const locations = await prisma.location.findMany();
    console.log(`\n📍 Locations: ${locations.length}`);
    for (const loc of locations) {
        console.log(`   - ${loc.address}, ${loc.district}, ${loc.city}`);
    }

    // Rentals
    const rentals = await prisma.rental.findMany({
        include: {
            users: { select: { fullName: true } },
            location: true,
        },
    });
    console.log(`\n🏠 Nhà trọ: ${rentals.length}`);
    for (const r of rentals) {
        console.log(`   - ${r.title} | Chủ: ${r.users.fullName}`);
        console.log(`     📍 ${r.location?.address}, ${r.location?.district}`);
    }

    // Rooms
    const rooms = await prisma.rooms.findMany({
        include: {
            rentals: { select: { title: true } },
            roomAmenities: { include: { amenity: true } },
            images: true,
        },
    });
    console.log(`\n🛏️  Phòng trọ: ${rooms.length}`);
    for (const room of rooms) {
        const amenityNames = room.roomAmenities.map(ra => ra.amenity.name).join(', ');
        console.log(`   - ${room.room_name} | ${room.room_type} | ${Number(room.price).toLocaleString('vi-VN')} VNĐ | ${room.size_m2}m²`);
        console.log(`     Nhà trọ: ${room.rentals.title}`);
        if (amenityNames) console.log(`     Tiện ích: ${amenityNames}`);
        if (room.images.length > 0) console.log(`     Ảnh: ${room.images.length} ảnh`);
    }

    // Amenities
    const amenities = await prisma.amenities.findMany();
    console.log(`\n✨ Tiện ích: ${amenities.length}`);
    console.log(`   ${amenities.map(a => a.name).join(', ')}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
