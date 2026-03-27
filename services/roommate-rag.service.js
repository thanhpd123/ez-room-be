/**
 * Roommate RAG Service – Multi-Stage Pipeline (Gemini Flash)
 *
 * Stage 1: Rule-Based Pre-Filter  – computeLifestyleScore lọc top 20 ứng viên
 * Stage 2: LLM Analysis & Ranking – Gemini Flash phân tích, rerank + giải thích
 *
 * Sử dụng 100% Gemini Flash (generative model), không cần embedding model
 * VIP-only feature
 */
const prisma = require('../config/prisma');
const { computeLifestyleScore } = require('./roommate.service');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chuyển lifestyle profile → text mô tả tính cách (tiếng Việt)
 */
function profileToText(user, lifestyle, preference) {
    const parts = [];

    if (user.fullName) parts.push(`Tên: ${user.fullName}`);
    if (user.gender) parts.push(`Giới tính: ${user.gender}`);
    if (!lifestyle) return parts.join('. ') || 'Chưa có thông tin';

    // Tính cách & xã giao
    if (lifestyle.personalityType) parts.push(`Tính cách: ${lifestyle.personalityType}`);
    if (lifestyle.social_level) parts.push(`Mức xã giao: ${lifestyle.social_level}`);

    // Thói quen sống
    parts.push(`Hút thuốc: ${lifestyle.smoking ? 'Có' : 'Không'}`);
    parts.push(`Rượu bia: ${lifestyle.drinking ? 'Có' : 'Không'}`);
    if (lifestyle.pets_allowed != null) parts.push(`Thú cưng: ${lifestyle.pets_allowed ? 'Có' : 'Không'}`);

    // Giờ giấc
    if (lifestyle.sleep_schedule) parts.push(`Lịch ngủ: ${lifestyle.sleep_schedule}`);
    if (lifestyle.wake_time) parts.push(`Dậy: ${lifestyle.wake_time}`);
    if (lifestyle.bedtime) parts.push(`Ngủ: ${lifestyle.bedtime}`);

    // Lối sống
    if (lifestyle.cleanliness) parts.push(`Sạch sẽ: ${lifestyle.cleanliness}`);
    if (lifestyle.noise_tolerance) parts.push(`Chịu ồn: ${lifestyle.noise_tolerance}`);
    if (lifestyle.guest_frequency) parts.push(`Khách: ${lifestyle.guest_frequency}`);
    if (lifestyle.cooking_frequency) parts.push(`Nấu ăn: ${lifestyle.cooking_frequency}`);
    if (lifestyle.work_from_home) parts.push('Làm việc tại nhà');
    if (lifestyle.occupation_type) parts.push(`Nghề: ${lifestyle.occupation_type}`);
    if (lifestyle.temperature_preference) parts.push(`Nhiệt độ: ${lifestyle.temperature_preference}`);
    if (lifestyle.quiet_hours_preference) parts.push(`Giờ yên tĩnh: ${lifestyle.quiet_hours_preference}`);

    // Sở thích
    const interests = Array.isArray(lifestyle.interests) ? lifestyle.interests : [];
    if (interests.length > 0) parts.push(`Sở thích: ${interests.join(', ')}`);

    // Ngôn ngữ
    const languages = Array.isArray(lifestyle.languages) ? lifestyle.languages : [];
    if (languages.length > 0) parts.push(`Ngôn ngữ: ${languages.join(', ')}`);

    // Preferences
    if (preference) {
        const districts = Array.isArray(preference.preferred_districts) ? preference.preferred_districts : [];
        if (districts.length > 0) parts.push(`Khu vực: ${districts.join(', ')}`);
        if (preference.room_type) parts.push(`Loại phòng: ${preference.room_type}`);
    }

    return parts.join('. ');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Stage 2: Gemini Flash Analysis, Ranking & Explanation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Gọi Gemini Flash để phân tích ngữ nghĩa, rerank, và giải thích lý do
 */
async function analyzeAndRankWithLLM(query, candidates) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[roommate-rag] GEMINI_API_KEY is not set!');
            return null;
        }
        console.log(`[roommate-rag] LLM: Using model ${GEMINI_MODEL}, API key: ${apiKey.substring(0, 8)}...`);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

        // Tạo mô tả cho mỗi candidate
        const profileSummaries = candidates.map((c, i) => {
            return `[${i + 1}] ${c.profileText} (Điểm lifestyle: ${c.lifestyleScore}/100)`;
        });

        const prompt = `Bạn là AI chuyên tìm bạn cùng phòng trọ (roommate).

NGƯỜI DÙNG ĐANG TÌM ROOMMATE VỚI YÊU CẦU:
"${query}"

DANH SÁCH ${candidates.length} ỨNG VIÊN (đã lọc sơ bộ theo thói quen sống):
${profileSummaries.join('\n')}

NHIỆM VỤ:
1. Phân tích ngữ nghĩa yêu cầu người dùng (hiểu cả ý nghĩa ẩn, VD "chill chill" = thích bình yên, hướng nội)
2. So khớp từng ứng viên với yêu cầu
3. Cho điểm 0-100 và giải thích ngắn gọn

QUY TẮC CHẤM ĐIỂM:
- Tính cách phù hợp: +30 điểm
- Thói quen sinh hoạt phù hợp: +30 điểm  
- Sở thích tương đồng: +20 điểm
- Các yếu tố khác (giới tính, khu vực): +20 điểm
- Trừ điểm nếu có yếu tố mâu thuẫn trực tiếp

TRẢ VỀ JSON array (CHỈ JSON, KHÔNG text khác):
[{"id":1,"score":85,"reason":"Phù hợp vì tính cách hướng nội, không hút thuốc, thích bình yên"},{"id":2,"score":60,"reason":"Khá phù hợp nhưng thói quen ngủ khác nhau"}]

Lưu ý:
- reason phải viết bằng tiếng Việt, ngắn gọn (tối đa 40 từ)
- Sắp xếp theo score giảm dần
- Phải trả lời cho TẤT CẢ ứng viên`;

        console.log('[roommate-rag] LLM: Sending prompt to Gemini Flash...');

        // Retry with exponential backoff for rate limits (429)
        let text = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                    console.log(`[roommate-rag] LLM: Retry ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`);
                    await sleep(delay);
                }
                const result = await model.generateContent(prompt);
                text = result.response.text().trim();
                break; // success
            } catch (retryErr) {
                const status = retryErr?.status || retryErr?.httpStatusCode;
                console.error(`[roommate-rag] LLM attempt ${attempt + 1} failed:`, retryErr.message?.substring(0, 200));
                if (status === 429 && attempt < MAX_RETRIES - 1) {
                    continue; // retry
                }
                throw retryErr; // give up
            }
        }

        if (!text) {
            console.error('[roommate-rag] LLM: No response text after retries');
            return null;
        }
        console.log('[roommate-rag] LLM raw response:', text.substring(0, 500));

        // Parse JSON — handle markdown code blocks
        const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        if (!Array.isArray(parsed)) {
            console.error('[roommate-rag] LLM response is not an array:', typeof parsed);
            return null;
        }
        console.log(`[roommate-rag] LLM: Parsed ${parsed.length} results successfully`);
        return parsed;
    } catch (err) {
        console.error('[roommate-rag] LLM analysis error:', err.message);
        console.error('[roommate-rag] LLM full error:', err);
        return null;
    }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Main Search: Multi-Stage Pipeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Tìm roommate bằng mô tả tính cách (VIP only)
 * Stage 1: Rule-based pre-filter → top 20
 * Stage 2: Gemini Flash analysis + ranking + explanation
 */
async function searchByPersonality(userId, queryText, limit = 10) {
    // ── VIP Check ────────────────────────────────────────
    const me = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            isVip: true,
            gender: true,
            lifestyleProfile: true,
            preference: true,
        },
    });
    if (!me) {
        throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }
    if (!me.isVip) {
        throw Object.assign(
            new Error('Tính năng tìm kiếm AI chỉ dành cho tài khoản VIP. Vui lòng nâng cấp VIP để sử dụng.'),
            { statusCode: 403, code: 'VIP_REQUIRED' }
        );
    }

    // ── Exclude blocked + self ───────────────────────────
    const existingMatches = await prisma.roommateMatch.findMany({
        where: {
            OR: [{ requester_id: userId }, { target_id: userId }],
            status: { in: ['BLOCKED'] },
        },
        select: { requester_id: true, target_id: true },
    });
    const blockedIds = new Set();
    existingMatches.forEach((m) => {
        blockedIds.add(m.requester_id);
        blockedIds.add(m.target_id);
    });
    blockedIds.add(userId);

    // ━━ STAGE 1: Rule-Based Pre-Filter ━━━━━━━━━━━━━━━━━
    console.log('[roommate-rag] Stage 1: Rule-based pre-filter...');

    const allTenants = await prisma.user.findMany({
        where: {
            status: 'ACTIVE',
            role: 'TENANT',
            id: { notIn: [...blockedIds] },
            lifestyleProfile: { isNot: null },
        },
        select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            gender: true,
            lifestyleProfile: true,
            preference: true,
        },
    });

    const myLifestyle = me.lifestyleProfile || null;
    const myPrefs = me.preference || null;

    // Score + rank by lifestyle compatibility
    const scored = allTenants.map((u) => {
        const lifestyleScore = computeLifestyleScore(
            myLifestyle,
            u.lifestyleProfile,
            myPrefs,
            u.preference
        );
        return {
            userId: u.id,
            userData: {
                id: u.id,
                fullName: u.fullName,
                avatarUrl: u.avatarUrl,
                gender: u.gender,
            },
            lifestyle: u.lifestyleProfile,
            preference: u.preference,
            lifestyleScore,
            profileText: profileToText(u, u.lifestyleProfile, u.preference),
        };
    });

    scored.sort((a, b) => b.lifestyleScore - a.lifestyleScore);
    const topCandidates = scored.slice(0, 20); // top 20 for LLM analysis

    console.log(`[roommate-rag] Stage 1 complete: ${allTenants.length} tenants → top ${topCandidates.length}`);

    // ━━ STAGE 2: Gemini Flash Analysis + Ranking ━━━━━━━
    console.log('[roommate-rag] Stage 2: Gemini Flash analysis...');
    const llmResults = await analyzeAndRankWithLLM(queryText, topCandidates);

    // ── Merge results ────────────────────────────────────
    let finalResults;
    if (llmResults && llmResults.length > 0) {
        const llmMap = new Map();
        llmResults.forEach((lr) => llmMap.set(lr.id, lr));

        finalResults = topCandidates.map((c, idx) => {
            const llm = llmMap.get(idx + 1);
            const aiScore = llm?.score ?? c.lifestyleScore;
            // Hybrid: 60% AI analysis + 40% rule-based
            const finalScore = Math.round(0.6 * aiScore + 0.4 * c.lifestyleScore);
            return {
                ...c,
                finalScore,
                aiReason: llm?.reason ?? null,
            };
        });

        finalResults.sort((a, b) => b.finalScore - a.finalScore);
    } else {
        // Fallback: chỉ dùng lifestyle score
        finalResults = topCandidates.map((c) => ({
            ...c,
            finalScore: c.lifestyleScore,
            aiReason: null,
        }));
    }

    // Giới hạn kết quả
    finalResults = finalResults.slice(0, limit);

    console.log(`[roommate-rag] Pipeline complete. Returning ${finalResults.length} results.`);

    // ── Format response ──────────────────────────────────
    return {
        data: finalResults.map((s) => ({
            user: s.userData,
            lifestyle: {
                smoking: s.lifestyle?.smoking ?? null,
                drinking: s.lifestyle?.drinking ?? null,
                pets_allowed: s.lifestyle?.pets_allowed ?? null,
                sleep_schedule: s.lifestyle?.sleep_schedule ?? null,
                work_from_home: s.lifestyle?.work_from_home ?? null,
                personalityType: s.lifestyle?.personalityType ?? null,
                social_level: s.lifestyle?.social_level ?? null,
                interests: Array.isArray(s.lifestyle?.interests) ? s.lifestyle.interests : [],
            },
            preference: s.preference
                ? {
                      preferred_districts: Array.isArray(s.preference.preferred_districts)
                          ? s.preference.preferred_districts
                          : [],
                      room_type: s.preference.room_type ?? null,
                      budget_min: s.preference.budget_min ? Number(s.preference.budget_min) : null,
                      budget_max: s.preference.budget_max ? Number(s.preference.budget_max) : null,
                      preferredLocation: s.preference.preferredLocation ?? null,
                  }
                : null,
            similarityScore: s.finalScore,
            aiReason: s.aiReason,
            _debug: {
                lifestyleScore: s.lifestyleScore,
                aiAnalyzed: !!s.aiReason,
            },
        })),
    };
}

module.exports = {
    searchByPersonality,
    profileToText,
};
