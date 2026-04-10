/**
 * Smoke test for Vector-based Weighted Cosine Similarity scoring.
 * Run: node test/vector-scoring-smoke.js
 */
const {
    computeLifestyleScore,
    quantize,
    vectorizeLifestyle,
    weightedCosineSimilarity,
    QUANT_MAPS,
    LIFESTYLE_WEIGHTS,
} = require('../services/roommate.service');

console.log('=== Vector Scoring Smoke Test ===\n');

// ─── Test 1: Identical profiles → ~100% ───
const profileA = {
    smoking: false, drinking: false, pets_allowed: false, work_from_home: true,
    sleep_schedule: 'Bình thường (22h-0h)', cleanliness: 'Sạch',
    noise_tolerance: 'Trung bình', social_level: 'Trung bình',
    guest_frequency: 'Thỉnh thoảng', cooking_frequency: 'Ít',
    personalityType: 'Hướng nội', interests: ['Đọc sách', 'Gaming'],
    deal_breakers: null,
};

const score1 = computeLifestyleScore(profileA, { ...profileA }, null, null);
console.log(`Test 1 - Identical profiles: ${score1}% (expected ~100)`);
console.assert(score1 >= 95, `FAIL: Expected >=95, got ${score1}`);

// ─── Test 2: Completely opposite profiles → low score ───
const profileB = {
    smoking: true, drinking: true, pets_allowed: true, work_from_home: false,
    sleep_schedule: 'Khuya (sau 0h)', cleanliness: 'Không quan tâm',
    noise_tolerance: 'Cao', social_level: 'Cao',
    guest_frequency: 'Thường xuyên', cooking_frequency: 'Hàng ngày',
    personalityType: 'Hướng ngoại', interests: ['Thể thao', 'Du lịch'],
    deal_breakers: null,
};

const score2 = computeLifestyleScore(profileA, profileB, null, null);
console.log(`Test 2 - Opposite profiles: ${score2}% (expected low, <40)`);
console.assert(score2 < 40, `FAIL: Expected <40, got ${score2}`);

// ─── Test 3: "Sạch" vs "Rất sạch" should be HIGH (not 0 like old system) ───
const profileC = { ...profileA, cleanliness: 'Rất sạch' };
const score3 = computeLifestyleScore(profileA, profileC, null, null);
console.log(`Test 3 - Sạch vs Rất sạch: ${score3}% (expected high, >85)`);
console.assert(score3 > 85, `FAIL: Expected >85, got ${score3}`);

// ─── Test 4: "Bình thường (22h-0h)" vs "Khuya (sau 0h)" should score medium ───
const profileD = { ...profileA, sleep_schedule: 'Khuya (sau 0h)' };
const score4 = computeLifestyleScore(profileA, profileD, null, null);
console.log(`Test 4 - Bình thường vs Khuya sleep: ${score4}% (expected medium, 70-95)`);
console.assert(score4 >= 70 && score4 <= 95, `FAIL: Expected 70-95, got ${score4}`);

// ─── Test 5: Deal-breaker should severely reduce score ───
const profileE = { ...profileA, deal_breakers: 'smoking' };
const profileF = { ...profileA, smoking: true };
const score5 = computeLifestyleScore(profileE, profileF, null, null);
console.log(`Test 5 - 1 deal-breaker violation: ${score5}% (expected <35)`);
console.assert(score5 < 35, `FAIL: Expected <35, got ${score5}`);

// ─── Test 6: 2+ deal-breaker violations → 0 ───
const profileG = { ...profileA, deal_breakers: 'smoking,pets' };
const profileH = { ...profileA, smoking: true, pets_allowed: true };
const score6 = computeLifestyleScore(profileG, profileH, null, null);
console.log(`Test 6 - 2 deal-breaker violations: ${score6}% (expected 0)`);
console.assert(score6 === 0, `FAIL: Expected 0, got ${score6}`);

// ─── Test 7: Null/empty profiles → 0 ───
const score7 = computeLifestyleScore(null, profileA, null, null);
console.log(`Test 7 - Null profile: ${score7}% (expected 0)`);
console.assert(score7 === 0, `FAIL: Expected 0, got ${score7}`);

// ─── Test 8: Partial profiles (some fields missing) → should still work ───
const profileI = { smoking: false, drinking: false };
const profileJ = { smoking: false, drinking: true };
const score8 = computeLifestyleScore(profileI, profileJ, null, null);
console.log(`Test 8 - Partial profiles: ${score8}% (expected 50-70)`);
console.assert(score8 >= 30 && score8 <= 80, `FAIL: Expected 30-80, got ${score8}`);

// ─── Test 9: Quantization maps check ───
console.log('\n--- Quantization checks ---');
console.log(`Sạch → ${quantize('cleanliness', 'Sạch')} (expected 0.67)`);
console.log(`Rất sạch → ${quantize('cleanliness', 'Rất sạch')} (expected 1.0)`);
console.log(`Bình thường → ${quantize('cleanliness', 'Bình thường')} (expected 0.33)`);
console.log(`smoking true → ${quantize('smoking', true)} (expected 1.0)`);
console.log(`smoking false → ${quantize('smoking', false)} (expected 0.0)`);
console.log(`null → ${quantize('cleanliness', null)} (expected null)`);

console.log('\n=== All smoke tests completed ===');
