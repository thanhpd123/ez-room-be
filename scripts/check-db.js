/**
 * Test if DATABASE_URL can reach the database.
 * Run: node scripts/check-db.js
 */
require('dotenv').config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL in .env');
  process.exit(1);
}

const match = url.match(/@([^/]+)/);
const host = match ? match[1] : 'unknown';
console.log('Testing connection to:', host);
console.log('');

async function check() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✓ Database is reachable and accepting connections.');
  } catch (err) {
    console.error('✗ Cannot reach database:', err.message || err);
    console.error('');
    console.error('Common causes:');
    console.error('  1. Network blocks DB ports → try phone hotspot; FPT/school Wi‑Fi often blocks 5432/6543');
    console.error('  2. Supabase project paused → Dashboard → Restore project');
    console.error('  3. Wrong host/region → copy URI again from Settings → Database (Transaction pooler)');
    console.error('  4. Try appending to DATABASE_URL: &sslmode=require (after ?pgbouncer=true use &sslmode=require)');
    console.error('  5. Wrong password → reset in Supabase; URL‑encode special chars in the password');
    console.error('  6. Test direct: set DATABASE_URL to DIRECT_URL temporarily (port 5432) from same PC');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

check();
