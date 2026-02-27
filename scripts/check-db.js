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
    console.error('  1. Project paused → Supabase Dashboard → your project → click "Restore"');
    console.error('  2. Port 5432 blocked → use pooler URL (port 6543) in DATABASE_URL');
    console.error('  3. Wrong password → Project Settings → Database → reset if needed');
    console.error('  4. Firewall/VPN blocking Supabase');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

check();
