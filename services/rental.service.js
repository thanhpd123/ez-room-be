const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const cache = require('../utils/simple-cache');
const { getLabelForDb, ROOM_TYPE_LABELS } = require('../utils/room-type-mapper');
const { validateCreateRental, validateUpdateRentalStatus } = require('../validators/rental.validator');
const { expandCity, expandDistrict } = require('../data/legacy-location-map');
const { publishPendingRoomsWhenRentalAvailable } = require('./sync-rental-rooms-on-approve');

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

function getMonthRange(monthInput) {
    if (!monthInput) return null;

    const monthText = String(monthInput).trim();
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthText);
    if (!match) {
        throw Object.assign(new Error('Tham số month không hợp lệ. Định dạng đúng: YYYY-MM'), {
            statusCode: 400,
        });
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const start = new Date(year, month, 1);
    const endExclusive = new Date(year, month + 1, 1);

    return { start, endExclusive };
}

async function createRental(ownerId, body, files = {}) {
    console.log('CREATE RENTAL - Files received:', {
        imageFiles: files.imageFiles?.length || 0,
        documentFiles: files.documentFiles?.length || 0,
        imageUrls: files.imageUrls?.length || 0,
    });

    const { valid, errors } = validateCreateRental(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { title, description, city, district, address } = body;

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

    // UPLOAD FILES FIRST (outside transaction) to avoid timeout
    const uploadedDocuments = [];

    // Upload document files to Supabase (private bucket)
    // Documents can be PDFs or images (scans of: CCCD, Sổ đỏ, Giấy phép kinh doanh)
    if (files.documentFiles && files.documentFiles.length > 0) {
        console.log(`📤 Uploading ${files.documentFiles.length} document file(s)`);
        for (const docFile of files.documentFiles) {
            try {
                // Sanitize filename: remove special characters, keep only alphanumeric + . - _
                const sanitizedName = docFile.originalname
                    .replace(/[^\w.-]/g, '')  // Remove non-word chars except . - _
                    .substring(0, 200);  // Limit length

                const fileName = `temp/documents/${Date.now()}_${sanitizedName}`;
                console.log('📝 Document upload START:', {
                    originalName: docFile.originalname,
                    sanitizedName,
                    size: docFile.size,
                    mime: docFile.mimetype
                });

                const { data, error: uploadError } = await supabase.storage
                    .from('rental-documents')
                    .upload(fileName, docFile.buffer, {
                        contentType: docFile.mimetype,
                        cacheControl: '0',  // No caching for documents
                    });

                if (uploadError) {
                    console.error('❌ Document upload ERROR:', {
                        fileName,
                        error: uploadError.message,
                        status: uploadError.status,
                    });
                    throw uploadError;  // Fail fast on upload errors
                } else if (data) {
                    console.log('✅ Document upload SUCCESS:', { fileName, path: data.path });
                    uploadedDocuments.push({
                        path: data.path,
                        name: docFile.originalname,  // Keep original name for reference
                    });
                }
            } catch (err) {
                console.error('❌ Document upload EXCEPTION:', {
                    originalFileName: docFile.originalname,
                    error: err.message,
                    stack: err.stack,
                });
                throw err;  // Fail fast
            }
        }
        console.log(`✅ All ${uploadedDocuments.length} documents uploaded successfully`);
    } else {
        console.log('⚠️  No documents to upload');
    }

    // NOW CREATE RENTAL AND SAVE METADATA (short transaction)
    const rental = await prisma.$transaction(
        async (tx) => {
            const created = await tx.rental.create({
                data: {
                    owner_id: ownerId,
                    locationId: location.id,
                    title: title.trim(),
                    description: description ? description.trim() : null,
                    status: 'PENDING',
                },
                include: {
                    location: true,
                    images: true,
                },
            });

            // Save image URLs from Cloudinary (from form.imageUrls)
            // ✅ Only store Cloudinary URLs - images must use public CDN service
            if (files.imageUrls && files.imageUrls.length > 0) {
                console.log(`Saving ${files.imageUrls.length} image URLs for rental ${created.id}`);
                for (const imageUrl of files.imageUrls) {
                    if (imageUrl && imageUrl.trim()) {
                        await tx.RentalImage.create({
                            data: {
                                rentalId: created.id,
                                imageUrl: imageUrl.trim(),
                            },
                        });
                    }
                }
            }

            // Save uploaded document paths to rental_documents table
            for (let i = 0; i < uploadedDocuments.length; i++) {
                const doc = uploadedDocuments[i];
                const VALID_TYPES = ['CCCD', 'SO_DO', 'GPKD', 'HOP_DONG', 'OTHER'];
                const rawType = (files.documentTypes?.[i] ?? 'OTHER').toUpperCase();
                const docType = VALID_TYPES.includes(rawType) ? rawType : 'OTHER';
                await tx.rental_documents.create({
                    data: {
                        rental_id: created.id,
                        document_type: docType,
                        image_url: doc.path,
                        status: 'PENDING',
                    },
                });
            }

            // Add to moderation queue
            const moderatorService = require('./moderator.service');
            await moderatorService.addToModerationQueue(tx, {
                target_type: 'RENTAL',
                target_id: created.id,
                priority: 'NORMAL',
                category: 'NEW_LISTING',
                source: 'SYSTEM',
            });

            return created;
        },
        {
            timeout: 10000, // 10 second timeout (increased from default 5s)
        }
    );

    // Fetch complete rental with images and documents
    const completeRental = await prisma.rental.findUnique({
        where: { id: rental.id },
        include: {
            location: true,
            images: true,
            rental_documents: true,
        },
    });

    return {
        data: {
            id: completeRental.id,
            title: completeRental.title,
            description: completeRental.description,
            status: completeRental.status,
            createdAt: completeRental.createdAt,
            location: completeRental.location
                ? {
                    id: completeRental.location.id,
                    address: completeRental.location.address,
                    district: completeRental.location.district,
                    city: completeRental.location.city,
                }
                : null,
            images: (completeRental.images || []).map((img) => img.image_url),
            documentsCount: (completeRental.rental_documents || []).length,
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
                images: {
                    select: { imageUrl: true },
                    orderBy: { created_at: 'asc' },
                    take: 1,
                },
                _count: {
                    select: { images: true },
                },
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
            imageCount: r._count?.images || 0,
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

    const updatedRental = await prisma.$transaction(async (tx) => {
        const rental = await tx.rental.update({
            where: { id: rentalId },
            data: { status },
            include: { location: true },
        });
        if (status === 'AVAILABLE') {
            await publishPendingRoomsWhenRentalAvailable(rentalId, tx);
        }
        return rental;
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

    /** Only show approved listings on public browse (aligned with /public/search). */
    const where = { status: 'AVAILABLE' };
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
    const fallback = () => Object.values(ROOM_TYPE_LABELS);
    try {
        const cached = cache.get(ROOM_TYPES_CACHE_KEY);
        if (cached) return { data: cached };
        const rows = await prisma.rooms.findMany({
            where: { rentals: { status: 'AVAILABLE' } },
            select: { room_type: true },
            distinct: ['room_type'],
            orderBy: { room_type: 'asc' },
        });
        const data = rows.map((r) => getLabelForDb(r.room_type)).filter(Boolean);
        const result = data.length > 0 ? data : fallback();
        cache.set(ROOM_TYPES_CACHE_KEY, result);
        return { data: result };
    } catch (err) {
        console.error('[getPublicRoomTypes]', err?.message || err);
        return { data: fallback() };
    }
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

async function updateRental(rentalId, userId, body, files = {}) {
    const { title, description, address, district, city, images, status, resubmit, deleted_documents } = body;

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

    // Khi resubmit: cho phép chỉnh sửa bài đăng bị từ chối (HIDDEN) và gửi lại để duyệt
    const isResubmit = resubmit === true && rental.status === 'HIDDEN';

    // Khi edit bài đăng đã duyệt (AVAILABLE/UNAVAILABLE): auto chuyển PENDING để moderator duyệt lại
    const isEditApproved = ['AVAILABLE', 'UNAVAILABLE'].includes(rental.status);

    // Chặn edit khi đang chờ duyệt (PENDING) hoặc bị tạm ngưng/vi phạm
    const blockedStatuses = ['PENDING', 'SUSPEND', 'VIOLATE'];
    if (!isResubmit && blockedStatuses.includes(rental.status)) {
        throw Object.assign(
            new Error('Bài đăng đang chờ duyệt hoặc bị tạm ngưng. Vui lòng đợi moderator xử lý trước khi chỉnh sửa.'),
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

    // UPLOAD DOCUMENTS
    const uploadedDocuments = [];
    if (files.documentFiles && files.documentFiles.length > 0) {
        console.log(`📤 Uploading ${files.documentFiles.length} document file(s) for update`);
        for (const docFile of files.documentFiles) {
            try {
                const sanitizedName = docFile.originalname
                    .replace(/[^\w.-]/g, '')
                    .substring(0, 200);
                const fileName = `temp/documents/${Date.now()}_${sanitizedName}`;

                const { data, error: uploadError } = await supabase.storage
                    .from('rental-documents')
                    .upload(fileName, docFile.buffer, {
                        contentType: docFile.mimetype,
                        cacheControl: '0',
                    });

                if (uploadError) throw uploadError;
                if (data) Object.assign(uploadedDocuments, [...uploadedDocuments, { path: data.path, name: docFile.originalname }]);
            } catch (err) {
                console.error('❌ Document upload error during update:', err.message);
                throw err;
            }
        }
    }

    // Xác định status mới: resubmit hoặc edit bài đã duyệt → PENDING
    const needsModeration = isResubmit || isEditApproved;
    const newStatus = needsModeration ? 'PENDING' : status;

    const result = await prisma.$transaction(
        async (tx) => {
            await tx.rental.update({
                where: { id: rentalId },
                data: {
                    ...(title ? { title: title.trim() } : {}),
                    ...(description !== undefined ? { description: description?.trim() || null } : {}),
                    ...(locationId !== rental.locationId ? { locationId } : {}),
                    ...(newStatus ? { status: newStatus } : {}),
                },
            });

            if (images && Array.isArray(images)) {
                await tx.rentalImage.deleteMany({ where: { rentalId } });
                if (images.length > 0) {
                    await tx.rentalImage.createMany({
                        data: images.map((url) => ({ rentalId, imageUrl: url })),
                    });
                }
            }

            // Delete documents marked for removal
            if (deleted_documents && deleted_documents.length > 0) {
                await tx.rental_documents.deleteMany({
                    where: {
                        id: { in: deleted_documents },
                        rental_id: rentalId
                    }
                });
            }

            // Save uploaded document paths to rental_documents table
            if (uploadedDocuments.length > 0) {
                // Optional: We can delete old documents here if we want to replace them completely. 
                // For now, we append them or maybe the landlord just uploads missing ones.
                // But if it's a completely new submission, we COULD delete old ones.
                // Let's NOT delete so we don't accidentally wipe approved docs if they just upload 1 new thing.
                for (let i = 0; i < uploadedDocuments.length; i++) {
                    const doc = uploadedDocuments[i];
                    const VALID_TYPES = ['CCCD', 'SO_DO', 'GPKD', 'HOP_DONG', 'OTHER'];
                    const rawType = (files.documentTypes?.[i] ?? 'OTHER').toUpperCase();
                    const docType = VALID_TYPES.includes(rawType) ? rawType : 'OTHER';
                    await tx.rental_documents.create({
                        data: {
                            rental_id: rentalId,
                            document_type: docType,
                            image_url: doc.path,
                            status: 'PENDING',
                        },
                    });
                }
            }

            // Resubmit hoặc edit bài đã duyệt: tạo mục mới trong moderation queue
            if (needsModeration) {
                const moderatorService = require('./moderator.service');
                await moderatorService.addToModerationQueue(tx, {
                    target_type: 'RENTAL',
                    target_id: rentalId,
                    priority: 'NORMAL',
                    category: 'NEW_LISTING',
                    source: 'SYSTEM',
                });
            }

            return tx.rental.findUnique({
                where: { id: rentalId },
                include: { location: true, images: true, rental_documents: true },
            });
        },
        { timeout: 10000 }
    );

    const message = isResubmit
        ? 'Đã gửi lại bài đăng để duyệt'
        : needsModeration
            ? 'Đã cập nhật và gửi bài đăng để duyệt lại'
            : 'Cập nhật bài đăng thành công';

    return {
        message,
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
        select: {
            id: true,
            owner_id: true,
            title: true,
            rental_documents: { select: { image_url: true } },
        },
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

    // ✅ Clean up documents from Supabase Storage before deleting from DB
    if (rental.rental_documents && rental.rental_documents.length > 0) {
        console.log(`Deleting ${rental.rental_documents.length} documents from Supabase for rental ${rentalId}`);
        for (const doc of rental.rental_documents) {
            try {
                const { error } = await supabase.storage
                    .from('rental-documents')
                    .remove([doc.image_url]); // image_url contains the full path

                if (error) {
                    console.error(`Failed to delete ${doc.image_url}:`, error);
                } else {
                    console.log(`✅ Deleted: ${doc.image_url}`);
                }
            } catch (err) {
                console.error(`Exception deleting ${doc.image_url}:`, err);
            }
        }
    }

    await prisma.rental.delete({ where: { id: rentalId } });

    return {
        message: 'Xóa bài đăng thành công',
        data: { id: rentalId, title: rental.title },
    };
}

/**
 * Get landlord dashboard statistics
 */
async function getLandlordDashboardStats(landlordId, month) {
    const nearlyAvailableDays = Math.max(1, Number(process.env.NEARLY_AVAILABLE_DAYS || 7));
    const monthRange = getMonthRange(month);
    const rentalCreatedAtFilter = monthRange
        ? { createdAt: { gte: monthRange.start, lt: monthRange.endExclusive } }
        : {};
    const roomCreatedAtFilter = monthRange
        ? { created_at: { gte: monthRange.start, lt: monthRange.endExclusive } }
        : {};
    const feedbackCreatedAtFilter = monthRange
        ? { created_at: { gte: monthRange.start, lt: monthRange.endExclusive } }
        : {};
    const preorderCreatedAtFilter = monthRange
        ? { createdAt: { gte: monthRange.start, lt: monthRange.endExclusive } }
        : {};
    const periodCreatedAtFilter = monthRange
        ? { createdAt: { gte: monthRange.start, lt: monthRange.endExclusive } }
        : {};

    const now = new Date();
    const thresholdDate = new Date(now);
    thresholdDate.setDate(thresholdDate.getDate() + nearlyAvailableDays);

    const [
        totalRentals,
        totalRooms,
        roomsByStatus,
        nearlyAvailableRoomPeriods,
        rentalsByStatus,
        wallet,
        totalFeedback,
        feedbackStats,
        totalPreorders,
        preorderStats,
    ] = await Promise.all([
        // Tổng số nhà trọ
        prisma.rental.count({
            where: {
                owner_id: landlordId,
                ...rentalCreatedAtFilter,
            },
        }),

        // Tổng số phòng trọ
        prisma.rooms.count({
            where: {
                rentals: { owner_id: landlordId },
                ...roomCreatedAtFilter,
            },
        }),

        // Trạng thái phòng trọ
        prisma.rooms.groupBy({
            by: ['status'],
            where: {
                rentals: { owner_id: landlordId },
                ...roomCreatedAtFilter,
            },
            _count: { id: true },
        }),

        // Phòng sắp trống (đang RENTED, có kỳ thuê ACTIVE và endDate trong N ngày tới)
        prisma.roomRentalPeriod.findMany({
            where: {
                status: 'ACTIVE',
                endDate: {
                    gte: now,
                    lte: thresholdDate,
                },
                room: {
                    status: 'RENTED',
                    rentals: {
                        owner_id: landlordId,
                    },
                },
                ...periodCreatedAtFilter,
            },
            select: {
                roomId: true,
            },
        }),

        // Trạng thái nhà trọ
        prisma.rental.groupBy({
            by: ['status'],
            where: {
                owner_id: landlordId,
                ...rentalCreatedAtFilter,
            },
            _count: { id: true },
        }),

        // Ví của landlord
        prisma.wallet.findUnique({
            where: { userId: landlordId },
            select: { balance: true },
        }),

        // Tổng feedback nhận được
        prisma.feedback.count({
            where: {
                target_type: 'ROOM',
                status: 'APPROVED',
                room_rental_periods: { room: { rentals: { owner_id: landlordId } } },
                ...feedbackCreatedAtFilter,
            },
        }),

        // Thống kê feedback (rating trung bình, etc)
        prisma.feedback.aggregate({
            where: {
                target_type: 'ROOM',
                status: 'APPROVED',
                rating: { not: null },
                room_rental_periods: { room: { rentals: { owner_id: landlordId } } },
                ...feedbackCreatedAtFilter,
            },
            _avg: { rating: true },
            _count: { id: true },
        }),

        // Tổng đặt cọc
        prisma.preorder.count({
            where: {
                room: { rentals: { owner_id: landlordId } },
                ...preorderCreatedAtFilter,
            },
        }),

        // Thống kê đặt cọc theo trạng thái
        prisma.preorder.groupBy({
            by: ['status'],
            where: {
                room: { rentals: { owner_id: landlordId } },
                ...preorderCreatedAtFilter,
            },
            _count: { id: true },
        }),
    ]);

    // Format rental status data
    const rentalStatusMap = {
        AVAILABLE: 0,
        UNAVAILABLE: 0,
        HIDDEN: 0,
        PENDING: 0,
        SUSPEND: 0,
        VIOLATE: 0,
    };

    rentalsByStatus.forEach((item) => {
        if (rentalStatusMap.hasOwnProperty(item.status)) {
            rentalStatusMap[item.status] = item._count.id;
        }
    });

    const roomStatusMap = {
        PENDING: 0,
        AVAILABLE: 0,
        RENTED: 0,
        MAINTENANCE: 0,
    };

    roomsByStatus.forEach((item) => {
        if (roomStatusMap.hasOwnProperty(item.status)) {
            roomStatusMap[item.status] = item._count.id;
        }
    });

    roomStatusMap.NEARLY_AVAILABLE = new Set(
        nearlyAvailableRoomPeriods.map((item) => item.roomId)
    ).size;

    // Format preorder status data
    const preorderStatusMap = {
        PENDING: 0,
        CONFIRMED: 0,
        CANCELLED: 0,
        EXPIRED: 0,
    };

    preorderStats.forEach((item) => {
        if (preorderStatusMap.hasOwnProperty(item.status)) {
            preorderStatusMap[item.status] = item._count.id;
        }
    });

    return {
        data: {
            rentals: {
                total: totalRentals,
                byStatus: rentalStatusMap,
            },
            rooms: {
                total: totalRooms,
                byStatus: roomStatusMap,
            },
            wallet: {
                balance: wallet ? Number(wallet.balance) : 0,
            },
            feedback: {
                total: totalFeedback,
                averageRating: feedbackStats._avg.rating ? Number(feedbackStats._avg.rating) : 0,
            },
            preorders: {
                total: totalPreorders,
                byStatus: preorderStatusMap,
            },
        },
    };
}

async function getLandlordPerformanceMetrics(landlordId, month) {
    const monthRange = getMonthRange(month);
    const now = new Date();
    const thisMonthStart = monthRange
        ? monthRange.start
        : new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEndExclusive = monthRange
        ? monthRange.endExclusive
        : new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
        totalRooms,
        activeRoomsThisMonth,
        thisMonthRevenue,
        totalRevenue,
        cancelledPeriods,
        totalPeriods,
        confirmedPreorders,
        totalPreorders,
    ] = await Promise.all([
        // Tổng số phòng
        prisma.rooms.count({
            where: { rentals: { owner_id: landlordId } },
        }),

        // Số phòng có thuê active trong tháng (không trùng room)
        prisma.roomRentalPeriod.findMany({
            where: {
                room: { rentals: { owner_id: landlordId } },
                status: 'ACTIVE',
                startDate: { lt: thisMonthEndExclusive },
                OR: [{ endDate: null }, { endDate: { gte: thisMonthStart } }],
            },
            select: { roomId: true },
            distinct: ['roomId'],
        }),

        // Doanh thu tháng này
        prisma.roomRentalPeriod.aggregate({
            where: {
                room: { rentals: { owner_id: landlordId } },
                createdAt: { gte: thisMonthStart, lt: thisMonthEndExclusive },
            },
            _sum: { actualPrice: true },
        }),

        // Tổng doanh thu
        prisma.roomRentalPeriod.aggregate({
            where: {
                room: { rentals: { owner_id: landlordId } },
            },
            _sum: { actualPrice: true },
        }),

        // Số đơn hủy
        prisma.roomRentalPeriod.count({
            where: {
                room: { rentals: { owner_id: landlordId } },
                status: 'CANCELLED',
                createdAt: { gte: thisMonthStart, lt: thisMonthEndExclusive },
            },
        }),

        // Tổng đơn kết thúc (COMPLETED hoặc CANCELLED)
        prisma.roomRentalPeriod.count({
            where: {
                room: { rentals: { owner_id: landlordId } },
                OR: [
                    { status: 'COMPLETED' },
                    { status: 'CANCELLED' },
                ],
                createdAt: { gte: thisMonthStart, lt: thisMonthEndExclusive },
            },
        }),

        // Đơn đã xác nhận
        prisma.preorder.count({
            where: {
                room: { rentals: { owner_id: landlordId } },
                status: 'CONFIRMED',
                createdAt: { gte: thisMonthStart, lt: thisMonthEndExclusive },
            },
        }),

        // Tổng đơn đặt cọc
        prisma.preorder.count({
            where: {
                room: { rentals: { owner_id: landlordId } },
                NOT: { status: 'PENDING' },
                createdAt: { gte: thisMonthStart, lt: thisMonthEndExclusive },
            },
        }),
    ]);

    // Tính toán metrics
    const occupancyRate = totalRooms > 0 ? (activeRoomsThisMonth.length / totalRooms) * 100 : 0;
    const cancellationRate = totalPeriods > 0 ? (cancelledPeriods / totalPeriods) * 100 : 0;
    const conversionRate = totalPreorders > 0 ? (confirmedPreorders / totalPreorders) * 100 : 0;

    return {
        data: {
            occupancyRate: parseFloat(occupancyRate.toFixed(2)),
            revenue: {
                thisMonth: Number(thisMonthRevenue._sum.actualPrice ?? 0),
                total: Number(totalRevenue._sum.actualPrice ?? 0),
            },
            cancellationRate: parseFloat(cancellationRate.toFixed(2)),
            conversionRate: parseFloat(conversionRate.toFixed(2)),
            bookingStats: {
                active: activeRoomsThisMonth.length,
                cancelled: cancelledPeriods,
                total: totalPeriods,
            },
        },
    };
}

async function getTopSearchedRooms(landlordId, limit = 5) {
    const topRooms = await prisma.rooms.findMany({
        where: {
            rentals: { owner_id: landlordId },
        },
        select: {
            id: true,
            room_name: true,
            price: true,
            search_count: true,
            images: {
                take: 1,
                select: { imageUrl: true },
            },
            rentals: {
                select: {
                    title: true,
                    location: {
                        select: { address: true, district: true, city: true },
                    },
                },
            },
        },
        orderBy: { search_count: 'desc' },
        take: limit,
    });

    return {
        data: {
            rooms: topRooms.map(room => ({
                id: room.id,
                name: room.room_name,
                price: room.price,
                searchCount: room.search_count || 0,
                image: room.images?.[0]?.imageUrl || null,
                rentalTitle: room.rentals?.title,
                location: room.rentals?.location,
            })),
        },
    };
}

async function getRentalDocumentsForModeration(rentalId, moderatorId) {
    // Check if moderator has access (only MODERATOR/ADMIN)
    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: {
            rental_documents: true,
            images: true,
            users: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    phone: true,
                },
            },
        },
    });

    if (!rental) {
        throw Object.assign(new Error('Rental không tìm thấy'), { statusCode: 404 });
    }

    // Generate signed URLs for documents (expires in 1 hour)
    const docsWithUrls = await Promise.all(
        (rental.rental_documents || []).map(async (doc) => {
            try {
                const { data, error } = await supabase.storage
                    .from('rental-documents')
                    .createSignedUrl(doc.image_url, 3600);

                return {
                    id: doc.id,
                    documentType: doc.document_type,
                    status: doc.status,
                    signedUrl: error ? null : data?.signedUrl,
                    uploadedAt: doc.created_at,
                };
            } catch (err) {
                console.error('Error generating signed URL:', err);
                return {
                    id: doc.id,
                    documentType: doc.document_type,
                    status: doc.status,
                    signedUrl: null,
                    uploadedAt: doc.created_at,
                };
            }
        })
    );

    // Generate signed URLs for images
    const imagesWithUrls = await Promise.all(
        (rental.images || []).map(async (img) => {
            try {
                const { data, error } = await supabase.storage
                    .from('rental-documents')
                    .createSignedUrl(img.image_url, 3600);

                return {
                    id: img.id,
                    signedUrl: error ? null : data?.signedUrl,
                    uploadedAt: img.created_at,
                };
            } catch (err) {
                console.error('Error generating signed URL for image:', err);
                return {
                    id: img.id,
                    signedUrl: null,
                    uploadedAt: img.created_at,
                };
            }
        })
    );

    return {
        data: {
            id: rental.id,
            title: rental.title,
            description: rental.description,
            status: rental.status,
            owner: rental.users,
            documents: docsWithUrls,
            images: imagesWithUrls,
        },
    };
}

async function getLandlordRentalDocuments(rentalId, landlordId) {
    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: {
            rental_documents: true,
        },
    });

    if (!rental) {
        throw Object.assign(new Error('Rental không tìm thấy'), { statusCode: 404 });
    }

    if (rental.owner_id !== landlordId) {
        throw Object.assign(new Error('Không có quyền truy cập'), { statusCode: 403 });
    }

    // Generate signed URLs for documents (expires in 1 hour)
    const docsWithUrls = await Promise.all(
        (rental.rental_documents || []).map(async (doc) => {
            try {
                const { data, error } = await supabase.storage
                    .from('rental-documents')
                    .createSignedUrl(doc.image_url, 3600);

                return {
                    id: doc.id,
                    documentType: doc.document_type,
                    status: doc.status,
                    signedUrl: error ? null : data?.signedUrl,
                    uploadedAt: doc.created_at,
                };
            } catch (err) {
                console.error('Error generating signed URL:', err);
                return {
                    id: doc.id,
                    documentType: doc.document_type,
                    status: doc.status,
                    signedUrl: null,
                    uploadedAt: doc.created_at,
                };
            }
        })
    );

    return {
        data: {
            id: rental.id,
            documents: docsWithUrls,
        },
    };
}

module.exports = {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    getRentalDocumentsForModeration,
    getLandlordRentalDocuments,
    updateRentalStatus,
    updateRental,
    deleteRental,
    getRentalStats,
    getPublicRentals,
    getPublicRentalById,
    getPublicRoomTypes,
    getLandlordProfile,
    getLandlordDashboardStats,
    getLandlordPerformanceMetrics,
    getTopSearchedRooms,
};
