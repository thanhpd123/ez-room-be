const blogService = require('../services/blog.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Blog error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getPublicBlogPosts(req, res) {
    try {
        const result = await blogService.getPublicBlogPosts({
            page: req.query.page,
            limit: req.query.limit,
            search: req.query.search,
            category: req.query.category,
            tag: req.query.tag,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài viết');
    }
}

async function getPublicBlogPostBySlug(req, res) {
    try {
        const result = await blogService.getPublicBlogPostBySlug(req.params.slug);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy bài viết');
    }
}

async function getAdminBlogPosts(req, res) {
    try {
        const result = await blogService.getAdminBlogPosts({
            page: req.query.page,
            limit: req.query.limit,
            search: req.query.search,
            status: req.query.status,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài viết (admin)');
    }
}

async function getAdminBlogPostById(req, res) {
    try {
        const result = await blogService.getAdminBlogPostById(req.params.postId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy bài viết (admin)');
    }
}

async function createBlogPost(req, res) {
    try {
        const result = await blogService.createBlogPost(req.auth.user.id, req.body);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo bài viết');
    }
}

async function updateBlogPost(req, res) {
    try {
        const result = await blogService.updateBlogPost(req.params.postId, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật bài viết');
    }
}

async function deleteBlogPost(req, res) {
    try {
        const result = await blogService.deleteBlogPost(req.params.postId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa bài viết');
    }
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
