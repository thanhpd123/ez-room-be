const tenantReviewService = require('../services/tenant-review.service');

function handleError(err, res, defaultMessage) {
  const statusCode = err.statusCode || 500;
  const message = err.message || defaultMessage;
  console.error('Tenant review error:', err);
  return res.status(statusCode).json({
    success: false,
    message,
    ...(statusCode === 500 && { error: err.message }),
  });
}

/**
 * Tạo đánh giá tenant
 */
async function createTenantReview(req, res) {
  try {
    console.error('\n========== [Controller] createTenantReview CALLED ==========');
    console.error('user.id:', req.auth?.user?.id);
    console.error('user:', req.auth?.user);
    console.error('body:', JSON.stringify(req.body, null, 2));
    
    const result = await tenantReviewService.createTenantReview(req.auth.user.id, req.body);
    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[Controller] Error caught:', err.message);
    if (err.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã đánh giá tenant này cho lần thuê này rồi',
      });
    }
    return handleError(err, res, 'Lỗi khi gửi đánh giá tenant');
  }
}

/**
 * Lấy đánh giá tenant cho một lần thuê (của người dùng hiện tại)
 */
async function getTenantReviewByRentalPeriod(req, res) {
  try {
    const result = await tenantReviewService.getTenantReviewByRentalPeriod(
      req.auth.user.id,
      req.params.rentalPeriodId
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res, 'Lỗi khi lấy đánh giá tenant');
  }
}

/**
 * Lấy tất cả đánh giá của một tenant (internal, chỉ cho landlord khác xem)
 */
async function getTenantReviews(req, res) {
  try {
    const { tenantId } = req.params;
    const result = await tenantReviewService.getTenantReviews(tenantId, req.auth.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res, 'Lỗi khi lấy danh sách đánh giá tenant');
  }
}

/**
 * Landlord phản hồi đánh giá tenant
 */
async function replyToTenantReview(req, res) {
  try {
    const { reviewId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung phản hồi không được để trống',
      });
    }

    const result = await tenantReviewService.replyToTenantReview(
      req.auth.user.id,
      reviewId,
      content
    );
    return res.json(result);
  } catch (err) {
    return handleError(err, res, 'Lỗi khi phản hồi đánh giá tenant');
  }
}

/**
 * Lấy danh sách đánh giá tenant chờ duyệt (moderator)
 */
async function getPendingReviews(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || 10, 10)));

    const result = await tenantReviewService.getPendingReviews(page, limit);
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res, 'Lỗi khi lấy danh sách đánh giá chờ duyệt');
  }
}

/**
 * Cập nhật trạng thái đánh giá tenant (moderator)
 */
async function updateReviewStatus(req, res) {
  try {
    const { reviewId, action } = req.params;
    const { notes } = req.body;

    if (!['approve', 'reject', 'hide'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action không hợp lệ',
      });
    }

    const result = await tenantReviewService.updateReviewStatus(
      reviewId,
      action,
      req.auth.user.id,
      notes
    );
    return res.json(result);
  } catch (err) {
    return handleError(err, res, 'Lỗi khi cập nhật trạng thái đánh giá');
  }
}

/**
 * Lấy danh sách rental đã hoàn thành của landlord (để đánh giá tenant)
 */
async function getCompletedRentals(req, res) {
  try {
    const rentals = await tenantReviewService.getCompletedRentalsForLandlord(
      req.auth.user.id
    );
    return res.json({
      success: true,
      data: rentals,
    });
  } catch (err) {
    return handleError(err, res, 'Lỗi khi lấy danh sách rental đã hoàn thành');
  }
}

module.exports = {
  createTenantReview,
  getTenantReviewByRentalPeriod,
  getTenantReviews,
  replyToTenantReview,
  getPendingReviews,
  updateReviewStatus,
  getCompletedRentals,
};
