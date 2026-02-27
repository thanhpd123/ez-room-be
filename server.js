const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const supabase = require('./config/supabase');
const prisma = require('./config/prisma');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const amenitiesRoutes = require('./routes/amenities');
const locationsRoutes = require('./routes/locations');
const rentalRoutes = require('./routes/rental');
const roomRoutes = require('./routes/room');

const app = express();
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
        else cb(null, corsOrigin[0]);
    },
    credentials: true,
}));
app.use(bodyParser.json());

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/upload', uploadRoutes);
app.use('/amenities', amenitiesRoutes);
app.use('/locations', locationsRoutes);
app.use('/rentals', rentalRoutes);
app.use('/rooms', roomRoutes);

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'EZ-Room API is running!' });
});

// Test Prisma connection (requires DATABASE_URL and migrated DB)
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

// Test Supabase connection
app.get('/test-db', async (req, res) => {
    try {
        // Try to query any table or just check connection
        const { data, error } = await supabase.from('users').select('*').limit(1);

        if (error) {
            return res.status(500).json({
                success: false,
                message: 'Supabase connection failed',
                error: error.message
            });
        }

        res.json({
            success: true,
            message: 'Supabase connected successfully!',
            data
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Error connecting to Supabase',
            error: err.message
        });
    }
});

// Error handler (e.g. multer fileFilter, Cloudinary errors)
app.use((err, req, res, next) => {
    console.error(err);
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
        success: false,
        message: err.message || 'Server error',
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
