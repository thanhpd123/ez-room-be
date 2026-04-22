const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
    normalizeWeights,
    calculateLifestyleMatch,
    LIFESTYLE_WEIGHTS,
} = require('../services/roommate.service');

describe('WeightsPriorityPanel → normalizeWeights → calculateLifestyleMatch Integration', () => {
    describe('normalizeWeights', () => {
        it('should return null when no weights provided', () => {
            assert.strictEqual(normalizeWeights(null), null);
            assert.strictEqual(normalizeWeights(undefined), null);
            assert.strictEqual(normalizeWeights({}), null);
        });

        it('should return null when all weights are default (1)', () => {
            const input = {
                smoking: 1,
                sleep_schedule: 1,
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
                interests: 1,
                cleanliness: 1,
            };
            assert.strictEqual(normalizeWeights(input), null);
        });

        it('should return { allZero: true } when all weights are -2 (bỏ qua)', () => {
            const input = {
                smoking: -2,
                sleep_schedule: -2,
                pets_allowed: -2,
                noise_tolerance: -2,
                guest_frequency: -2,
                social_level: -2,
                cooking_frequency: -2,
                work_from_home: -2,
                personalityType: -2,
                interests: -2,
                cleanliness: -2,
            };
            const result = normalizeWeights(input);
            assert.deepStrictEqual(result, { allZero: true });
        });

        it('should normalize custom weights correctly (smoking=4, cleanliness=2, rest=1)', () => {
            const input = {
                smoking: 4,           // rất quan trọng
                cleanliness: 2,       // quan trọng
                sleep_schedule: 1,    // bình thường
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
                interests: 1,
            };
            const result = normalizeWeights(input);
            
            // Verify it's an object with normalized weights
            assert.ok(result && typeof result === 'object');
            assert.ok(!result.allZero);
            
            // Verify weights sum to 1.0 (within floating point tolerance)
            const sum = Object.values(result).reduce((s, v) => s + v, 0);
            assert.ok(Math.abs(sum - 1.0) < 0.0001, `Sum should be 1.0, got ${sum}`);
            
            // Verify smoking has highest weight (4x multiplier)
            assert.ok(result.smoking > result.cleanliness, 'smoking should have higher weight than cleanliness');
            assert.ok(result.cleanliness > result.sleep_schedule, 'cleanliness should have higher weight than sleep_schedule');
        });

        it('should handle -1 (ít quan tâm) as 0.2 multiplier', () => {
            const input = {
                smoking: -1,          // ít quan tâm → 0.2x
                cleanliness: 4,       // rất quan trọng → 4x
                sleep_schedule: 1,
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
                interests: 1,
            };
            const result = normalizeWeights(input);
            
            assert.ok(result && typeof result === 'object');
            // smoking should have much lower weight than cleanliness
            assert.ok(result.smoking < result.cleanliness);
            assert.ok(result.smoking > 0, 'smoking should still have some weight (0.2x)');
        });

        it('should set weight to 0 for fields with -2 (bỏ qua)', () => {
            const input = {
                smoking: -2,          // bỏ qua hoàn toàn
                cleanliness: 4,
                sleep_schedule: 1,
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
                interests: 1,
            };
            const result = normalizeWeights(input);
            
            assert.ok(result && typeof result === 'object');
            // smoking should have 0 weight (completely ignored)
            assert.strictEqual(result.smoking, 0);
            assert.ok(result.cleanliness > 0);
        });
    });

    describe('calculateLifestyleMatch with customWeights', () => {
        const myLifestyle = {
            smoking: false,
            sleep_schedule: 'bình thường (22h-0h)',
            pets_allowed: false,
            cleanliness: 'rất sạch',
            noise_tolerance: 'thấp',
            guest_frequency: 'hiếm',
            social_level: 'trung bình',
            cooking_frequency: 'thường xuyên',
            work_from_home: true,
            personalityType: 'INTJ',
            interests: ['đọc sách', 'lập trình', 'du lịch'],
        };

        const candidateA = {
            smoking: false,
            sleep_schedule: 'bình thường (22h-0h)',
            pets_allowed: false,
            cleanliness: 'rất sạch',
            noise_tolerance: 'thấp',
            guest_frequency: 'hiếm',
            social_level: 'trung bình',
            cooking_frequency: 'thường xuyên',
            work_from_home: true,
            personalityType: 'INTJ',
            interests: ['đọc sách', 'lập trình', 'du lịch'],
        };

        const candidateB = {
            smoking: true,              // khác
            sleep_schedule: 'khuya (sau 0h)',  // khác
            pets_allowed: true,         // khác
            cleanliness: 'không quan tâm',     // khác
            noise_tolerance: 'cao',     // khác
            guest_frequency: 'thường xuyên',   // khác
            social_level: 'cao',        // khác
            cooking_frequency: 'không nấu',    // khác
            work_from_home: false,      // khác
            personalityType: 'ESFP',    // khác
            interests: ['thể thao', 'tiệc tùng'], // khác
        };

        it('should return 100 for identical profiles with default weights', () => {
            const score = calculateLifestyleMatch(myLifestyle, candidateA, null);
            assert.strictEqual(score, 100);
        });

        it('should return 0 when customWeights is { allZero: true }', () => {
            const score = calculateLifestyleMatch(myLifestyle, candidateA, { allZero: true });
            assert.strictEqual(score, 0);
        });

        it('should use default LIFESTYLE_WEIGHTS when customWeights is null', () => {
            const scoreDefault = calculateLifestyleMatch(myLifestyle, candidateB, null);
            const scoreExplicit = calculateLifestyleMatch(myLifestyle, candidateB, LIFESTYLE_WEIGHTS);
            
            // Both should give same result
            assert.strictEqual(scoreDefault, scoreExplicit);
        });

        it('should prioritize smoking when smoking weight is high', () => {
            // Candidate B smokes (major difference)
            const normalWeights = normalizeWeights({
                smoking: 1, cleanliness: 1, sleep_schedule: 1, pets_allowed: 1,
                noise_tolerance: 1, guest_frequency: 1, social_level: 1,
                cooking_frequency: 1, work_from_home: 1, personalityType: 1, interests: 1,
            });
            const highSmokingWeights = normalizeWeights({
                smoking: 4, cleanliness: 1, sleep_schedule: 1, pets_allowed: 1,
                noise_tolerance: 1, guest_frequency: 1, social_level: 1,
                cooking_frequency: 1, work_from_home: 1, personalityType: 1, interests: 1,
            });

            const scoreNormal = calculateLifestyleMatch(myLifestyle, candidateB, normalWeights);
            const scoreHighSmoking = calculateLifestyleMatch(myLifestyle, candidateB, highSmokingWeights);

            // With high smoking weight, score should be lower (smoking mismatch is penalized more)
            assert.ok(scoreHighSmoking < scoreNormal, 
                `High smoking weight should lower score: ${scoreHighSmoking} < ${scoreNormal}`);
        });

        it('should ignore smoking when smoking weight is -2', () => {
            // Candidate B smokes, but we ignore it
            const ignoreSmokingWeights = normalizeWeights({
                smoking: -2, cleanliness: 4, sleep_schedule: 1, pets_allowed: 1,
                noise_tolerance: 1, guest_frequency: 1, social_level: 1,
                cooking_frequency: 1, work_from_home: 1, personalityType: 1, interests: 1,
            });
            const normalWeights = normalizeWeights({
                smoking: 1, cleanliness: 4, sleep_schedule: 1, pets_allowed: 1,
                noise_tolerance: 1, guest_frequency: 1, social_level: 1,
                cooking_frequency: 1, work_from_home: 1, personalityType: 1, interests: 1,
            });

            const scoreIgnoreSmoking = calculateLifestyleMatch(myLifestyle, candidateB, ignoreSmokingWeights);
            const scoreNormal = calculateLifestyleMatch(myLifestyle, candidateB, normalWeights);

            // Ignoring smoking should give higher score (smoking mismatch doesn't count)
            assert.ok(scoreIgnoreSmoking > scoreNormal,
                `Ignoring smoking should increase score: ${scoreIgnoreSmoking} > ${scoreNormal}`);
        });

        it('should handle mixed weights correctly', () => {
            const mixedWeights = normalizeWeights({
                smoking: 4,           // rất quan trọng
                cleanliness: 2,       // quan trọng
                interests: -1,        // ít quan tâm
                sleep_schedule: -2,   // bỏ qua
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
            });

            const score = calculateLifestyleMatch(myLifestyle, candidateB, mixedWeights);
            
            // Should return a valid score between 0-100
            assert.ok(score >= 0 && score <= 100, `Score should be 0-100, got ${score}`);
            
            // Verify sleep_schedule is completely ignored (weight = 0)
            assert.strictEqual(mixedWeights.sleep_schedule, 0);
        });
    });

    describe('Full integration: WeightsPriorityPanel → API → calculateLifestyleMatch', () => {
        it('should flow correctly from frontend weights to backend scoring', () => {
            // Simulate frontend WeightsPriorityPanel sending these weights:
            // User sets smoking to level 5 (×4), cleanliness to level 4 (×2), rest default (×1)
            const frontendWeights = {
                smoking: 4,
                cleanliness: 2,
                sleep_schedule: 1,
                pets_allowed: 1,
                noise_tolerance: 1,
                guest_frequency: 1,
                social_level: 1,
                cooking_frequency: 1,
                work_from_home: 1,
                personalityType: 1,
                interests: 1,
            };

            // Backend normalizes these weights
            const normalizedWeights = normalizeWeights(frontendWeights);
            
            // Verify normalization worked
            assert.ok(normalizedWeights && typeof normalizedWeights === 'object');
            assert.ok(!normalizedWeights.allZero);
            
            // Create test profiles
            const myProfile = {
                smoking: false,
                cleanliness: 'rất sạch',
                sleep_schedule: 'bình thường (22h-0h)',
                pets_allowed: false,
                noise_tolerance: 'thấp',
                guest_frequency: 'hiếm',
                social_level: 'trung bình',
                cooking_frequency: 'thường xuyên',
                work_from_home: true,
                personalityType: 'INTJ',
                interests: ['đọc sách'],
            };

            const candidateClean = {
                ...myProfile,
                cleanliness: 'rất sạch',  // match
                smoking: false,            // match
            };

            const candidateDirty = {
                ...myProfile,
                cleanliness: 'không quan tâm',  // mismatch
                smoking: true,                   // mismatch
            };

            // Calculate scores with custom weights
            const scoreClean = calculateLifestyleMatch(myProfile, candidateClean, normalizedWeights);
            const scoreDirty = calculateLifestyleMatch(myProfile, candidateDirty, normalizedWeights);

            // Clean candidate should score higher
            assert.ok(scoreClean > scoreDirty,
                `Clean candidate should score higher: ${scoreClean} > ${scoreDirty}`);
            
            // Clean candidate should score very high (near 100)
            assert.ok(scoreClean >= 90, `Clean candidate should score >= 90, got ${scoreClean}`);
            
            // Dirty candidate should score significantly lower due to high smoking/cleanliness weights
            assert.ok(scoreDirty < 70, `Dirty candidate should score < 70, got ${scoreDirty}`);
        });
    });
});
