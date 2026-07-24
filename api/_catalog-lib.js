// Общий модуль: поход в МойСклад + работа с Vercel KV.
// Имя файла начинается с "_" — Vercel не создаёт для него отдельный API-роут,
// это просто общий код, который импортируют остальные эндпоинты.

// Токен НЕ хранится в коде — он задаётся в переменных окружения:
// Vercel → Project → Environments → Environment Variables → MY_SKLAD_TOKEN
const MY_SKLAD_TOKEN = process.env.MY_SKLAD_TOKEN;
if (!MY_SKLAD_TOKEN) {
    throw new Error('Не задана переменная окружения MY_SKLAD_TOKEN — добавьте её в настройках проекта на Vercel и сделайте Redeploy');
}

export const API = "https://api.moysklad.ru/api/remap/1.2";
const HEADERS = {
    "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
    "Content-Type": "application/json"
};

const CATALOG_KEY = 'catalog:v1';

// Дата "первого появления" каждого товара: { productId: timestampMs }.
// У товара в МойСклад НЕТ поля created — только updated, поэтому "новинки"
// мы определяем сами: когда товар впервые попал в синхронизацию.
//
// При самом первом запуске (карты в KV ещё нет) все существующие товары
// записываются с меткой BASELINE (0) — они считаются "старыми" и НЕ попадают
// в новинки. Новинками становятся только товары, появившиеся ПОСЛЕ этого.
const FIRST_SEEN_KEY = 'product-first-seen:v1';
const BASELINE = 0;

const NEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

// =====================================================================
// Vercel KV (Upstash) через REST API напрямую, без доп. npm-пакетов.
// Переменные подставляются автоматически при подключении хранилища,
// проверяем оба варианта названий (старый бренд KV и новый Upstash).
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
// Держим большой запас, потому что на Vercel одновременно может работать
// несколько инстансов функции, и каждый лимитирует только себя.
// =====================================================================
const MS_MAX_CONCURRENT = 2;      // одновременных запросов из этого инстанса
const MS_MIN_INTERVAL_MS = 120;   // пауза между стартами запросов (~8/сек)

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

// Единственная точка входа для ВСЕХ запросов к МойСклад (GET/POST/PUT).
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
        let waitMs = 2000 * attempt; // прогрессивная пауза: 2с, 4с, 6с...
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
        } catch (e) {
            // тело не JSON — оставляем detail пустым
        }
        throw new Error(`Склад ответил статусом ${response.status} при запросе ${url}${detail ? ` — ${detail}` : ''}`);
    }
    return response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// Тяжёлая загрузка каталога из МойСклад. Вызывается из /api/sync-catalog
// по расписанию, а не при каждом заходе пользователя.
// =====================================================================
export async function loadCatalogData() {
    const [productRows, folderRows, stockRows, firstSeenStored] = await Promise.all([
        fetchAllRows(`${API}/entity/product?limit=1000&filter=archived=false`),
        fetchAllRows(`${API}/entity/productfolder?limit=1000`),
        fetchAllRows(`${API}/report/stock/all?limit=1000`).catch(() => []),
        kvGetJson(FIRST_SEEN_KEY)
    ]);

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        if (id) stockById[id] = row.stock ?? 0;
    });
    // Если отчёт по остаткам целиком пуст — значит "не знаем остатки", а не "у всех ноль".
    const stockReportHasData = stockRows.length > 0;

    const now = Date.now();

    // Первый запуск: карты ещё нет → все текущие товары помечаем как BASELINE ("старые").
    // Со второго запуска: неизвестные товары получают текущую дату и становятся новинками.
    const isFirstRun = !firstSeenStored;
    const firstSeen = firstSeenStored || {};
    const updatedFirstSeen = {};

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
        // Переносим в новую карту только актуальные товары — так карта
        // не разрастается от давно удалённых/архивных позиций.
        updatedFirstSeen[product.id] = seenAt;

        const isNew = seenAt !== BASELINE && (now - seenAt) < NEW_THRESHOLD_MS;

        return {
            ...product,
            folderId,
            outOfStock: stock === null ? false : stock <= 0,
            isNew
        };
    });

    // Сохраняем карту "первого появления". Если сохранить не вышло — не страшно,
    // при следующей синхронизации логика отработает заново.
    await kvSetJson(FIRST_SEEN_KEY, updatedFirstSeen);

    const categories = buildCategoryTree(folderRows);
    return { products, categories };
}

function extractId(href) {
    if (!href) return null;
    return href.split('/').pop().split('?')[0];
}

// Пагинацию грузим строго последовательно — скорость обеспечивает троттлер,
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

// Категории на главной странице = дочерние папки "Katalog" (Жевательный табак, Жидкости, ...)
// ПЛЮС остальные папки верхнего уровня (Аксессуары, Кальяны, Уголь, Чаши и т.д.),
// ИСКЛЮЧАЯ саму "Katalog", "SALE (Распродажа)" и "Электронки".
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
