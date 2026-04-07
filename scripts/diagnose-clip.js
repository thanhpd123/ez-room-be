#!/usr/bin/env node
/**
 * CLI: verify ONNX CLIP + PostgreSQL pgvector + clip_vectors without the HTTP API.
 *
 *   node scripts/diagnose-clip.js
 *
 * Requires DATABASE_URL in .env (same as Prisma).
 */

require('dotenv').config();
const prisma = require('../config/prisma');
const { runClipDiagnostics } = require('../utils/clip-diagnostics');

function parseArgs(argv) {
    const out = { skipDb: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--skip-db' || a === '--skipDb') out.skipDb = true;
    }
    return out;
}

async function main() {
    const { skipDb } = parseArgs(process.argv.slice(2));
    console.log(skipDb ? 'Running CLIP-only diagnostics (skip DB)...\n' : 'Running CLIP / pgvector diagnostics...\n');
    const report = await runClipDiagnostics(prisma, { skipDb });
    console.log(JSON.stringify(report, null, 2));
    if (!report.healthy) {
        console.error('\n--- Status: NOT HEALTHY (see interpret[] above) ---\n');
        process.exitCode = 1;
    } else {
        console.log('\n--- Status: HEALTHY ---\n');
    }
    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('Fatal:', e);
    try {
        await prisma.$disconnect();
    } catch (_) {
        /* ignore */
    }
    process.exit(1);
});
