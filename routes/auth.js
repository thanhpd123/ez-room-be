const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { register, registerOAuth, login, forgotPassword, resetPassword, updateProfile, getLifestyle, upsertLifestyle, getPreference, upsertPreference } = require('../controllers/auth.controller');

const router = express.Router();

/**
 * POST /auth/register
 * Body: { fullName, email, phone?, password, confirmPassword }
 */
router.post('/register', register);

/**
 * POST /auth/login
 * Body: { email, password }
 */
router.post('/login', login);

/**
 * POST /auth/forgot-password
 * Body: { email }
 */
router.post('/forgot-password', forgotPassword);

/**
 * POST /auth/reset-password
 * Body: { token, newPassword, confirmPassword }
 */
router.post('/reset-password', resetPassword);

/**
 * POST /auth/register-oauth
 * Body: { email, fullName, phone?, role: 'TENANT'|'LANDLORD' }
 */
router.post('/register-oauth', registerOAuth);

/**
 * PATCH /auth/profile – Body: { fullName?, phone?, avatarUrl? }
 */
router.patch('/profile', requireAuth, updateProfile);

router.get('/lifestyle', requireAuth, getLifestyle);
router.put('/lifestyle', requireAuth, upsertLifestyle);
router.get('/preference', requireAuth, getPreference);
router.put('/preference', requireAuth, upsertPreference);

/**
 * GET /auth/me
 * Returns the current user (Supabase or backend JWT).
 * Requires: Authorization: Bearer <access_token>
 */
router.get('/me', requireAuth, (req, res) => {
    const { user } = req.auth;
    res.json({
        success: true,
        user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            avatar_url: user.avatar_url,
            created_at: user.created_at,
            role: user.role,
            phone: user.phone ?? null,
        },
    });
});


module.exports = router;
