const prisma = require('../config/prisma');

const STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

function toPositiveInt(value, fallback, min = 1, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function slugify(input) {
    return String(input || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

async function ensureUniqueSlug(baseSlug, excludeId) {
    const base = baseSlug || 'post';
    let slug = base;
    let counter = 1;

    while (true) {
        const existing = await prisma.blogPost.findFirst({
            where: {
                slug,
                ...(excludeId ? { NOT: { id: excludeId } } : {}),
            },
            select: { id: true },
        });
        if (!existing) return slug;
        counter += 1;
        slug = `${base}-${counter}`;
    }
}

function normalizeTags(tagNames) {
    if (!Array.isArray(tagNames)) return [];
    const cleaned = tagNames
        .map((t) => String(t || '').trim())
        .filter(Boolean);
    return Array.from(new Set(cleaned));
}

async function resolveCategory(categoryName) {
    if (categoryName === undefined) return null;
    const trimmed = String(categoryName || '').trim();
    if (!trimmed) return null;

    const slug = slugify(trimmed);
    const existing = await prisma.blogCategory.findFirst({
        where: {
            OR: [
                { slug },
                { name: { equals: trimmed, mode: 'insensitive' } },
            ],
        },
    });
    if (existing) return existing;

    return prisma.blogCategory.create({
        data: {
            name: trimmed,
            slug: await ensureUniqueCategorySlug(slug),
        },
    });
}

async function ensureUniqueCategorySlug(baseSlug) {
    const base = baseSlug || 'category';
    let slug = base;
    let counter = 1;

    while (true) {
        const existing = await prisma.blogCategory.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!existing) return slug;
        counter += 1;
        slug = `${base}-${counter}`;
    }
}

async function resolveTags(tagNames) {
    const names = normalizeTags(tagNames);
    if (names.length === 0) return [];

    const tags = [];
    for (const name of names) {
        const slug = slugify(name);
        const existing = await prisma.blogTag.findFirst({
            where: {
                OR: [
                    { slug },
                    { name: { equals: name, mode: 'insensitive' } },
                ],
            },
        });
        if (existing) {
            tags.push(existing);
        } else {
            const created = await prisma.blogTag.create({
                data: {
                    name,
                    slug: await ensureUniqueTagSlug(slug),
                },
            });
            tags.push(created);
        }
    }

    return tags;
}

async function ensureUniqueTagSlug(baseSlug) {
    const base = baseSlug || 'tag';
    let slug = base;
    let counter = 1;

    while (true) {
        const existing = await prisma.blogTag.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!existing) return slug;
        counter += 1;
        slug = `${base}-${counter}`;
    }
}

function mapPost(item) {
    return {
        id: item.id,
        title: item.title,
        slug: item.slug,
        excerpt: item.excerpt,
        content: item.content,
        coverImageUrl: item.coverImageUrl,
        status: item.status,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        author: item.author
            ? {
                id: item.author.id,
                fullName: item.author.fullName,
                email: item.author.email,
                avatarUrl: item.author.avatarUrl,
            }
            : null,
        category: item.category
            ? {
                id: item.category.id,
                name: item.category.name,
                slug: item.category.slug,
            }
            : null,
        tags: Array.isArray(item.tags)
            ? item.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                slug: t.tag.slug,
            }))
            : [],
    };
}

function normalizeStatus(status) {
    if (!status) return null;
    const upper = String(status).toUpperCase();
    return STATUS_VALUES.includes(upper) ? upper : null;
}

function parsePublishedAt(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

async function getPublicBlogPosts(params) {
    const page = toPositiveInt(params?.page, 1, 1, 1000);
    const limit = toPositiveInt(params?.limit, 10, 1, 50);
    const skip = (page - 1) * limit;
    const now = new Date();

    const where = {
        status: 'PUBLISHED',
        publishedAt: { not: null, lte: now },
    };

    if (params?.search) {
        where.OR = [
            { title: { contains: params.search, mode: 'insensitive' } },
            { excerpt: { contains: params.search, mode: 'insensitive' } },
        ];
    }

    if (params?.category) {
        where.category = {
            OR: [
                { slug: params.category },
                { name: { equals: params.category, mode: 'insensitive' } },
            ],
        };
    }

    if (params?.tag) {
        where.tags = {
            some: {
                tag: {
                    OR: [
                        { slug: params.tag },
                        { name: { equals: params.tag, mode: 'insensitive' } },
                    ],
                },
            },
        };
    }

    const [items, total] = await Promise.all([
        prisma.blogPost.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            include: {
                author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
                category: { select: { id: true, name: true, slug: true } },
                tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
        }),
        prisma.blogPost.count({ where }),
    ]);

    return {
        data: items.map(mapPost),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getPublicBlogPostBySlug(slug) {
    if (!slug) {
        throw Object.assign(new Error('Thiếu slug bài viết'), { statusCode: 400 });
    }

    const now = new Date();
    const post = await prisma.blogPost.findFirst({
        where: {
            slug,
            status: 'PUBLISHED',
            publishedAt: { not: null, lte: now },
        },
        include: {
            author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
    });

    if (!post) {
        throw Object.assign(new Error('Không tìm thấy bài viết'), { statusCode: 404 });
    }

    return { data: mapPost(post) };
}

async function getAdminBlogPosts(params) {
    const page = toPositiveInt(params?.page, 1, 1, 1000);
    const limit = toPositiveInt(params?.limit, 10, 1, 50);
    const skip = (page - 1) * limit;
    const where = {};

    const status = normalizeStatus(params?.status);
    if (status) {
        where.status = status;
    }

    if (params?.search) {
        where.OR = [
            { title: { contains: params.search, mode: 'insensitive' } },
            { excerpt: { contains: params.search, mode: 'insensitive' } },
        ];
    }

    const [items, total] = await Promise.all([
        prisma.blogPost.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ updatedAt: 'desc' }],
            include: {
                author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
                category: { select: { id: true, name: true, slug: true } },
                tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
        }),
        prisma.blogPost.count({ where }),
    ]);

    return {
        data: items.map(mapPost),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getAdminBlogPostById(id) {
    const post = await prisma.blogPost.findUnique({
        where: { id },
        include: {
            author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
    });

    if (!post) {
        throw Object.assign(new Error('Không tìm thấy bài viết'), { statusCode: 404 });
    }

    return { data: mapPost(post) };
}

function validatePayload(payload) {
    const title = String(payload?.title || '').trim();
    const content = String(payload?.content || '').trim();
    if (!title) {
        throw Object.assign(new Error('Tiêu đề không được để trống'), { statusCode: 400 });
    }
    if (!content) {
        throw Object.assign(new Error('Nội dung không được để trống'), { statusCode: 400 });
    }
    return { title, content };
}

async function createBlogPost(authorId, payload) {
    if (!authorId) {
        throw Object.assign(new Error('Thiếu thông tin người tạo'), { statusCode: 401 });
    }
    const { title, content } = validatePayload(payload);
    const excerpt = payload?.excerpt ? String(payload.excerpt).trim() : null;
    const coverImageUrl = payload?.coverImageUrl ? String(payload.coverImageUrl).trim() : null;
    const status = normalizeStatus(payload?.status) || 'DRAFT';

    const baseSlug = slugify(payload?.slug || title);
    const slug = await ensureUniqueSlug(baseSlug);

    const category = await resolveCategory(payload?.categoryName);
    const tags = await resolveTags(payload?.tagNames);

    const publishedAt = status === 'PUBLISHED'
        ? parsePublishedAt(payload?.publishedAt) || new Date()
        : null;

    const post = await prisma.blogPost.create({
        data: {
            title,
            slug,
            excerpt,
            content,
            coverImageUrl,
            status,
            publishedAt,
            authorId,
            categoryId: category ? category.id : null,
            tags: tags.length > 0
                ? {
                    createMany: {
                        data: tags.map((tag) => ({ tagId: tag.id })),
                    },
                }
                : undefined,
        },
        include: {
            author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
    });

    return {
        message: 'Đã tạo bài viết',
        data: mapPost(post),
    };
}

async function updateBlogPost(id, payload) {
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy bài viết'), { statusCode: 404 });
    }

    const updateData = {};

    if (payload?.title !== undefined) {
        const title = String(payload.title || '').trim();
        if (!title) {
            throw Object.assign(new Error('Tiêu đề không được để trống'), { statusCode: 400 });
        }
        updateData.title = title;
    }

    if (payload?.content !== undefined) {
        const content = String(payload.content || '').trim();
        if (!content) {
            throw Object.assign(new Error('Nội dung không được để trống'), { statusCode: 400 });
        }
        updateData.content = content;
    }

    if (payload?.excerpt !== undefined) {
        const excerpt = String(payload.excerpt || '').trim();
        updateData.excerpt = excerpt || null;
    }

    if (payload?.coverImageUrl !== undefined) {
        const cover = String(payload.coverImageUrl || '').trim();
        updateData.coverImageUrl = cover || null;
    }

    if (payload?.slug !== undefined) {
        const baseSlug = slugify(payload.slug || updateData.title || existing.title);
        if (!baseSlug) {
            throw Object.assign(new Error('Slug không hợp lệ'), { statusCode: 400 });
        }
        updateData.slug = await ensureUniqueSlug(baseSlug, id);
    }

    if (payload?.status !== undefined) {
        const status = normalizeStatus(payload.status);
        if (!status) {
            throw Object.assign(new Error('Trạng thái không hợp lệ'), { statusCode: 400 });
        }
        updateData.status = status;
        updateData.publishedAt = status === 'PUBLISHED'
            ? parsePublishedAt(payload?.publishedAt) || existing.publishedAt || new Date()
            : null;
    } else if (payload?.publishedAt !== undefined) {
        updateData.publishedAt = parsePublishedAt(payload.publishedAt);
    }

    const category = await resolveCategory(payload?.categoryName);
    if (payload?.categoryName !== undefined) {
        updateData.categoryId = category ? category.id : null;
    }

    const tagNames = payload?.tagNames;
    const tags = await resolveTags(tagNames);

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.blogPost.update({
            where: { id },
            data: updateData,
        });

        if (tagNames !== undefined) {
            await tx.blogPostTag.deleteMany({ where: { postId: id } });
            if (tags.length > 0) {
                await tx.blogPostTag.createMany({
                    data: tags.map((tag) => ({ postId: id, tagId: tag.id })),
                });
            }
        }

        return updated;
    });

    const post = await prisma.blogPost.findUnique({
        where: { id: result.id },
        include: {
            author: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
    });

    return {
        message: 'Đã cập nhật bài viết',
        data: mapPost(post),
    };
}

async function deleteBlogPost(id) {
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy bài viết'), { statusCode: 404 });
    }

    await prisma.blogPost.delete({ where: { id } });

    return { message: 'Đã xóa bài viết' };
}

module.exports = {
    getPublicBlogPosts,
    getPublicBlogPostBySlug,
    getAdminBlogPosts,
    getAdminBlogPostById,
    createBlogPost,
    updateBlogPost,
    deleteBlogPost,
};
