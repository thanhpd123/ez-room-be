const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getPublicBlogPosts,
    getPublicBlogPostBySlug,
    getAdminBlogPosts,
    getAdminBlogPostById,
    createBlogPost,
    updateBlogPost,
    deleteBlogPost,
} = require('../controllers/blog.controller');

const router = express.Router();

// Admin blog routes
router.use('/admin', verifyJWT, requireRole('ADMIN'));

/**
 * @openapi
 * /blogs/admin/posts:
 *   get:
 *     tags: [Blog]
 *     summary: Danh sách bài viết (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, PUBLISHED, ARCHIVED] }
 *     responses:
 *       200:
 *         description: Danh sách bài viết
 */
router.get('/admin/posts', getAdminBlogPosts);

/**
 * @openapi
 * /blogs/admin/posts:
 *   post:
 *     tags: [Blog]
 *     summary: Tạo bài viết mới
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title: { type: string }
 *               slug: { type: string }
 *               excerpt: { type: string }
 *               content: { type: string }
 *               coverImageUrl: { type: string }
 *               status: { type: string, enum: [DRAFT, PUBLISHED, ARCHIVED] }
 *               publishedAt: { type: string }
 *               categoryName: { type: string }
 *               tagNames: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Tạo bài viết thành công
 */
router.post('/admin/posts', createBlogPost);

/**
 * @openapi
 * /blogs/admin/posts/{postId}:
 *   get:
 *     tags: [Blog]
 *     summary: Chi tiết bài viết (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết bài viết
 */
router.get('/admin/posts/:postId', getAdminBlogPostById);

/**
 * @openapi
 * /blogs/admin/posts/{postId}:
 *   patch:
 *     tags: [Blog]
 *     summary: Cập nhật bài viết
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               slug: { type: string }
 *               excerpt: { type: string }
 *               content: { type: string }
 *               coverImageUrl: { type: string }
 *               status: { type: string, enum: [DRAFT, PUBLISHED, ARCHIVED] }
 *               publishedAt: { type: string }
 *               categoryName: { type: string }
 *               tagNames: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/admin/posts/:postId', updateBlogPost);

/**
 * @openapi
 * /blogs/admin/posts/{postId}:
 *   delete:
 *     tags: [Blog]
 *     summary: Xóa bài viết
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.delete('/admin/posts/:postId', deleteBlogPost);

// Public blog routes
/**
 * @openapi
 * /blogs:
 *   get:
 *     tags: [Blog]
 *     summary: Danh sách bài viết public
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách bài viết public
 */
router.get('/', getPublicBlogPosts);

/**
 * @openapi
 * /blogs/{slug}:
 *   get:
 *     tags: [Blog]
 *     summary: Chi tiết bài viết public
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết bài viết
 */
router.get('/:slug', getPublicBlogPostBySlug);

module.exports = router;
