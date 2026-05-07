const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * Single PrismaClient per process. In dev, bind to globalThis so hot reload / odd
 * require graphs do not spawn extra pools (each client holds DB connections).
 */
function createPrismaClient() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    pool.on('error', (err, client) => {
        console.error('Unexpected error on idle pg client', err);
    });

    const adapter = new PrismaPg(pool);

    return new PrismaClient({
        adapter,
        log:
            process.env.NODE_ENV === 'development'
                ? ['error', 'warn']
                : ['error'],
    });
}

const globalForPrisma = globalThis;
const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

let shutdownHookRegistered = false;
function registerDisconnectOnShutdown() {
    if (shutdownHookRegistered) return;
    shutdownHookRegistered = true;

    const disconnect = async () => {
        try {
            await prisma.$disconnect();
        } catch {
            /* ignore */
        }
    };

    process.once('beforeExit', disconnect);
    process.once('SIGINT', () => {
        disconnect().finally(() => process.exit(0));
    });
    process.once('SIGTERM', () => {
        disconnect().finally(() => process.exit(0));
    });
}

registerDisconnectOnShutdown();

module.exports = prisma;
