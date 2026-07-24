// Общий модуль: поход в МойСклад + работа с Vercel KV.
// Имя файла начинается с "_" — Vercel не создаёт для него отдельный API-роут,
// это просто общий код, который импортируют get-data.js и sync-catalog.js.

// Токен НЕ хранится в коде — он задаётся в переменных окружения:
// Vercel → Project → Environments → Environment Variables → MY_SKLAD_TOKEN
const MY_SKLAD_TOKEN = process.env.MY_SKLAD_TOKEN;
if (!MY_SKLAD_TOKEN) {
    throw new Error('Не задана переменная окружения MY_SKLAD_TOKEN — добавьте её в настройках проекта на Vercel и сделайте Redeploy');
}

const API = "https://api.moysklad.ru/api/remap/1.2";
const HEADERS = {
    "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
    "Content-Type": "application/json"
};

const CATALOG_KEY = 'catalog:v1';

// Дата "первого появления" каждого товара: { productId: timestampMs }.
// Нужна, потому что у товара в МойСклад НЕТ поля created — только updated,
// поэтому "новинки" мы определяем сами: когда товар впервые попал в синхронизацию.
//
// ВАЖНО: при самом первом запуске (карта в KV ещё пуста) все существующие
// товары записываются со специальной меткой BASELINE (0) — они считаются
// "старыми" и НЕ попадают в новинки. Новинками становятся только товары,
// которые появились на складе ПОСЛЕ первого запуска.
const FIRST_SEEN_KEY = 'product-first-seen:v1';
const BASELINE = 0; // метка "товар существовал до первого запуска — не новинка"

const NEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

// --- Vercel KV через его REST API напрямую, без доп. npm-пакетов ---
// Переменные KV_REST_API_URL и KV_REST_API_TOKEN подставляются автоматически,
// когда в настройках проекта на vercel.com подключено хранилище KV.
// Vercel в 2024 свернул старый бренд "Vercel KV" в пользу Upstash — переменные окружения
// могут называться и по-старому (KV_REST_API_URL), и по-новому (UPSTASH_REDIS_REST_URL),
// поэтому проверяем оба варианта, чтобы не зависеть от конкретного названия интеграции.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGetJson(key) {
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

async function kvSetJson(key, value) {
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

// --- Тяжёлая загрузка каталога из МойСклад. Вызывается из /api/sync-catalog по расписанию
// (а не при каждом заходе пользователя в бота), поэтому тут не страшно, если это займёт
// сколько-то секунд — никто в этот момент не ждёт ответа на экране. ---
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
        // Переносим в новую карту только актуальные товары — так карта не разрастается
        // от давно удалённых/архивных позиций.
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

const PAGE_CONCURRENCY = 2;

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

async function fetchJson(url, attempt = 1) {
    const response = await fetch(url, { headers: HEADERS });

    if (response.status === 429) {
        if (attempt > 5) {
            throw new Error('Склад отвечает статусом 429 (слишком много запросов) даже после нескольких повторов');
        }
        const lognexRetryMs = response.headers.get('X-Lognex-Retry-After');
        const retryAfterSec = response.headers.get('Retry-After');
        let waitMs = 1000 * attempt;
        if (lognexRetryMs && !isNaN(parseInt(lognexRetryMs, 10))) {
            waitMs = parseInt(lognexRetryMs, 10);
        } else if (retryAfterSec && !isNaN(parseInt(retryAfterSec, 10))) {
            waitMs = parseInt(retryAfterSec, 10) * 1000;
        }
        await sleep(waitMs);
        return fetchJson(url, attempt + 1);
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
