// Постепенно переносит фотографии товаров из МойСклад в Vercel Blob.
// Клиенты после миграции получают фото из Blob/CDN и больше не зависят от
// скорости МойСклад. Работа идёт маленькими порциями с жёстким cooldown,
// поэтому даже ручные/повторные вызовы не создают опасную нагрузку на API.
import { put } from '@vercel/blob';
import { kvGetCatalog, kvGetJson, kvSetJson } from './_catalog-lib.js';

const CURSOR_KEY = 'product-image-blob-cursor:v1';
const COOLDOWN_KEY = 'product-image-blob-cooldown:v1';
const BLOB_KEY_PREFIX = 'product-image-blob:v1:';
const BATCH_SIZE = 4;
const MAX_SCAN_PER_RUN = 80;
const COOLDOWN_MS = 4 * 60 * 1000;
const CARD_WIDTH = 640;
const CARD_QUALITY = 82;

function getOrigin(req) {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
}

function cleanVersion(value) {
    return String(value || '0').replace(/[^a-z0-9]/gi, '').slice(0, 30) || '0';
}

function cleanId(value) {
    return String(value || '').replace(/[^a-f0-9-]/gi, '');
}

function extFor(contentType) {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    if (type.includes('avif')) return 'avif';
    return 'jpg';
}

function blobCacheKey(product) {
    return `${BLOB_KEY_PREFIX}${cleanId(product?.id)}:${cleanVersion(product?.imageVersion)}`;
}

function validBlobEntry(entry, product) {
    return !!entry &&
        entry.version === cleanVersion(product?.imageVersion) &&
        typeof entry.cardUrl === 'string' && entry.cardUrl.startsWith('https://') &&
        typeof entry.fullUrl === 'string' && entry.fullUrl.startsWith('https://');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function migrateOne(origin, product) {
    const id = cleanId(product.id);
    const version = cleanVersion(product.imageVersion);
    if (!id || !version || version === '0') return { status: 'skip' };

    const key = blobCacheKey(product);
    const existing = await kvGetJson(key).catch(() => null);
    if (validBlobEntry(existing, product)) return { status: 'exists' };

    // blob-bypass=1 гарантирует, что первичная миграция читает источник из
    // МойСклад, а не случайно зацикливается через уже созданный Blob redirect.
    const sourcePath = `/api/product-image?id=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}&size=full&blob-bypass=1`;
    const sourceResponse = await fetchWithTimeout(`${origin}${sourcePath}`, {
        headers: { Accept: 'image/*' }
    });
    if (!sourceResponse.ok) {
        throw new Error(`source ${sourceResponse.status}`);
    }

    const fullBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    const fullContentType = sourceResponse.headers.get('content-type') || 'image/jpeg';
    if (!fullBuffer.length) throw new Error('empty source image');

    // Получаем готовую карточную WebP-версию ОДИН РАЗ на сервере, а не у
    // покупателя. Vercel Image Optimization здесь работает как конвертер.
    const optimizedPath = `/_vercel/image?url=${encodeURIComponent(sourcePath)}&w=${CARD_WIDTH}&q=${CARD_QUALITY}`;
    const cardResponse = await fetchWithTimeout(`${origin}${optimizedPath}`, {
        headers: { Accept: 'image/webp,image/*;q=0.8,*/*;q=0.5' }
    });
    if (!cardResponse.ok) {
        throw new Error(`optimizer ${cardResponse.status}`);
    }
    const cardBuffer = Buffer.from(await cardResponse.arrayBuffer());
    if (!cardBuffer.length) throw new Error('empty optimized image');

    const basePath = `products/${id}/${version}`;
    const [fullBlob, cardBlob] = await Promise.all([
        put(`${basePath}-full.${extFor(fullContentType)}`, fullBuffer, {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 31536000,
            contentType: fullContentType
        }),
        put(`${basePath}-card-640.webp`, cardBuffer, {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 31536000,
            contentType: cardResponse.headers.get('content-type') || 'image/webp'
        })
    ]);

    const entry = {
        version,
        cardUrl: cardBlob.url,
        fullUrl: fullBlob.url,
        migratedAt: Date.now()
    };
    await kvSetJson(key, entry);

    // Прогреваем ровно тот URL, который сейчас строит card-quality.js.
    // После записи map source уже обслуживается из Blob, поэтому этот прогрев
    // вообще не обращается к МойСклад и снимает холодную оптимизацию с клиента.
    const normalFull = `${origin}/api/product-image?id=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}&size=full`;
    const clientSharp = `${origin}/_vercel/image?url=${encodeURIComponent(normalFull)}&w=${CARD_WIDTH}&q=${CARD_QUALITY}`;
    fetchWithTimeout(clientSharp, {
        headers: { Accept: 'image/webp,image/*;q=0.8,*/*;q=0.5' }
    }, 8000).catch(() => {});

    return { status: 'migrated', entry };
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Метод не поддерживается' });
        return;
    }

    const blobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;
    const cursorNow = Number(await kvGetJson(CURSOR_KEY).catch(() => 0)) || 0;

    // Безопасный публичный статус — нужен, чтобы после деплоя сразу понять,
    // подключено ли Blob-хранилище, не запуская миграцию.
    if (req.query.status === '1') {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ success: true, blobConfigured, cursor: cursorNow });
        return;
    }

    if (!blobConfigured) {
        res.status(503).json({
            success: false,
            blobConfigured: false,
            error: 'Vercel Blob не подключён: отсутствует BLOB_READ_WRITE_TOKEN'
        });
        return;
    }

    const now = Date.now();
    const lastRun = Number(await kvGetJson(COOLDOWN_KEY).catch(() => 0)) || 0;
    if (lastRun && now - lastRun < COOLDOWN_MS) {
        res.status(200).json({
            success: true,
            skipped: true,
            reason: 'cooldown',
            retryAfterMs: COOLDOWN_MS - (now - lastRun)
        });
        return;
    }
    // Ставим cooldown ДО работы. Даже если функцию оборвёт, следующий запуск
    // не создаст параллельный шквал запросов к МойСклад.
    await kvSetJson(COOLDOWN_KEY, now);

    try {
        const origin = getOrigin(req);
        if (!origin) throw new Error('Не удалось определить origin');

        const catalog = await kvGetCatalog();
        const products = (catalog?.products || [])
            .filter(product => product?.img && Number(product.imageCount || 0) > 0)
            .sort((a, b) => Number(!!a.outOfStock) - Number(!!b.outOfStock));

        if (!products.length) {
            res.status(200).json({ success: true, migrated: 0, scanned: 0, total: 0 });
            return;
        }

        let cursor = cursorNow % products.length;
        let scanned = 0;
        let migrated = 0;
        let existed = 0;
        const errors = [];

        while (scanned < Math.min(MAX_SCAN_PER_RUN, products.length) && migrated < BATCH_SIZE) {
            const product = products[cursor];
            cursor = (cursor + 1) % products.length;
            scanned++;

            const existing = await kvGetJson(blobCacheKey(product)).catch(() => null);
            if (validBlobEntry(existing, product)) {
                existed++;
                continue;
            }

            try {
                const result = await migrateOne(origin, product);
                if (result.status === 'migrated') migrated++;
                else if (result.status === 'exists') existed++;
            } catch (e) {
                errors.push({ id: product.id, error: String(e?.message || e).slice(0, 180) });
            }

            // Намеренно последовательно и с паузой: нагрузка на МойСклад
            // получается крошечной даже во время первичного переноса каталога.
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await kvSetJson(CURSOR_KEY, cursor);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            success: true,
            blobConfigured: true,
            migrated,
            alreadyStored: existed,
            scanned,
            totalProductsWithImages: products.length,
            nextCursor: cursor,
            errors: errors.slice(0, 5)
        });
    } catch (e) {
        console.error('[migrate-product-images]', e?.message, e?.stack);
        res.status(500).json({ success: false, error: e.message });
    }
}
