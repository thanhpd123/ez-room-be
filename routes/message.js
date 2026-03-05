const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getConversations,
    getThread,
    sendMessage,
} = require('../controllers/message.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * GET /messages/conversations – list conversations with last message and unread count.
 */
router.get('/conversations', getConversations);

/**
 * GET /messages/with/:userId – get messages with a user (paginated). ?limit=50&before=ISO_DATE
 */
router.get('/with/:userId', getThread);

/**
 * POST /messages – send message. Body: { receiverId, content }
 */
router.post('/', sendMessage);

module.exports = router;
