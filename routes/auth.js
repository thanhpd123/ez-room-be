const express = require('express');
const { verifyJWT } = require('../middleware/auth');
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
 * Returns the current user from JWT token.
 * Requires: Authorization: Bearer <token>
 */
router.get('/me', verifyJWT, (req, res) => {
    res.json({
        success: true,
        user: req.user, // { userId, email, role }
    });
});


module.exports = router;
