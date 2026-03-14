const { PayOS } = require('@payos/node');

let payosClient = null;

function getPayOSClient() {
    if (payosClient) return payosClient;

    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

    if (!clientId || !apiKey || !checksumKey) {
        throw Object.assign(
            new Error('Thiếu cấu hình PayOS (PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY)'),
            { statusCode: 500 }
        );
    }

    payosClient = new PayOS({
        clientId,
        apiKey,
        checksumKey,
    });

    return payosClient;
}

module.exports = {
    getPayOSClient,
};
