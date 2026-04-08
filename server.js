const http = require('http');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { Server: SocketServer } = require('socket.io');
require('dotenv').config();

const swaggerSpec = require('./config/swagger');
const supabase = require('./config/supabase');
const { isSupabaseConfigured } = require('./config/supabase-helpers');
const prisma = require('./config/prisma');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const amenitiesRoutes = require('./routes/amenities');
const locationsRoutes = require('./routes/locations');
const rentalRoutes = require('./routes/rental');
const roomRoutes = require('./routes/room');
const publicRoutes = require('./routes/public');
const blogRoutes = require('./routes/blog');
const searchRoutes = require('./routes/search');
const favoriteRoutes = require('./routes/favorite');
const roommateRoutes = require('./routes/roommate');
const messageRoutes = require('./routes/message');
const walletRoutes = require('./routes/wallet');
const verificationRoutes = require('./routes/verification');
const moderatorRoutes = require('./routes/moderator');
const reportRoutes = require('./routes/report');
const preorderRoutes = require('./routes/preorder');
const feedbackRoutes = require('./routes/feedback');
const interactionRoutes = require('./routes/interactions');
const documentRoutes = require('./routes/document');
const vipRoutes = require('./routes/vip');
const notificationRoutes = require('./routes/notification');
const translateRoutes = require('./routes/translate');
const { startPreorderPayoutReconciliationJob } = require('./services/preorder-reconciliation.service');
const { startStaleCron } = require('./cron/release-stale-tasks');
const { setIo, markOnline, markOffline, emitToUser, getOnlineUserIds, isOnline } = require('./utils/socket-manager');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware – allow frontend origin for auth (Bearer token)
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
];
const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : allowedOrigins;
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || corsOrigin.includes(origin)) cb(null, true);
        else cb(null, false);
    },
    credentials: true,
}));

// ── Socket.io setup ──────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
});
setIo(io);

// Auth: same resolution as REST verifyJWT (backend JWT or Supabase session token)
const { resolveUserIdFromBearerToken } = require('./middleware/auth');
io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
        const userId = await resolveUserIdFromBearerToken(token);
        if (!userId) return next(new Error('Unauthorized'));
        socket.userId = userId;
        next();
    } catch {
        return next(new Error('Unauthorized'));
    }
});

io.on('connection', (socket) => {
    const userId = socket.userId;
    markOnline(userId, socket.id);

    // Tell this socket which users are currently online
    socket.emit('online_users', getOnlineUserIds());

    // Tell everyone else this user came online
    socket.broadcast.emit('presence', { userId, online: true });

    // Typing indicators — only if the users have an existing message thread (either direction).
    socket.on('typing', async ({ toUserId }) => {
        if (!toUserId || String(toUserId) === String(userId)) return;
        try {
            const pair = await prisma.message.findFirst({
                where: {
                    OR: [
                        { senderId: userId, receiverId: toUserId },
                        { senderId: toUserId, receiverId: userId },
                    ],
                },
                select: { id: true },
            });
            if (!pair) return;
            emitToUser(toUserId, 'typing', { fromUserId: userId });
        } catch {
            /* ignore */
        }
    });
    socket.on('stop_typing', async ({ toUserId }) => {
        if (!toUserId || String(toUserId) === String(userId)) return;
        try {
            const pair = await prisma.message.findFirst({
                where: {
                    OR: [
                        { senderId: userId, receiverId: toUserId },
                        { senderId: toUserId, receiverId: userId },
                    ],
                },
                select: { id: true },
            });
            if (!pair) return;
            emitToUser(toUserId, 'stop_typing', { fromUserId: userId });
        } catch {
            /* ignore */
        }
    });

    socket.on('disconnect', () => {
        markOffline(userId, socket.id);
        if (!isOnline(userId)) {
            socket.broadcast.emit('presence', { userId, online: false });
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────

// Routes - Rental routes MUST come BEFORE global JSON parser to allow multer to handle multipart
app.use('/rentals', rentalRoutes);

// Increase body size limit for file uploads in FormData
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'EZ-Room API Docs',
}));
app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

// Routes - All other routes after JSON parser
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/upload', uploadRoutes);
app.use('/amenities', amenitiesRoutes);
app.use('/locations', locationsRoutes);
app.use('/rooms', roomRoutes);
app.use('/public', publicRoutes);
app.use('/blogs', blogRoutes);
app.use('/search', searchRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/roommate', roommateRoutes);
app.use('/messages', messageRoutes);
app.use('/wallet', walletRoutes);
app.use('/verifications', verificationRoutes);
app.use('/moderator', moderatorRoutes);
app.use('/reports', reportRoutes);
app.use('/preorders', preorderRoutes);
app.use('/feedback', feedbackRoutes);
app.use('/interactions', interactionRoutes);
app.use('/documents', documentRoutes);
app.use('/vip', vipRoutes);
app.use('/notifications', notificationRoutes);
app.use('/translate', translateRoutes);

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'EZ-Room API is running!' });
});

// Dev-only DB diagnostics (enable in production with ENABLE_API_DIAGNOSTICS=true)
const allowApiDiagnostics =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DIAGNOSTICS === 'true';

if (allowApiDiagnostics) {
    app.get('/test-prisma', async (req, res) => {
        try {
            await prisma.$connect();
            const count = await prisma.user.count();
            res.json({
                success: true,
                message: 'Prisma connected successfully!',
                usersCount: count,
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                message: 'Prisma connection or query failed (run db:migrate or db:push?)',
                error: err.message,
            });
        }
    });

    app.get('/test-db', async (req, res) => {
        try {
            if (!isSupabaseConfigured() || !supabase) {
                return res.status(503).json({
                    success: false,
                    message: 'Supabase chưa cấu hình. Thêm SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY vào .env',
                });
            }
            const { data, error } = await supabase.from('users').select('*').limit(1);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Supabase connection failed',
                    error: error.message,
                });
            }

            res.json({
                success: true,
                message: 'Supabase connected successfully!',
                data,
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                message: 'Error connecting to Supabase',
                error: err.message,
            });
        }
    });
}

// Error handler (e.g. multer fileFilter, Cloudinary errors)
app.use((err, req, res, next) => {
    console.error(err);
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
        success: false,
        message: err.message || 'Server error',
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startPreorderPayoutReconciliationJob();
    startStaleCron();

    // Pre-load AI models in background (non-blocking)
    const { preloadEmbedding } = require('./utils/embedding');
    const { preloadCLIP } = require('./utils/clip');
    preloadEmbedding().then((ok) => {
        if (ok) console.log('[Embedding] Model ready for smart search');
    });
    preloadCLIP().then((ok) => {
        if (ok) console.log('[CLIP] Model ready for image search');
    });
});
