// Общий модуль: поход в МойСклад + работа с Vercel KV.
// Имя файла начинается с "_" — Vercel не создаёт для него отдельный API-роут.

const MY_SKLAD_TOKEN = process.env.MY_SKLAD_TOKEN;
if (!MY_SKLAD_TOKEN) {
    throw new Error('Не задана переменная окружения MY_SKLAD_TOKEN — добавьте её в настройках проекта на Vercel и сделайте Redeploy');
}

export const API = "https://api.moysklad.ru/api/remap/1.2";
const HEADERS = {
    "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
    "Content-Type": "application/json"
};

const CATALOG_KEY = 'catalog:v2'; // v2 — формат стал компактным (только нужные поля)

// Дата "первого появления" каждого товара: { productId: timestampMs }.
// При самом первом запуске все существующие товары получают метку BASELINE (0)
// и не считаются новинками. Новинки — только то, что появилось после.
const FIRST_SEEN_KEY = 'product-first-seen:v1';
const BASELINE = 0;

const NEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

// =====================================================================
// Vercel KV (Upstash) через REST API напрямую, без доп. npm-пакетов.
// =====================================================================
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export async function kvGetJson(key) {
    if (!KV_URL || !KV_TOKEN) return null;
    try {
        const response = await fetch(`${KV_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        if (!response.ok) return null;
        const body = await response.json();
        if (!body.result) return null;
        return JSON.parse(body.result);
    } catch (e) {
        return null;
    }
}

export async function kvSetJson(key, value) {
    if (!KV_URL || !KV_TOKEN) return false;
    try {
        const response = await fetch(`${KV_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_TOKEN}` },
            body: JSON.stringify(value)
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

export async function kvGetCatalog() {
    return kvGetJson(CATALOG_KEY);
}

export async function kvSetCatalog(value) {
    return kvSetJson(CATALOG_KEY, value);
}

// =====================================================================
// Глобальный ограничитель скорости запросов к МойСклад.
// Лимиты склада: 45 запросов / 3 сек, не более 5 параллельных.
// =====================================================================
const MS_MAX_CONCURRENT = 2;
const MS_MIN_INTERVAL_MS = 120; // ~8 запросов/сек с запасом

let msActive = 0;
let msLastStart = 0;
const msQueue = [];

function msAcquire() {
    return new Promise(resolve => {
        msQueue.push(resolve);
        msPump();
    });
}

function msPump() {
    if (!msQueue.length || msActive >= MS_MAX_CONCURRENT) return;
    const wait = Math.max(0, msLastStart + MS_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) { setTimeout(msPump, wait); return; }
    msActive++;
    msLastStart = Date.now();
    msQueue.shift()();
}

function msRelease() {
    msActive--;
    msPump();
}

// Единственная точка входа для ВСЕХ запросов к МойСклад.
// Троттлинг + ретраи на 429 с уважением Retry-After.
export async function fetchJson(url, options = {}, attempt = 1) {
    await msAcquire();
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: { ...HEADERS, ...(options.headers || {}) }
        });
    } finally {
        msRelease();
    }

    if (response.status === 429) {
        if (attempt > 5) {
            throw new Error('Склад отвечает статусом 429 (слишком много запросов) даже после нескольких повторов');
        }
        const lognexRetryMs = response.headers.get('X-Lognex-Retry-After');
        const retryAfterSec = response.headers.get('Retry-After');
        let waitMs = 2000 * attempt;
        if (lognexRetryMs && !isNaN(parseInt(lognexRetryMs, 10))) {
            waitMs = Math.max(waitMs, parseInt(lognexRetryMs, 10));
        } else if (retryAfterSec && !isNaN(parseInt(retryAfterSec, 10))) {
            waitMs = Math.max(waitMs, parseInt(retryAfterSec, 10) * 1000);
        }
        await sleep(waitMs);
        return fetchJson(url, options, attempt + 1);
    }

    if (!response.ok) {
        let detail = '';
        try {
            const body = await response.json();
            detail = body?.errors?.[0]?.error || body?.errors?.[0]?.moreInfo || JSON.stringify(body);
        } catch (e) {}
        throw new Error(`Склад ответил статусом ${response.status} при запросе ${url}${detail ? ` — ${detail}` : ''}`);
    }
    return response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// Тяжёлая загрузка каталога из МойСклад. Вызывается из /api/sync-catalog.
// Товары грузим с expand=images (лимит при expand — 100 на страницу),
// чтобы ссылки на фото попали в каталог сразу и фронту не нужны были
// сотни отдельных запросов за картинками.
// =====================================================================
export async function loadCatalogData() {
    const [productRows, folderRows, stockRows, firstSeenStored] = await Promise.all([
        fetchAllRows(`${API}/entity/product?limit=100&expand=images&filter=archived=false`),
        fetchAllRows(`${API}/entity/productfolder?limit=1000`),
        fetchAllRows(`${API}/report/stock/all?limit=1000`).catch(() => []),
        kvGetJson(FIRST_SEEN_KEY)
    ]);

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        if (id) stockById[id] = row.stock ?? 0;
    });
    const stockReportHasData = stockRows.length > 0;

    const now = Date.now();
    const isFirstRun = !firstSeenStored;
    const firstSeen = firstSeenStored || {};
    const updatedFirstSeen = {};

    // Компактный формат: только те поля, которые реально использует фронтенд.
    // Полные объекты МойСклад весят в ~20 раз больше и тормозят загрузку.
    const products = productRows.map(product => {
        const folderId = extractId(product.productFolder?.meta?.href);
        const stock = stockById.hasOwnProperty(product.id)
            ? stockById[product.id]
            : (stockReportHasData ? 0 : null);

        let seenAt;
        if (firstSeen.hasOwnProperty(product.id)) {
            seenAt = firstSeen[product.id];
        } else {
            seenAt = isFirstRun ? BASELINE : now;
        }
        updatedFirstSeen[product.id] = seenAt;

        return {
            id: product.id,
            name: product.name,
            price: (product.salePrices?.[0]?.value || 0) / 100,
            img: product.images?.rows?.[0]?.miniature?.downloadHref || '',
            folderId,
            outOfStock: stock === null ? false : stock <= 0,
            isNew: seenAt !== BASELINE && (now - seenAt) < NEW_THRESHOLD_MS
        };
    });

    await kvSetJson(FIRST_SEEN_KEY, updatedFirstSeen);

    const categories = buildCategoryTree(folderRows);
    return { products, categories };
}

function extractId(href) {
    if (!href) return null;
    return href.split('/').pop().split('?')[0];
}

// Страницы грузим последовательно — скорость дозирует троттлер,
// а синхронизация раз в сутки может позволить себе быть небыстрой.
const PAGE_CONCURRENCY = 1;

async function fetchAllRows(url) {
    const first = await fetchJson(url);
    let rows = first.rows || [];
    const meta = first.meta;

    if (meta && typeof meta.size === 'number' && typeof meta.limit === 'number' && meta.size > rows.length) {
        const pageCount = Math.ceil(meta.size / meta.limit);
        const pageUrls = [];
        for (let page = 1; page < pageCount; page++) {
            pageUrls.push(withOffset(url, page * meta.limit));
        }
        const pages = await fetchWithLimitedConcurrency(pageUrls, PAGE_CONCURRENCY);
        pages.forEach(p => { rows = rows.concat(p.rows || []); });
    }

    return rows;
}

async function fetchWithLimitedConcurrency(urls, concurrency) {
    const results = new Array(urls.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < urls.length) {
            const current = nextIndex++;
            results[current] = await fetchJson(urls[current]);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

function withOffset(url, offset) {
    const u = new URL(url);
    u.searchParams.set('offset', String(offset));
    return u.toString();
}

function getParentFolderId(folder) {
    return extractId(folder.productFolder?.meta?.href);
}

function normalizeName(name) {
    return (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildCategoryTree(allFolders) {
    const EXCLUDED_NAMES = ['katalog', 'sale (распродажа)', 'электронки'];

    const katalogFolder = allFolders.find(f => normalizeName(f.name) === 'katalog');

    const katalogChildren = katalogFolder
        ? allFolders.filter(f => getParentFolderId(f) === katalogFolder.id)
        : [];

    const rootFolders = allFolders.filter(f => getParentFolderId(f) === null);
    const otherTopFolders = rootFolders.filter(f => !EXCLUDED_NAMES.includes(normalizeName(f.name)));

    const displayFolders = [...katalogChildren, ...otherTopFolders];

    return displayFolders.map(cat => {
        const subFolders = allFolders.filter(f => getParentFolderId(f) === cat.id);
        return {
            id: cat.id,
            name: cat.name,
            subcategories: subFolders.map(sub => ({ id: sub.id, name: sub.name }))
        };
    });
}
