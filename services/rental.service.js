const prisma = require('../config/prisma');
const cache = require('../utils/simple-cache');
const { getLabelForDb } = require('../utils/room-type-mapper');
const { validateCreateRental, validateUpdateRentalStatus } = require('../validators/rental.validator');
const { expandCity, expandDistrict } = require('../data/legacy-location-map');

const ROOM_TYPES_CACHE_KEY = 'public:room-types';
const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';

function getPublicRentalsOrderBy(sortParam) {
    const map = {
        createdAt_desc: { createdAt: 'desc' },
        createdAt_asc: { createdAt: 'asc' },
        title_asc: { title: 'asc' },
        title_desc: { title: 'desc' },
    };
    return map[sortParam] || { createdAt: 'desc' };
}

async function createRental(ownerId, body) {
    const { valid, errors } = validateCreateRental(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { title, description, city, district, address, images, documents } = body;

    let location = await prisma.location.findFirst({
        where: {
            address: address.trim(),
            district: district.trim(),
            city: city.trim(),
        },
    });

    if (!location) {
        location = await prisma.location.create({
            data: {
                address: address.trim(),
                district: district.trim(),
                city: city.trim(),
            },
        });
    }

    const rental = await prisma.$transaction(async (tx) => {
        const created = await tx.rental.create({
            data: {
                owner_id: ownerId,
                locationId: location.id,
                title: title.trim(),
                description: description ? description.trim() : null,
                status: 'PENDING',
                ...(images && images.length > 0
                    ? { images: { create: images.map((url) => ({ imageUrl: url })) } }
                    : {}),
                ...(documents && documents.length > 0
                    ? {
                          rental_documents: {
                              create: documents.map((doc) => ({
                                  document_type: doc.documentType,
                                  image_url: doc.imageUrl,
                                  status: 'PENDING',
                              })),
                          },
                      }
                    : {}),
            },
            include: {
                location: true,
                images: true,
                rental_documents: true,
            },
        });
        await tx.moderation_queue.create({
            data: {
                target_type: 'RENTAL',
                target_id: created.id,
                priority: 'NORMAL',
                category: 'NEW_LISTING',
                source: 'SYSTEM',
            },
        });
        return created;
    });

    return {
        data: {
            id: rental.id,
            title: rental.title,
            description: rental.description,
            status: rental.status,
            createdAt: rental.createdAt,
            location: rental.location
                ? {
                      id: rental.location.id,
                      address: rental.location.address,
                      district: rental.location.district,
                      city: rental.location.city,
                  }
                : null,
            images: (rental.images || []).map((img) => img.imageUrl),
        },
    };
}

async function getRentals(params) {
    const { page = 1, limit = 10, status, owner_id, search } = params;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (owner_id) where.owner_id = owner_id;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const [rentals, total] = await Promise.all([
        prisma.rental.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                location: true,
                images: true,
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        }),
        prisma.rental.count({ where }),
    ]);

    return {
        data: rentals.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            createdAt: r.createdAt,
            owner: r.users
                ? {
                      id: r.users.id,
                      fullName: r.users.fullName,
                      avatarUrl: r.users.avatarUrl,
                  }
                : null,
            location: r.location
                ? {
                      id: r.location.id,
                      address: r.location.address,
                      district: r.location.district,
                      city: r.location.city,
                  }
                : null,
            images: (r.images || []).map((img) => img.imageUrl),
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getRentalById(rentalId) {
    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: {
            location: true,
            images: true,
            users: {
                select: {
                    id: true,
                    fullName: true,
                    avatarUrl: true,
                    email: true,
                    phone: true,
                },
            },
            rooms: true,
        },
    });

    if (!rental) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    return {
        data: {
            id: rental.id,
            title: rental.title,
            description: rental.description,
            status: rental.status,
            createdAt: rental.createdAt,
            owner: rental.users
                ? {
                      id: rental.users.id,
                      fullName: rental.users.fullName,
                      avatarUrl: rental.users.avatarUrl,
                      email: rental.users.email,
                      phone: rental.users.phone,
                  }
                : null,
            location: rental.location
                ? {
                      id: rental.location.id,
                      address: rental.location.address,
                      district: rental.location.district,
                      city: rental.location.city,
                  }
                : null,
            rooms: rental.rooms || [],
            images: (rental.images || []).map((img) => img.imageUrl),
        },
    };
}

async function getMyRentals(ownerId, params) {
    const { page = 1, limit = 10, status } = params;
    const skip = (page - 1) * limit;

    const where = { owner_id: ownerId };
    if (status) where.status = status;

    const [rentals, total] = await Promise.all([
        prisma.rental.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                location: true,
                images: true,
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        }),
        prisma.rental.count({ where }),
    ]);

    return {
        data: rentals.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            createdAt: r.createdAt,
            owner: r.users
                ? {
                      id: r.users.id,
                      fullName: r.users.fullName,
                      avatarUrl: r.users.avatarUrl,
                  }
                : null,
            location: r.location
                ? {
                      id: r.location.id,
                      address: r.location.address,
                      district: r.location.district,
                      city: r.location.city,
                  }
                : null,
            images: (r.images || []).map((img) => img.imageUrl),
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getRentalsForModeration(params) {
    const { page = 1, limit = 50, status, search } = params;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const [rentals, total] = await Promise.all([
        prisma.rental.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                location: true,
                images: true,
                rooms: true,
                rental_documents: true,
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        }),
        prisma.rental.count({ where }),
    ]);

    return {
        data: rentals.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            createdAt: r.createdAt,
            owner: r.users
                ? {
                      id: r.users.id,
                      fullName: r.users.fullName,
                      avatarUrl: r.users.avatarUrl,
                      email: r.users.email,
                      phone: r.users.phone,
                  }
                : null,
            location: r.location
                ? {
                      id: r.location.id,
                      address: r.location.address,
                      district: r.location.district,
                      city: r.location.city,
                  }
                : null,
            images: (r.images || []).map((img) => img.imageUrl),
            documents: (r.rental_documents || []).map((doc) => ({
                id: doc.id,
                documentType: doc.document_type,
                imageUrl: doc.image_url,
                status: doc.status,
                note: doc.note,
            })),
            roomsCount: r.rooms ? r.rooms.length : 0,
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function updateRentalStatus(rentalId, body) {
    const { valid, errors } = validateUpdateRentalStatus(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { status } = body;

    const existingRental = await prisma.rental.findUnique({
        where: { id: rentalId },
    });

    if (!existingRental) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    const updatedRental = await prisma.rental.update({
        where: { id: rentalId },
        data: { status },
        include: { location: true },
    });

    return {
        message: `Đã cập nhật trạng thái bài đăng thành ${status}`,
        data: {
            id: updatedRental.id,
            title: updatedRental.title,
            status: updatedRental.status,
            location: updatedRental.location
                ? {
                      id: updatedRental.location.id,
                      address: updatedRental.location.address,
                      district: updatedRental.location.district,
                      city: updatedRental.location.city,
                  }
                : null,
        },
    };
}

async function getRentalStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, available, unavailable, hidden, suspendedOrViolate, thisMonth] = await Promise.all([
        prisma.rental.count(),
        prisma.rental.count({ where: { status: 'AVAILABLE' } }),
        prisma.rental.count({ where: { status: 'UNAVAILABLE' } }),
        prisma.rental.count({ where: { status: 'HIDDEN' } }),
        prisma.rental.count({ where: { status: { in: ['SUSPEND', 'VIOLATE'] } } }),
        prisma.rental.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    return {
        data: {
            total,
            byStatus: {
                available,
                rented: unavailable,
                hidden,
                archived: suspendedOrViolate,
            },
            thisMonth,
        },
    };
}

async function getPublicRentalById(rentalId) {
    let id = rentalId ? String(rentalId).trim() : '';
    if (!id) {
        throw Object.assign(new Error('Thiếu ID nhà trọ'), { statusCode: 400 });
    }
    id = id.toLowerCase();

    let rental = await prisma.rental.findUnique({
        where: { id },
        include: {
            location: true,
            images: true,
            users: {
                select: {
                    id: true,
                    fullName: true,
                    avatarUrl: true,
                    email: true,
                    phone: true,
                },
            },
            rooms: {
                include: {
                    images: true,
                    roomAmenities: { include: { amenity: true } },
                },
            },
        },
    });

    if (!rental) {
        const rawRows = await prisma.$queryRawUnsafe(
            'SELECT id FROM rentals WHERE id::text = $1 LIMIT 1',
            id
        );
        if (rawRows && rawRows.length > 0) {
            const idFromDb = rawRows[0].id;
            const idStr = typeof idFromDb === 'string' ? idFromDb : String(idFromDb);
            rental = await prisma.rental.findUnique({
                where: { id: idStr },
                include: {
                    location: true,
                    images: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                            email: true,
                            phone: true,
                        },
                    },
                    rooms: {
                        include: {
                            images: true,
                            roomAmenities: { include: { amenity: true } },
                        },
                    },
                },
            });
        }
    }

    if (!rental) {
        throw Object.assign(new Error('Không tìm thấy nhà trọ'), { statusCode: 404, rentalId: id });
    }

    const imgs = (rental.images || []).map((img) => img.imageUrl);
    const roomsWithDetails = (rental.rooms || []).map((r) => {
        const roomImgs = (r.images || []).map((img) => img.imageUrl);
        const amenityNames = (r.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);
        return {
            id: r.id,
            rental_id: r.rental_id,
            room_name: r.room_name,
            room_type: r.room_type,
            price: Number(r.price),
            size_m2: r.size_m2 ? Number(r.size_m2) : null,
            max_people: r.max_people,
            images: roomImgs.length > 0 ? roomImgs : [placeholderImage],
            amenities: amenityNames,
        };
    });

    const allAmenityNames = [...new Set(roomsWithDetails.flatMap((r) => r.amenities || []))];

    return {
        data: {
            id: rental.id,
            title: rental.title || '',
            description: rental.description ?? null,
            status: rental.status != null ? String(rental.status) : 'PENDING',
            createdAt: rental.createdAt,
            owner: rental.users
                ? {
                      id: rental.users.id,
                      fullName: rental.users.fullName,
                      avatarUrl: rental.users.avatarUrl,
                      email: rental.users.email,
                      phone: rental.users.phone,
                  }
                : null,
            location: rental.location
                ? {
                      id: rental.location.id,
                      address: rental.location.address,
                      district: rental.location.district,
                      city: rental.location.city,
                  }
                : null,
            rooms: roomsWithDetails,
            amenities: allAmenityNames,
            images: imgs.length > 0 ? imgs : [placeholderImage],
        },
    };
}

async function getPublicRentals(params) {
    const { page = 1, limit = 20, sort, district, city } = params;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 20), 1000);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = getPublicRentalsOrderBy(sort);

    const where = {};
    const districtParam = district && String(district).trim();
    const cityParam = city && String(city).trim();
    if (districtParam || cityParam) {
        const locConditions = [];
        if (districtParam) {
            const districtTerms = expandDistrict(districtParam);
            locConditions.push(
                districtTerms.length === 1
                    ? { district: { equals: districtTerms[0], mode: 'insensitive' } }
                    : {
                          OR: districtTerms.map((t) => ({
                              district: { equals: t, mode: 'insensitive' },
                          })),
                      }
            );
        }
        if (cityParam) {
            const cityTerms = expandCity(cityParam);
            locConditions.push(
                cityTerms.length === 1
                    ? { city: { equals: cityTerms[0], mode: 'insensitive' } }
                    : {
                          OR: cityTerms.map((t) => ({ city: { equals: t, mode: 'insensitive' } })),
                      }
            );
        }
        where.location = {
            is: locConditions.length === 1 ? locConditions[0] : { AND: locConditions },
        };
    }

    const [total, rentals] = await Promise.all([
        prisma.rental.count({ where }),
        prisma.rental.findMany({
            where,
            skip,
            take: limitNum,
            orderBy,
            include: {
                location: true,
                images: true,
            },
        }),
    ]);

    return {
        data: rentals.map((r) => {
            const imgs = (r.images || []).map((img) => img.imageUrl);
            return {
                id: r.id,
                title: r.title,
                description: r.description,
                status: r.status,
                createdAt: r.createdAt,
                location: r.location
                    ? {
                          id: r.location.id,
                          address: r.location.address,
                          district: r.location.district,
                          city: r.location.city,
                      }
                    : null,
                images: imgs.length > 0 ? imgs : [placeholderImage],
            };
        }),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

async function getPublicRoomTypes() {
    const cached = cache.get(ROOM_TYPES_CACHE_KEY);
    if (cached) return { data: cached };
    const rows = await prisma.rooms.findMany({
        where: { rentals: { status: 'AVAILABLE' } },
        select: { room_type: true },
        distinct: ['room_type'],
        orderBy: { room_type: 'asc' },
    });
    const data = rows.map((r) => getLabelForDb(r.room_type)).filter(Boolean);
    cache.set(ROOM_TYPES_CACHE_KEY, data);
    return { data };
}

async function getLandlordProfile(userId) {
    const uid = userId ? String(userId).trim().toLowerCase() : '';
    if (!uid) {
        throw Object.assign(new Error('Thiếu ID chủ nhà'), { statusCode: 400 });
    }

    const user = await prisma.user.findUnique({
        where: { id: uid },
        select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            phone: true,
            createdAt: true,
            role: true,
        },
    });

    if (!user || user.role !== 'LANDLORD') {
        throw Object.assign(new Error('Không tìm thấy chủ nhà'), { statusCode: 404 });
    }

    const [activeRentals, totalRentals] = await Promise.all([
        prisma.rental.findMany({
            where: { owner_id: uid, status: 'AVAILABLE' },
            orderBy: { createdAt: 'desc' },
            include: {
                location: true,
                images: true,
                rooms: {
                    include: {
                        images: true,
                        roomAmenities: { include: { amenity: true } },
                    },
                },
            },
        }),
        prisma.rental.count({ where: { owner_id: uid } }),
    ]);

    const feedbacks = await prisma.feedback.findMany({
        where: { target_type: 'LANDLORD', target_id: uid },
        orderBy: { created_at: 'desc' },
        include: {
            users: {
                select: { id: true, fullName: true, avatarUrl: true },
            },
        },
    });

    const ratings = feedbacks.filter((f) => f.rating != null).map((f) => f.rating);
    const avgRating =
        ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

    const rentalsData = [];
    const roomsData = [];

    for (const r of activeRentals) {
        const rentalImgs = (r.images || []).map((img) => img.imageUrl);

        rentalsData.push({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            createdAt: r.createdAt,
            location: r.location
                ? {
                      address: r.location.address,
                      district: r.location.district,
                      city: r.location.city,
                  }
                : null,
            images: rentalImgs.length > 0 ? rentalImgs : [placeholderImage],
            roomCount: r.rooms ? r.rooms.length : 0,
        });

        for (const room of r.rooms || []) {
            const roomImgs = (room.images || []).map((img) => img.imageUrl);
            const amenityNames = (room.roomAmenities || [])
                .map((ra) => ra.amenity?.name)
                .filter(Boolean);
            roomsData.push({
                id: room.id,
                rentalId: r.id,
                rentalTitle: r.title,
                roomName: room.room_name,
                description: room.description,
                roomType: room.room_type,
                price: Number(room.price),
                sizeM2: room.size_m2 ? Number(room.size_m2) : null,
                maxPeople: room.max_people,
                status: room.status,
                createdAt: room.created_at,
                location: r.location
                    ? {
                          address: r.location.address,
                          district: r.location.district,
                          city: r.location.city,
                      }
                    : null,
                images:
                    roomImgs.length > 0
                        ? roomImgs
                        : rentalImgs.length > 0
                          ? rentalImgs
                          : [placeholderImage],
                amenities: amenityNames,
            });
        }
    }

    const totalRooms = roomsData.length;
    const availableRooms = roomsData.filter((rm) => rm.status === 'AVAILABLE').length;

    return {
        data: {
            user: {
                id: user.id,
                fullName: user.fullName,
                avatarUrl: user.avatarUrl,
                phone: user.phone,
                createdAt: user.createdAt,
            },
            stats: {
                totalRentals,
                activeRentals: activeRentals.length,
                totalRooms,
                availableRooms,
                totalReviews: feedbacks.length,
                avgRating,
            },
            rentals: rentalsData,
            rooms: roomsData,
            reviews: feedbacks.map((f) => ({
                id: f.id,
                rating: f.rating,
                comment: f.comment,
                createdAt: f.created_at,
                reviewer: f.users
                    ? {
                          id: f.users.id,
                          fullName: f.users.fullName,
                          avatarUrl: f.users.avatarUrl,
                      }
                    : null,
            })),
        },
    };
}

async function updateRental(rentalId, userId, body) {
    const { title, description, address, district, city, images, status } = body;

    const allowedStatuses = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN'];
    if (status && !allowedStatuses.includes(status)) {
        throw Object.assign(new Error('Trạng thái không hợp lệ'), { statusCode: 400 });
    }

    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        select: { id: true, owner_id: true, locationId: true, status: true },
    });

    if (!rental) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    if (rental.owner_id !== userId) {
        throw Object.assign(new Error('Bạn không có quyền chỉnh sửa bài đăng này'), { statusCode: 403 });
    }

    const moderatorOnlyStatuses = ['PENDING', 'SUSPEND', 'VIOLATE'];
    if (status && moderatorOnlyStatuses.includes(rental.status)) {
        throw Object.assign(
            new Error('Bài đăng đang chờ duyệt hoặc bị tạm ngưng, bạn không thể thay đổi trạng thái'),
            { statusCode: 403 }
        );
    }

    let locationId = rental.locationId;
    if (address || district || city) {
        const locationData = {};
        if (address) locationData.address = address.trim();
        if (district) locationData.district = district.trim();
        if (city) locationData.city = city.trim();

        if (locationId) {
            await prisma.location.update({
                where: { id: locationId },
                data: locationData,
            });
        } else {
            const newLocation = await prisma.location.create({
                data: {
                    address: address?.trim() || '',
                    district: district?.trim() || null,
                    city: city?.trim() || null,
                },
            });
            locationId = newLocation.id;
        }
    }

    await prisma.rental.update({
        where: { id: rentalId },
        data: {
            ...(title ? { title: title.trim() } : {}),
            ...(description !== undefined ? { description: description?.trim() || null } : {}),
            ...(locationId !== rental.locationId ? { locationId } : {}),
            ...(status ? { status } : {}),
        },
    });

    if (images && Array.isArray(images)) {
        await prisma.rentalImage.deleteMany({ where: { rentalId } });
        if (images.length > 0) {
            await prisma.rentalImage.createMany({
                data: images.map((url) => ({ rentalId, imageUrl: url })),
            });
        }
    }

    const result = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: { location: true, images: true },
    });

    return {
        message: 'Cập nhật bài đăng thành công',
        data: {
            id: result.id,
            title: result.title,
            description: result.description,
            status: result.status,
            createdAt: result.createdAt,
            location: result.location
                ? {
                      id: result.location.id,
                      address: result.location.address,
                      district: result.location.district,
                      city: result.location.city,
                  }
                : null,
            images: (result.images || []).map((img) => img.imageUrl),
        },
    };
}

async function deleteRental(rentalId, userId) {
    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        select: { id: true, owner_id: true, title: true },
    });

    if (!rental) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    if (rental.owner_id !== userId) {
        throw Object.assign(new Error('Bạn không có quyền xóa bài đăng này'), { statusCode: 403 });
    }

    const activePreorders = await prisma.preorder.count({
        where: {
            room: { rental_id: rentalId },
            status: { in: ['PENDING', 'CONFIRMED'] },
        },
    });

    if (activePreorders > 0) {
        throw Object.assign(
            new Error('Không thể xóa bài đăng vì có đơn đặt cọc đang hoạt động'),
            { statusCode: 400 }
        );
    }

    await prisma.rental.delete({ where: { id: rentalId } });

    return {
        message: 'Xóa bài đăng thành công',
        data: { id: rentalId, title: rental.title },
    };
}

module.exports = {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    updateRentalStatus,
    updateRental,
    deleteRental,
    getRentalStats,
    getPublicRentals,
    getPublicRentalById,
    getPublicRoomTypes,
    getLandlordProfile,
};
