const prisma = require('../config/prisma');

const TENANT_REVIEW_CONFIG = {
  MIN_RENTAL_DURATION_MS: 1 * 60 * 1000, // 1 minute for testing, adjust as needed
};

/**
 * Tạo đánh giá tenant
 */
async function createTenantReview(landlordId, body) {
  console.log('✅ TENANT REVIEW SERVICE - FRESH CODE LOADED');
  console.log('landlordId:', landlordId);
  console.log('rentalPeriodId:', body.rentalPeriodId);
  
  const {
    rentalPeriodId,
    rating,
    paymentPunctualityRating,
    propertyCareRating,
    communicationRating,
    comment,
  } = body;

  if (!rentalPeriodId) {
    throw Object.assign(new Error('Thiếu rentalPeriodId'), { statusCode: 400 });
  }

  const ratingNum = rating != null ? parseInt(rating, 10) : null;
  if (ratingNum == null || ratingNum < 1 || ratingNum > 5) {
    throw Object.assign(new Error('Đánh giá tổng thể phải từ 1 đến 5 sao'), { statusCode: 400 });
  }

  const commentStr = typeof comment === 'string' ? comment.trim() : '';
  if (!commentStr) {
    throw Object.assign(new Error('Vui lòng nhập nhận xét của bạn'), { statusCode: 400 });
  }

  const parseOptionalRating = (value, fieldLabel) => {
    if (value == null || value === '') return null;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
      throw Object.assign(new Error(`${fieldLabel} phải từ 1 đến 5 sao`), { statusCode: 400 });
    }
    return parsed;
  };

  const paymentPunctualityNum = parseOptionalRating(paymentPunctualityRating, 'Đánh giá đúng hạn thanh toán');
  const propertyCareNum = parseOptionalRating(propertyCareRating, 'Đánh giá giữ gìn tài sản');
  const communicationNum = parseOptionalRating(communicationRating, 'Đánh giá giao tiếp');

  try {
    const rentalPeriod = await prisma.roomRentalPeriod.findUnique({
      where: { id: rentalPeriodId },
      select: {
        id: true,
        userId: true,
        status: true,
        room: {
          select: {
            rental_id: true,
          },
        },
      },
    });

    if (!rentalPeriod) {
      throw Object.assign(new Error('Không tìm thấy kỳ thuê phòng'), { statusCode: 404 });
    }

    if (!['COMPLETED', 'OVERDUE'].includes(rentalPeriod.status)) {
      throw Object.assign(
        new Error('Chỉ có thể đánh giá tenant sau khi kỳ thuê đã COMPLETED hoặc OVERDUE'),
        { statusCode: 400 }
      );
    }

    const ownedRental = await prisma.rental.findFirst({
      where: {
        id: rentalPeriod.room.rental_id,
        owner_id: landlordId,
      },
      select: { id: true },
    });

    if (!ownedRental) {
      throw Object.assign(new Error('Bạn không có quyền đánh giá kỳ thuê này'), {
        statusCode: 403,
      });
    }

    const existedReview = await prisma.tenant_review.findFirst({
      where: {
        reviewer_id: landlordId,
        rental_period_id: rentalPeriodId,
      },
      select: { id: true },
    });

    if (existedReview) {
      throw Object.assign(new Error('Bạn đã đánh giá tenant cho kỳ thuê này rồi'), {
        statusCode: 400,
      });
    }

    const createdReview = await prisma.tenant_review.create({
      data: {
        rental_period_id: rentalPeriodId,
        reviewer_id: landlordId,
        reviewee_id: rentalPeriod.userId,
        rating: ratingNum,
        payment_punctuality_rating: paymentPunctualityNum,
        property_care_rating: propertyCareNum,
        communication_rating: communicationNum,
        comment: commentStr,
        status: 'PENDING',
      },
    });

    return {
      data: {
        id: createdReview.id,
        status: createdReview.status,
        rating: createdReview.rating,
      },
      message: 'Đánh giá của bạn đã được gửi và đang chờ duyệt',
    };
  } catch (err) {
    console.error('Error:', err);
    throw err;
  }
}

/**
 * Lấy đánh giá tenant cho một lần thuê
 */
async function getTenantReviewByRentalPeriod(userId, rentalPeriodId) {
  const rentalPeriod = await prisma.roomRentalPeriod.findUnique({
    where: { id: rentalPeriodId },
    include: { tenantReviews: true },
  });

  if (!rentalPeriod) {
    throw Object.assign(new Error('Không tìm thấy thông tin thuê phòng'), { statusCode: 404 });
  }

  // Reviewer (landlord) can only see their own review
  const review = rentalPeriod.tenantReviews?.find((r) => r.reviewer_id === userId);

  return {
    data: review || null,
  };
}

/**
 * Lấy tất cả đánh giá tenant của một tenant (chỉ dành cho landlord khác hoặc admin)
 */
async function getTenantReviews(revieweeId, requesterId) {
  // Verify requester is a landlord or admin
  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { role: true },
  });

  if (!requester || !['LANDLORD', 'ADMIN', 'MODERATOR'].includes(requester.role)) {
    throw Object.assign(
      new Error('Bạn không có quyền xem đánh giá tenant'),
      { statusCode: 403 }
    );
  }

  const reviews = await prisma.tenant_review.findMany({
    where: {
      reviewee_id: revieweeId,
      status: 'APPROVED', // Only show approved reviews
    },
    include: {
      reviewer: { select: { id: true, fullName: true, avatarUrl: true } },
      room_rental_periods: {
        select: { id: true, startDate: true, endDate: true },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  // Calculate average ratings
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : 0;

  const avgPaymentPunctuality =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.payment_punctuality_rating || 0), 0) /
        reviews.filter((r) => r.payment_punctuality_rating).length || 0
      : 0;

  const avgPropertyCare =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.property_care_rating || 0), 0) /
        reviews.filter((r) => r.property_care_rating).length || 0
      : 0;

  const avgCommunication =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.communication_rating || 0), 0) /
        reviews.filter((r) => r.communication_rating).length || 0
      : 0;

  return {
    data: reviews,
    stats: {
      totalReviews: reviews.length,
      avgRating: Math.round(avgRating * 10) / 10,
      avgPaymentPunctuality: Math.round(avgPaymentPunctuality * 10) / 10,
      avgPropertyCare: Math.round(avgPropertyCare * 10) / 10,
      avgCommunication: Math.round(avgCommunication * 10) / 10,
    },
  };
}

/**
 * Landlord reply to a tenant review
 */
async function replyToTenantReview(landlordId, reviewId, content) {
  const review = await prisma.tenant_review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw Object.assign(new Error('Không tìm thấy đánh giá'), { statusCode: 404 });
  }

  if (review.reviewer_id !== landlordId) {
    throw Object.assign(new Error('Bạn không có quyền phản hồi đánh giá này'), {
      statusCode: 403,
    });
  }

  if (review.status !== 'APPROVED') {
    throw Object.assign(new Error('Bạn chỉ có thể phản hồi đánh giá đã được phê duyệt'), {
      statusCode: 400,
    });
  }

  const replyStr = typeof content === 'string' ? content.trim() : '';
  if (replyStr.length === 0) {
    throw Object.assign(new Error('Nội dung phản hồi không được để trống'), { statusCode: 400 });
  }

  const updated = await prisma.tenant_review.update({
    where: { id: reviewId },
    data: {
      landlord_reply: replyStr,
      replied_at: new Date(),
    },
  });

  return {
    success: true,
    data: updated,
  };
}

/**
 * Get reviews pending moderation
 */
async function getPendingReviews(page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    prisma.tenant_review.findMany({
      where: { status: 'PENDING' },
      include: {
        room_rental_periods: {
          include: {
            room: { include: { rentals: true } },
          },
        },
        reviewer: { select: { id: true, fullName: true } },
        reviewee: { select: { id: true, fullName: true } },
      },
      orderBy: { created_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.tenant_review.count({ where: { status: 'PENDING' } }),
  ]);

  return {
    data: reviews,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Approve/Reject tenant review (moderator action)
 */
async function updateReviewStatus(reviewId, action, moderatorId, notes = '') {
  const review = await prisma.tenant_review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw Object.assign(new Error('Không tìm thấy đánh giá'), { statusCode: 404 });
  }

  const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.tenant_review.update({
      where: { id: reviewId },
      data: {
        status: newStatus,
        reviewed_by: moderatorId,
        reviewed_at: new Date(),
        moderator_note: notes || null,
      },
    });

    // Log moderator action
    await tx.moderator_logs.create({
      data: {
        moderator_id: moderatorId,
        target_type: 'FEEDBACK',
        target_id: reviewId,
        action: action === 'approve' ? 'APPROVE' : 'REJECT',
        previous_status: review.status,
        new_status: newStatus,
        reason: notes,
      },
    });

    return u;
  });

  return {
    success: true,
    data: updated,
  };
}

/**
 * Get completed rentals for a landlord that can be reviewed
 */
async function getCompletedRentalsForLandlord(landlordId) {
  try {
    // Get all completed/overdue rental periods
    const completedRentals = await prisma.roomRentalPeriod.findMany({
      where: {
        status: {
          in: ['COMPLETED', 'OVERDUE'],
        },
      },
      include: {
        room: {
          select: {
            id: true,
            room_name: true,
            rental_id: true,
          },
        },
        tenant: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        endDate: 'desc',
      },
    });

    console.log(`Found ${completedRentals.length} completed rental periods`);

    if (completedRentals.length === 0) {
      return [];
    }

    // Get rental IDs and check ownership
    const rentalIds = [...new Set(completedRentals.map(r => r.room.rental_id))];
    console.log(`Checking ownership for ${rentalIds.length} rentals`);
    
    const landlordRentals = await prisma.rental.findMany({
      where: {
        id: { in: rentalIds },
        owner_id: landlordId,
      },
      select: { id: true },
    });

    console.log(`Landlord owns ${landlordRentals.length} rentals`);

    const landlordRentalIds = new Set(landlordRentals.map(r => r.id));

    // Filter to only include rentals owned by the landlord
    const filteredRentals = completedRentals.filter(
      (rental) => landlordRentalIds.has(rental.room.rental_id)
    );

    console.log(`After filtering: ${filteredRentals.length} rentals for review`);

    // Get review status for each rental period
    const rentalPeriodIds = filteredRentals.map(r => r.id);
    const reviews = await prisma.tenant_review.findMany({
      where: {
        rental_period_id: { in: rentalPeriodIds },
        reviewer_id: landlordId,
      },
      select: {
        rental_period_id: true,
        status: true,
      },
    });

    console.log(`Found ${reviews.length} existing reviews`);

    const reviewMap = new Map(
      reviews.map(r => [r.rental_period_id, r.status])
    );

    // Transform to match frontend interface
    const result = filteredRentals.map((rental) => ({
      id: rental.id,
      rental_period_id: rental.id,
      tenant: {
        id: rental.tenant.id,
        fullName: rental.tenant.fullName,
        avatarUrl: rental.tenant.avatarUrl,
      },
      room: {
        id: rental.room.id,
        room_name: rental.room.room_name,
      },
      startDate: rental.startDate.toISOString(),
      endDate: rental.endDate ? rental.endDate.toISOString() : null,
      hasReview: reviewMap.has(rental.id),
      reviewStatus: reviewMap.get(rental.id),
    }));

    console.log(`Returning ${result.length} rentals for landlord ${landlordId}`);
    return result;
  } catch (err) {
    console.error('Error fetching completed rentals:', err);
    throw Object.assign(new Error('Lỗi khi tải danh sách rental đã hoàn thành'), { statusCode: 500 });
  }
}

module.exports = {
  createTenantReview,
  getTenantReviewByRentalPeriod,
  getTenantReviews,
  replyToTenantReview,
  getPendingReviews,
  updateReviewStatus,
  getCompletedRentalsForLandlord,
};
