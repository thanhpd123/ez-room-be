const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { register, login } = require('../controllers/auth.controller');

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
 * GET /auth/me
 * Returns the current user from the Supabase JWT.
 * Requires: Authorization: Bearer <access_token>
 */
router.get('/me', requireAuth, (req, res) => {
    const { user } = req.auth;

    res.json({
        success: true,
        user: {
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name ?? user.user_metadata?.name,
            avatar_url: user.user_metadata?.avatar_url,
            created_at: user.created_at,
        },
    });
});


module.exports = router;
