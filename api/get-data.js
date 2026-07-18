export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Кэшируем ответ на 30 секунд на уровне Vercel/CDN — при большом каталоге это сильно
    // ускоряет повторные открытия бота разными людьми в течение этого окна, а через
    // 30-150 сек данные в любом случае обновятся сами (МойСклад пересчитывать не нужно каждый раз).
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9";
    const API = "https://api.moysklad.ru/api/remap/1.2";
    const headers = {
        "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    try {
        // Вся загрузка ограничена собственным таймаутом (см. ниже) — если МойСклад
        // отвечает аномально долго (ограничение частоты запросов, огромный каталог и т.п.),
        // мы сами вернём понятную JSON-ошибку раньше, чем платформа (Vercel) прибьёт функцию
        // по своему таймауту и отдаст свою страницу ошибки (не-JSON), которую фронтенд не может разобрать.
        const data = await withTimeout(
            loadCatalogData(API, headers),
            8500,
            null
        );

        if (data === null) {
            return res.status(200).json({ error: 'МойСклад отвечает слишком долго. Попробуйте открыть каталог ещё раз через несколько секунд.' });
        }

        return res.status(200).json(data);
    } catch (error) {
        return res.status(200).json({ error: error.message });
    }
}

async function loadCatalogData(API, headers) {
    // ВАЖНО: если используется expand, МойСклад требует limit <= 100,
    // иначе expand молча игнорируется и фото пропадают. Поэтому здесь limit=100,
    // а за все товары (если их больше) отвечает постраничный обход через nextHref.
    //
    // Все три запроса независимы друг от друга и уходят параллельно — общее время
    // это время самого медленного из них, а не сумма всех трёх.
    const [productRows, folderRows, stockRows] = await Promise.all([
        fetchAllRows(`${API}/entity/product?limit=100&expand=images&filter=archived=false`, headers),
        fetchAllRows(`${API}/entity/productfolder?limit=1000`, headers),
        // Отчёт по остаткам может быть намного больше, чем сами товары (учитывает историю,
        // склады и т.д.), и иногда упирается в лимит запросов МойСклад, из-за чего ждать его
        // целиком может занимать очень много времени. Он не критичен для работы бота —
        // если он не успел за 3 секунды, просто продолжаем без пометки "нет в наличии",
        // а не держим всю загрузку сайта из-за одного медленного отчёта.
        withTimeout(
            fetchAllRows(`${API}/report/stock/all?limit=1000`, headers).catch(() => []),
            3000,
            []
        )
    ]);

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        if (id) stockById[id] = row.stock ?? 0;
    });

    // Привязываем товар к категории по ссылке productFolder,
    // помечаем "нет в наличии" при нулевом остатке,
    // и отмечаем как новинку, если товар СОЗДАН (не отредактирован) в МойСклад недавно.
    const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
    const now = Date.now();
    const products = productRows.map(product => {
        const folderId = extractId(product.productFolder?.meta?.href);
        const stock = stockById.hasOwnProperty(product.id) ? stockById[product.id] : 0;
        const createdTime = product.created ? new Date(product.created).getTime() : null;
        const isNew = createdTime !== null && (now - createdTime) < NEW_THRESHOLD_MS;
        return {
            ...product,
            folderId,
            outOfStock: stock <= 0,
            isNew
        };
    });

    const categories = buildCategoryTree(folderRows);

    return { products, categories };
}

// Убирает query-параметры (?expand=...) из хвоста ссылки, чтобы корректно достать чистый id.
function extractId(href) {
    if (!href) return null;
    return href.split('/').pop().split('?')[0];
}

// Забирает первую страницу, узнаёт из неё общее количество (meta.size),
// а остальные страницы (если они есть) запрашивает параллельно, но НЕ ВСЕ СРАЗУ —
// МойСклад ограничивает число запросов в секунду (отсюда была ошибка 429), поэтому
// параллельность страниц одного запроса ограничена небольшим пулом.
const PAGE_CONCURRENCY = 2;

async function fetchAllRows(url, headers) {
    const first = await fetchJson(url, headers);
    let rows = first.rows || [];
    const meta = first.meta;

    if (meta && typeof meta.size === 'number' && typeof meta.limit === 'number' && meta.size > rows.length) {
        const pageCount = Math.ceil(meta.size / meta.limit);
        const pageUrls = [];
        for (let page = 1; page < pageCount; page++) {
            pageUrls.push(withOffset(url, page * meta.limit));
        }
        const pages = await fetchWithLimitedConcurrency(pageUrls, headers, PAGE_CONCURRENCY);
        pages.forEach(p => { rows = rows.concat(p.rows || []); });
    }

    return rows;
}

// Обходит список URL пулом из `concurrency` одновременных запросов вместо того,
// чтобы стрелять всеми сразу (что и приводило к 429 — "слишком много запросов").
async function fetchWithLimitedConcurrency(urls, headers, concurrency) {
    const results = new Array(urls.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < urls.length) {
            const current = nextIndex++;
            results[current] = await fetchJson(urls[current], headers);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// Делает запрос с автоматическим повтором при 429 (слишком много запросов),
// выжидая время, которое МойСклад просит подождать (заголовок Retry-After / X-Lognex-Retry-After),
// либо разумную паузу с нарастанием, если заголовка нет.
async function fetchJson(url, headers, attempt = 1) {
    const response = await fetch(url, { headers });

    if (response.status === 429) {
        if (attempt > 3) {
            throw new Error('Склад отвечает статусом 429 (слишком много запросов) даже после нескольких повторов');
        }
        const lognexRetryMs = response.headers.get('X-Lognex-Retry-After');
        const retryAfterSec = response.headers.get('Retry-After');
        let waitMs = 500 * attempt; // запасной вариант с нарастанием, если МойСклад не подсказал время
        if (lognexRetryMs && !isNaN(parseInt(lognexRetryMs, 10))) {
            waitMs = parseInt(lognexRetryMs, 10);
        } else if (retryAfterSec && !isNaN(parseInt(retryAfterSec, 10))) {
            waitMs = parseInt(retryAfterSec, 10) * 1000;
        }
        await sleep(waitMs);
        return fetchJson(url, headers, attempt + 1);
    }

    if (!response.ok) {
        throw new Error(`Склад ответил статусом ${response.status} при запросе ${url}`);
    }
    return response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Ждёт промис не дольше `ms` миллисекунд — если он не успел, возвращает `fallback`
// вместо того, чтобы держать весь ответ из-за одного медленного запроса.
function withTimeout(promise, ms, fallback) {
    return Promise.race([
        promise,
        sleep(ms).then(() => fallback)
    ]);
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
// ИСКЛЮЧАЯ саму "Katalog" (это просто технический контейнер), "SALE (Распродажа)" и "Электронки".
// Для каждой такой категории отдельно считаем её собственные подпапки — это категории второго уровня,
// которые показываются уже на отдельной странице после клика.
function buildCategoryTree(allFolders) {
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
