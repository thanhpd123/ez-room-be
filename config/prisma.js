const { PrismaClient } = require('@prisma/client');

/**
 * Single PrismaClient per process. In dev, bind to globalThis so hot reload / odd
 * require graphs do not spawn extra pools (each client holds DB connections).
 *
 * Tune Supabase pooler DATABASE_URL, e.g.:
 *   ?pgbouncer=true&connection_limit=8&pool_timeout=30&connect_timeout=15
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections
 */
function createPrismaClient() {
    return new PrismaClient({
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
