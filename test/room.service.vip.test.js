const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadService() {
    clearModule('../services/room.service');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/simple-cache', {
        get: () => null,
        set: () => { },
        invalidate: () => { },
    });
    injectMock('../config/feedback.config', {});
    injectMock('../utils/room-type-mapper', {
        mapFeToDb: (v) => v || 'single',
        mapDbToFe: (v) => v || 'single',
    });
    injectMock('../utils/email', { sendEmail: async () => { } });
    return require('../services/room.service');
}

const body = {
    rentalId: 'rental-1',
    roomName: 'Phòng test',
    roomType: 'single',
    price: 3000000,
    sizeM2: 20,
    maxPeople: 2,
    images: ['https://example.com/1.jpg'],
    amenityIds: ['am-1'],
};

describe('Room service > VIP landlord policies', () => {
    beforeEach(() => {
        mockPrisma.rental.findUnique = async () => ({ id: 'rental-1', owner_id: 'landlord-1' });
        mockPrisma.rooms.count = async () => 0;
        mockPrisma.rooms.create = async ({ data }) => ({
            id: 'room-1',
            rental_id: data.rental_id,
            room_name: data.room_name,
            description: data.description || null,
            room_type: data.room_type,
            price: data.price,
            size_m2: data.size_m2,
            max_people: data.max_people,
            status: 'PENDING',
            created_at: new Date(),
            images: [{ imageUrl: 'https://example.com/1.jpg' }],
            roomAmenities: [{ amenity: { id: 'am-1', name: 'WiFi' } }],
        });

        let moderationPriority = 'NORMAL';
        mockPrisma.moderation_queue = {
            create: async ({ data }) => {
                moderationPriority = data.priority;
                return { id: 'mq-1', ...data };
            },
            __getPriority: () => moderationPriority,
        };

        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
    });

    it('should block free-tier landlord when room quota is reached', async () => {
        mockPrisma.rooms.count = async () => 5;
        const roomService = loadService();

        await assert.rejects(
            () => roomService.createRoom('landlord-1', body, { id: 'landlord-1', role: 'LANDLORD', isVip: false }),
            (err) => err.statusCode === 403 && err.code === 'FREE_TIER_ROOM_LIMIT_REACHED'
        );
    });

    it('should allow VIP landlord over free-tier quota and use HIGH moderation priority', async () => {
        mockPrisma.rooms.count = async () => 99;
        const roomService = loadService();

        const result = await roomService.createRoom('landlord-1', body, {
            id: 'landlord-1',
            role: 'LANDLORD',
            isVip: true,
        });

        assert.equal(result.message, 'Tạo phòng thành công');
        assert.equal(mockPrisma.moderation_queue.__getPriority(), 'HIGH');
    });
});