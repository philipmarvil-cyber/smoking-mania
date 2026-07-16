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
        // ВАЖНО: если используется expand, МойСклад требует limit <= 100,
        // иначе expand молча игнорируется и фото пропадают. Поэтому здесь limit=100,
        // а за все товары (если их больше) отвечает постраничный обход через nextHref.
        //
        // Все три запроса независимы друг от друга — раньше они шли по очереди
        // (сначала товары, потом категории, потом остатки), из-за чего при большом
        // каталоге загрузка растягивалась на сумму времени всех трёх запросов.
        // Теперь они уходят параллельно, и общее время — это время самого медленного из них.
        const [productRows, folderRows, stockRows] = await Promise.all([
            fetchAllRows(`${API}/entity/product?limit=100&expand=images&filter=archived=false`, headers),
            fetchAllRows(`${API}/entity/productfolder?limit=1000`, headers),
            // Отчёт по остаткам не критичен для работы бота — если он вдруг недоступен
            // или МойСклад ответит ошибкой, просто не проставляем "нет в наличии" никому,
            // вместо того чтобы ронять всю загрузку целиком.
            fetchAllRows(`${API}/report/stock/all?limit=1000`, headers).catch(() => [])
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

        return res.status(200).json({ products, categories });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Убирает query-параметры (?expand=...) из хвоста ссылки, чтобы корректно достать чистый id.
function extractId(href) {
    if (!href) return null;
    return href.split('/').pop().split('?')[0];
}

// Забирает первую страницу, узнаёт из неё общее количество (meta.size),
// а остальные страницы (если они есть) запрашивает параллельно, а не по очереди —
// это и есть основной выигрыш в скорости при большом каталоге.
async function fetchAllRows(url, headers) {
    const first = await fetchJson(url, headers);
    let rows = first.rows || [];
    const meta = first.meta;

    if (meta && typeof meta.size === 'number' && typeof meta.limit === 'number' && meta.size > rows.length) {
        const pageCount = Math.ceil(meta.size / meta.limit);
        const pagePromises = [];
        for (let page = 1; page < pageCount; page++) {
            pagePromises.push(fetchJson(withOffset(url, page * meta.limit), headers));
        }
        const pages = await Promise.all(pagePromises);
        pages.forEach(p => { rows = rows.concat(p.rows || []); });
    }

    return rows;
}

async function fetchJson(url, headers) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`Склад ответил статусом ${response.status} при запросе ${url}`);
    }
    return response.json();
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
