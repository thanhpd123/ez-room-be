const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
    const openTasks = await prisma.moderation_queue.findMany({
        where: { status: "OPEN" },
        orderBy: { created_at: "asc" }
    });

    const moderators = await prisma.user.findMany({
        where: { role: "MODERATOR" },
        orderBy: { id: "asc" }
    });

    if (moderators.length === 0 || openTasks.length === 0) {
        console.log("No moderators or open tasks");
        return;
    }

    let lastAssigned = await prisma.moderation_queue.findFirst({
        where: { assigned_to: { not: null } },
        orderBy: { created_at: "desc" }
    });

    let modIndex = 0;
    if (lastAssigned && lastAssigned.assigned_to) {
        const lastIdx = moderators.findIndex(m => m.id === lastAssigned.assigned_to);
        if (lastIdx !== -1) {
            modIndex = (lastIdx + 1) % moderators.length;
        }
    }

    for (const task of openTasks) {
        const nextModId = moderators[modIndex].id;
        await prisma.moderation_queue.update({
            where: { id: task.id },
            data: {
                status: "IN_PROGRESS",
                assigned_to: nextModId,
                assigned_at: new Date()
            }
        });
        console.log("Assigned task", task.id, "to", nextModId);
        modIndex = (modIndex + 1) % moderators.length;
    }
}
run().then(() => prisma.$disconnect());
