const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const supabase = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'EZ-Room API is running!' });
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
