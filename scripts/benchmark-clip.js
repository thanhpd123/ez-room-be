#!/usr/bin/env node
/**
 * Benchmark ONNX CLIP embedding performance (Transforms.js runtime).
 *
 * Image: getClipImageEmbedding(imageBuffer)
 * Text:  getClipTextEmbedding(text)
 *
 * Cold mode: first call includes model load/download (whichever path hasn't been loaded yet).
 * Warm mode: repeated calls after the model is already loaded.
 *
 * Examples:
 *   node scripts/benchmark-clip.js --iterations 30 --warmup 5
 *   node scripts/benchmark-clip.js --iterations 10 --warmup 0 --skipCold --run image
 *   node scripts/benchmark-clip.js --image "d:/path/a.png" --image "https://example.com/b.jpg"
 *   node scripts/benchmark-clip.js --texts "phòng có cửa sổ lớn|studio 25m2|yên tĩnh gần đại học"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { performance } = require('perf_hooks');

const { getClipImageEmbedding, getClipTextEmbedding, preloadCLIP, CLIP_DIMS, CLIP_MODEL, getClipModelLabel } = require('../utils/clip');
const { MINI_PNG } = require('../utils/clip-diagnostics');

function parseArgs(argv) {
    const opts = {
        iterations: 30,
        warmup: 5,
        run: 'both', // both | image | text
        skipCold: false,
        skipWarm: false,
        imageSources: [],
        texts: null,
        output: null,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--iterations') opts.iterations = Math.max(1, parseInt(argv[++i], 10));
        else if (a === '--warmup') opts.warmup = Math.max(0, parseInt(argv[++i], 10));
        else if (a === '--run') opts.run = (argv[++i] || 'both').toLowerCase();
        else if (a === '--skipCold') opts.skipCold = true;
        else if (a === '--skipWarm') opts.skipWarm = true;
        else if (a === '--image') opts.imageSources.push(argv[++i]);
        else if (a === '--texts') opts.texts = argv[++i];
        else if (a === '--output') opts.output = argv[++i];
        else if (a === '--help' || a === '-h') opts.help = true;
    }

    return opts;
}

function percentile(sortedNumbers, p) {
    if (sortedNumbers.length === 0) return null;
    const idx = (sortedNumbers.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedNumbers[lo];
    const w = idx - lo;
    return sortedNumbers[lo] * (1 - w) + sortedNumbers[hi] * w;
}

function computeL2Norm(vec) {
    let s = 0;
    for (const v of vec) s += v * v;
    return Math.sqrt(s);
}

async function loadImageSource(src) {
    // Local file
    if (typeof src === 'string' && !/^https?:\/\//i.test(src)) {
        const abs = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
        const buf = await fs.promises.readFile(abs);
        return { source: src, buffer: buf };
    }

    // Remote URL
    const url = src;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    return { source: url, buffer: Buffer.from(res.data) };
}

async function benchmarkFn({ label, mode, inputs, fn, iterations, warmup }) {
    const timings = [];
    const dims = [];
    const l2Norms = [];
    let nullCount = 0;
    let errorCount = 0;

    // Warmup (not recorded)
    for (let i = 0; i < warmup; i++) {
        const input = inputs[i % inputs.length];
        try {
            await fn(input);
        } catch (_) {
            // Ignore warmup errors; recorded phase will surface them.
        }
    }

    for (let i = 0; i < iterations; i++) {
        const input = inputs[i % inputs.length];
        const t0 = performance.now();
        try {
            const emb = await fn(input);
            const dt = performance.now() - t0;
            timings.push(dt);

            if (!emb || emb.length === 0) {
                nullCount++;
                dims.push(null);
                l2Norms.push(null);
                continue;
            }

            dims.push(emb.length);
            l2Norms.push(computeL2Norm(emb));
        } catch (e) {
            const dt = performance.now() - t0;
            timings.push(dt);
            errorCount++;
        }
    }

    const sorted = timings.slice().sort((a, b) => a - b);

    return {
        label,
        mode,
        iterations,
        warmup,
        timingsMs: {
            min: sorted.length ? sorted[0] : null,
            p50: percentile(sorted, 0.50),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            max: sorted.length ? sorted[sorted.length - 1] : null,
        },
        embeddingStats: {
            nullCount,
            errorCount,
            avgDim: dims.filter((d) => d != null).reduce((s, v) => s + v, 0) / Math.max(1, dims.filter((d) => d != null).length),
            expectedDim: CLIP_DIMS,
            l2NormAvg: l2Norms.filter((n) => n != null).reduce((s, v) => s + v, 0) / Math.max(1, l2Norms.filter((n) => n != null).length),
            l2NormMin: l2Norms.filter((n) => n != null).sort((a, b) => a - b)[0] ?? null,
            l2NormMax: l2Norms.filter((n) => n != null).sort((a, b) => a - b).at(-1) ?? null,
        },
    };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('Usage: node scripts/benchmark-clip.js [--iterations N] [--warmup N] [--run image|text|both] [--skipCold] [--skipWarm] [--image SRC...] [--texts "a|b|c"]');
        process.exit(0);
    }

    const runImage = opts.run === 'both' || opts.run === 'image';
    const runText = opts.run === 'both' || opts.run === 'text';

    const imageSources = opts.imageSources.length ? opts.imageSources : [ { _default: true } ];
    const images = [];
    if (imageSources.length === 1 && imageSources[0] && imageSources[0]._default) {
        images.push({ source: 'MINI_PNG', buffer: MINI_PNG });
    } else {
        for (const src of imageSources) {
            try {
                images.push(await loadImageSource(src));
            } catch (e) {
                console.warn(`[CLIP BENCH] Could not load image source "${src}": ${e.message}`);
            }
        }
        if (images.length === 0) {
            console.log('[CLIP BENCH] No valid images loaded; falling back to MINI_PNG.');
            images.push({ source: 'MINI_PNG', buffer: MINI_PNG });
        }
    }

    const defaultTexts = [
        'phòng có cửa sổ lớn',
        'studio 25m2, gần đại học, yên tĩnh',
        'nệm êm, wifi mạnh, giá khoảng 3 triệu/tháng',
        'có điều hòa, có máy giặt, khu vực an ninh 24/7',
    ];
    const texts = opts.texts
        ? opts.texts.split('|').map((s) => s.trim()).filter(Boolean)
        : defaultTexts;

    const report = {
        ts: new Date().toISOString(),
        clipModel: `${CLIP_MODEL} (${getClipModelLabel()}, Transformers.js ONNX)`,
        expectedEmbeddingDims: CLIP_DIMS,
        config: {
            iterations: opts.iterations,
            warmup: opts.warmup,
            run: opts.run,
            skipCold: opts.skipCold,
            skipWarm: opts.skipWarm,
            imageCount: images.length,
            textCount: texts.length,
        },
        results: [],
    };

    if (runImage) {
        // Cold first-call: includes vision model load/initialization
        if (!opts.skipCold) {
            const cold = await benchmarkFn({
                label: 'clip_image_embedding',
                mode: 'cold_firstcall_then_warmup_phase',
                inputs: images.map((i) => i.buffer),
                fn: (buf) => getClipImageEmbedding(buf),
                iterations: 1,
                warmup: 0,
            });
            report.results.push({ ...cold, iterations: 1, warmup: 0 });
        }

        if (!opts.skipWarm) {
            // Warm: preload vision model to remove load cost
            await preloadCLIP();
            const warm = await benchmarkFn({
                label: 'clip_image_embedding',
                mode: 'warm',
                inputs: images.map((i) => i.buffer),
                fn: (buf) => getClipImageEmbedding(buf),
                iterations: opts.iterations,
                warmup: opts.warmup,
            });
            report.results.push(warm);
        }
    }

    if (runText) {
        // Cold first-call: includes text model load/initialization
        if (!opts.skipCold) {
            const cold = await benchmarkFn({
                label: 'clip_text_embedding',
                mode: 'cold_firstcall_then_warmup_phase',
                inputs: texts,
                fn: (t) => getClipTextEmbedding(t),
                iterations: 1,
                warmup: 0,
            });
            report.results.push({ ...cold, iterations: 1, warmup: 0 });
        }

        if (!opts.skipWarm) {
            // Warm: first call primes the text model.
            // There isn't a separate preload helper for text; this avoids double-counting load time.
            await getClipTextEmbedding(texts[0]);
            const warm = await benchmarkFn({
                label: 'clip_text_embedding',
                mode: 'warm',
                inputs: texts,
                fn: (t) => getClipTextEmbedding(t),
                iterations: opts.iterations,
                warmup: opts.warmup,
            });
            report.results.push(warm);
        }
    }

    // Print summary
    for (const r of report.results) {
        const t = r.timingsMs;
        console.log(`[CLIP BENCH] ${r.label} (${r.mode}) it=${r.iterations} p50=${t.p50?.toFixed(1)}ms p95=${t.p95?.toFixed(1)}ms p99=${t.p99?.toFixed(1)}ms dim=${r.embeddingStats.avgDim} l2Avg=${r.embeddingStats.l2NormAvg?.toFixed(4)}`);
    }

    // Output JSON
    const json = JSON.stringify(report, null, 2);
    console.log(json);

    if (opts.output) {
        const outPath = path.isAbsolute(opts.output) ? opts.output : path.resolve(process.cwd(), opts.output);
        await fs.promises.writeFile(outPath, json, 'utf8');
        console.log(`[CLIP BENCH] Saved report -> ${outPath}`);
    }
}

main().catch((e) => {
    console.error('[CLIP BENCH] Fatal:', e);
    process.exit(1);
});

