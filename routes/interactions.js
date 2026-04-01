const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { createInteraction } = require('../controllers/interaction.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * POST /interactions
 * Body: { roomId: string, interactionType?: 'view' | 'favorite' | 'contact_landlord' | 'share' }
 */
router.post('/', createInteraction);

module.exports = router;
