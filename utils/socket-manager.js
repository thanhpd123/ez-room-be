/**
 * Socket.io instance registry — avoids circular imports between server.js and services.
 * Call setIo(io) once at server startup, then getIo() anywhere.
 */
let _io = null;

function setIo(io) {
    _io = io;
}

function getIo() {
    return _io;
}

/** In-memory presence map: userId → Set<socketId>. Single-server only. */
const onlineUsers = new Map();

function markOnline(userId, socketId) {
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socketId);
}

function markOffline(userId, socketId) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(userId);
}

function isOnline(userId) {
    return (onlineUsers.get(userId)?.size ?? 0) > 0;
}

function getOnlineUserIds() {
    return [...onlineUsers.keys()];
}

/**
 * Deliver a socket event to all sockets of a specific user.
 * Returns true if the user had at least one connected socket.
 */
function emitToUser(userId, event, data) {
    const io = getIo();
    if (!io) return false;
    const sockets = onlineUsers.get(userId);
    if (!sockets || sockets.size === 0) return false;
    for (const sid of sockets) io.to(sid).emit(event, data);
    return true;
}

module.exports = { setIo, getIo, markOnline, markOffline, isOnline, getOnlineUserIds, emitToUser, onlineUsers };
