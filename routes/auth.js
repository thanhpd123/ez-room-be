const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { register, registerOAuth, login, forgotPassword, resetPassword, updateProfile, getLifestyle, upsertLifestyle, getPreference, upsertPreference, suggestPassword } = require('../controllers/auth.controller');

const router = express.Router();

/**
 * GET /auth/suggest-password
 * Returns a suggested strong password (8+ chars, upper, number, special).
 */
router.get('/suggest-password', suggestPassword);

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
router.patch('/profile', verifyJWT, updateProfile);

router.get('/lifestyle', verifyJWT, getLifestyle);
router.put('/lifestyle', verifyJWT, upsertLifestyle);
router.get('/preference', verifyJWT, getPreference);
router.put('/preference', verifyJWT, upsertPreference);

/**
 * GET /auth/me
 * Returns the current user (Supabase OAuth or Backend JWT).
 * Requires: Authorization: Bearer <token>
 */
router.get('/me', verifyJWT, (req, res) => {
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
