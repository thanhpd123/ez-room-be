/**
 * Seed data cho Rentals (Nhà trọ) và Rooms (Phòng trọ)
 */

// Data mẫu cho Rentals
const rentalsData = [
    {
        title: 'Nhà Trọ Hạnh Phúc',
        description: 'Nhà trọ cao cấp, an ninh 24/7, có chỗ để xe, gần trung tâm. Phù hợp sinh viên và nhân viên văn phòng.',
        status: 'AVAILABLE',
        rooms: [
            { room_name: 'Phòng 101', room_type: 'PRIVATE', price: 3500000, size_m2: 20, max_people: 2 },
            { room_name: 'Phòng 102', room_type: 'PRIVATE', price: 4000000, size_m2: 25, max_people: 2 },
            { room_name: 'Phòng 201 - Studio', room_type: 'STUDIO', price: 5500000, size_m2: 35, max_people: 3 },
            { room_name: 'Phòng 202 - Shared', room_type: 'SHARED', price: 2000000, size_m2: 30, max_people: 4 },
        ],
    },
    {
        title: 'Nhà Trọ Ánh Dương',
        description: 'Nhà trọ mới xây, full nội thất, view đẹp. Gần siêu thị, chợ, trường học.',
        status: 'AVAILABLE',
        rooms: [
            { room_name: 'Phòng A1', room_type: 'PRIVATE', price: 3000000, size_m2: 18, max_people: 2 },
            { room_name: 'Phòng A2', room_type: 'PRIVATE', price: 3200000, size_m2: 20, max_people: 2 },
            { room_name: 'Phòng B1 - Studio', room_type: 'STUDIO', price: 4500000, size_m2: 30, max_people: 2 },
        ],
    },
    {
        title: 'Căn Hộ Mini Sunrise',
        description: 'Căn hộ mini cao cấp, đầy đủ tiện nghi, có ban công. Khu vực yên tĩnh, an ninh tốt.',
        status: 'AVAILABLE',
        rooms: [
            { room_name: 'Studio 01', room_type: 'STUDIO', price: 6000000, size_m2: 40, max_people: 2 },
            { room_name: 'Studio 02', room_type: 'STUDIO', price: 6500000, size_m2: 45, max_people: 3 },
            { room_name: 'Apartment 01', room_type: 'APARTMENT', price: 8000000, size_m2: 55, max_people: 4 },
        ],
    },
];

// Ảnh mẫu cho phòng
const sampleImages = [
    'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800',
    'https://images.unsplash.com/photo-1536376072261-38c75010e6c9?w=800',
];

/**
 * Seed rentals và rooms vào database
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {any[]} landlords - Danh sách chủ trọ
 * @param {any[]} locations - Danh sách địa điểm
 * @param {any[]} amenities - Danh sách tiện ích
 * @returns {Promise<{rentals: any[], rooms: any[]}>}
 */
async function seedRentals(prisma, landlords, locations, amenities) {
    console.log('\n🏠 Seeding Rentals & Rooms...');

    const rentals = [];
    const rooms = [];

    for (let i = 0; i < rentalsData.length; i++) {
        const rentalData = rentalsData[i];
        const owner = landlords[i % landlords.length];
        const location = locations[i % locations.length];

        // Check existing rental
        const existingRental = await prisma.rental.findFirst({
            where: { title: rentalData.title },
        });

        let rental;
        if (existingRental) {
            rental = existingRental;
            console.log(`   ⏭️  Đã tồn tại: ${rental.title}`);
        } else {
            rental = await prisma.rental.create({
                data: {
                    owner_id: owner.id,
                    locationId: location.id,
                    title: rentalData.title,
                    description: rentalData.description,
                    status: rentalData.status,
                },
            });
            console.log(`   ✅ Nhà trọ: ${rental.title} | Chủ: ${owner.fullName}`);
        }
        rentals.push(rental);

        // Tạo các phòng cho nhà trọ
        for (const roomData of rentalData.rooms) {
            const existingRoom = await prisma.rooms.findFirst({
                where: {
                    rental_id: rental.id,
                    room_name: roomData.room_name,
                },
            });

            let room;
            if (existingRoom) {
                room = existingRoom;
            } else {
                room = await prisma.rooms.create({
                    data: {
                        rental_id: rental.id,
                        ...roomData,
                    },
                });

                // Gán random tiện ích (3-6 tiện ích)
                const numAmenities = 3 + Math.floor(Math.random() * 4);
                const shuffled = [...amenities].sort(() => 0.5 - Math.random());
                const selectedAmenities = shuffled.slice(0, numAmenities);

                for (const amenity of selectedAmenities) {
                    await prisma.roomAmenity.upsert({
                        where: {
                            roomId_amenityId: {
                                roomId: room.id,
                                amenityId: amenity.id,
                            },
                        },
                        update: {},
                        create: {
                            roomId: room.id,
                            amenityId: amenity.id,
                        },
                    });
                }

                // Thêm 1-2 ảnh mẫu
                const numImages = 1 + Math.floor(Math.random() * 2);
                for (let j = 0; j < numImages; j++) {
                    const imageUrl = sampleImages[(rooms.length + j) % sampleImages.length];
                    await prisma.roomImage.create({
                        data: {
                            roomId: room.id,
                            imageUrl,
                        },
                    });
                }

                console.log(`      🛏️  ${room.room_name} | ${Number(room.price).toLocaleString('vi-VN')} VNĐ | ${numAmenities} tiện ích`);
            }
            rooms.push(room);
        }
    }

    return { rentals, rooms };
}

module.exports = { seedRentals, rentalsData, sampleImages };
