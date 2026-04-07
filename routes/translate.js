const express = require('express');
const { translate, translateCacheStats } = require('../controllers/translate.controller');

const router = express.Router();

// Public endpoint — no auth needed for translation
router.post('/', translate);
router.get('/cache-stats', translateCacheStats);

module.exports = router;
