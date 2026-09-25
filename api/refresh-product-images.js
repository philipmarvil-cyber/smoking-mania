// Lightweight image change detector for MoySklad.
//
// The full catalog sync intentionally reuses imageVersion while the number of
// photos stays the same. That made a very common edit invisible: deleting one
// photo and uploading a replacement still leaves imageCount === 1, so the old
// immutable URL and old Blob object kept being used forever.
//
// This route only asks MoySklad for products changed since the previous scan and
// expands images for that small subset. imageVersion is derived from the actual
// image ids, so a replacement gets a genuinely new URL while price/name edits
// keep the same image version after the first fingerprint pass.
import {
    API,
    fetchJson,
    kvGetCatalog,
    kvSetCatalog,
    kvGetJson,
    kvSetJson,
    shortHash
} from './_catalog-lib.js';

const SCAN_CURSOR_KEY = 'product-image-change-scan:v1';
const IMAGE_HREFS_KEY = 'image-hrefs:v1';
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;
const PAGE_LIMIT = 100; // MoySklad caps collections with expand at 100.
const MAX_PAGES = 40;

function moySkladTime(ms) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(new Date(ms));
    const value = type => parts.find(part => part.type === type)?.value || '00';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}

function changedProductsUrl(sinceMs, offset = 0) {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_LIMIT));
    if (offset > 0) params.set('offset', String(offset));
    params.set('expand', 'images');
    params.set('filter', `archived=false;updated>${moySkladTime(sinceMs)}`);
    return `${API}/entity/product?${params.toString()}`;
}

async function fetchChangedProducts(sinceMs) {
    const first = await fetchJson(changedProductsUrl(sinceMs));
    let rows = first?.rows || [];
    const total = Number(first?.meta?.size) || rows.length;
    const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_LIMIT));

    for (let page = 1; page < pages; page++) {
        const data = await fetchJson(changedProductsUrl(sinceMs, page * PAGE_LIMIT));
        rows = rows.concat(data?.rows || []);
    }
    return { rows, total, truncated: total > PAGE_LIMIT * MAX_PAGES };
}

function expandedImageRows(product) {
    return Array.isArray(product?.images?.rows) ? product.images.rows : [];
}

function imageFingerprint(rows) {
    const parts = rows.map(row =>
        row?.id ||
        row?.meta?.href ||
        row?.meta?.downloadHref ||
        row?.miniature?.downloadHref ||
        ''
    ).filter(Boolean);
    return parts.length ? shortHash(parts.join('|')) : '0';
}

function imageLinks(rows) {
    const minis = rows
        .map(row => row?.miniature?.downloadHref || '')
        .filter(Boolean);
    const fulls = rows
        .map(row => row?.meta?.downloadHref || row?.miniature?.downloadHref || '')
        .filter(Boolean);
    return { minis, fulls };
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Метод не поддерживается' });
    }

    const startedAt = Date.now();
    try {
        const previousCursor = Number(await kvGetJson(SCAN_CURSOR_KEY).catch(() => 0)) || 0;
        const sinceMs = previousCursor
            ? Math.max(0, previousCursor - OVERLAP_MS)
            : Math.max(0, startedAt - INITIAL_LOOKBACK_MS);

        // Сначала спрашиваем МойСклад только о товарах, изменённых после
        // прошлого прохода. Если изменений нет, многомегабайтный catalog:v2
        // вообще не читаем из Upstash.
        const changed = await fetchChangedProducts(sinceMs);
        if (!changed.rows.length) {
            await kvSetJson(SCAN_CURSOR_KEY, startedAt);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                success: true,
                since: moySkladTime(sinceMs),
                changedProductsReported: changed.total,
                scannedProducts: 0,
                matchedCatalogProducts: 0,
                imageVersionChanges: 0,
                removedImages: 0,
                skippedUnexpanded: 0,
                truncated: changed.truncated,
                durationMs: Date.now() - startedAt
            });
        }

        const catalog = await kvGetCatalog();
        if (!catalog || !Array.isArray(catalog.products)) {
            return res.status(503).json({ success: false, error: 'Каталог ещё не создан' });
        }

        const byId = new Map(catalog.products.map(product => [product.id, product]));
        const imageHrefsRaw = await kvGetJson(IMAGE_HREFS_KEY).catch(() => null);
        const imageHrefs = imageHrefsRaw && typeof imageHrefsRaw === 'object'
            ? imageHrefsRaw
            : {};

        let catalogChanged = false;
        let hrefsChanged = false;
        let matchedCatalogProducts = 0;
        let versionChanges = 0;
        let removedImages = 0;
        let skippedUnexpanded = 0;

        for (const source of changed.rows) {
            const product = byId.get(source?.id);
            if (!product) continue;
            matchedCatalogProducts++;

            const rows = expandedImageRows(source);
            const metaSize = Number(source?.images?.meta?.size);
            const imageCount = Number.isFinite(metaSize) ? Math.max(0, metaSize) : rows.length;

            if (imageCount <= 0) {
                if (Number(product.imageCount || 0) > 0 || product.imageVersion !== '0' || product.img) {
                    product.imageCount = 0;
                    product.imageVersion = '0';
                    product.img = '';
                    catalogChanged = true;
                    removedImages++;
                }
                if (Object.prototype.hasOwnProperty.call(imageHrefs, product.id)) {
                    delete imageHrefs[product.id];
                    hrefsChanged = true;
                }
                continue;
            }

            // If MoySklad says images exist but did not expand them, never turn a
            // good catalog entry into a blank one. The overlap window retries it.
            if (!rows.length) {
                skippedUnexpanded++;
                continue;
            }

            const version = imageFingerprint(rows);
            if (version === '0') {
                skippedUnexpanded++;
                continue;
            }

            const links = imageLinks(rows);
            if (links.minis.length || links.fulls.length) {
                const previousLinks = imageHrefs[product.id];
                if (JSON.stringify(previousLinks || null) !== JSON.stringify(links)) {
                    imageHrefs[product.id] = links;
                    hrefsChanged = true;
                }
            }

            if (product.imageVersion !== version || Number(product.imageCount || 0) !== imageCount) {
                product.imageCount = imageCount;
                product.imageVersion = version;
                product.img = `/api/product-image?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}`;
                catalogChanged = true;
                versionChanges++;
            }
        }

        const writes = [];
        if (catalogChanged) writes.push(kvSetCatalog(catalog));
        if (hrefsChanged) writes.push(kvSetJson(IMAGE_HREFS_KEY, imageHrefs));
        if (versionChanges > 0) writes.push(kvSetJson('product-image-blob-dirty:v1', true));
        // Advance the cursor only after all MoySklad reads and catalog processing
        // succeeded. A failed run therefore gets retried instead of losing edits.
        writes.push(kvSetJson(SCAN_CURSOR_KEY, startedAt));
        const results = await Promise.all(writes);
        if (results.some(result => result === false)) {
            throw new Error('Не удалось сохранить результат проверки изображений в KV');
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            since: moySkladTime(sinceMs),
            changedProductsReported: changed.total,
            scannedProducts: changed.rows.length,
            matchedCatalogProducts,
            imageVersionChanges: versionChanges,
            removedImages,
            skippedUnexpanded,
            truncated: changed.truncated,
            durationMs: Date.now() - startedAt
        });
    } catch (e) {
        console.error('[refresh-product-images]', e?.message, e?.stack);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({ success: false, error: e?.message || String(e) });
    }
}
