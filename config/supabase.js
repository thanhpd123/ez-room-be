const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
if (supabaseUrl && supabaseKey) {
    client = createClient(supabaseUrl, supabaseKey);
}

module.exports = client;
