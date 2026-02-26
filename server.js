const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const supabase = require('./config/supabase');
const prisma = require('./config/prisma');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware – allow frontend origin for auth (Bearer token)
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
}));
app.use(bodyParser.json());

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
