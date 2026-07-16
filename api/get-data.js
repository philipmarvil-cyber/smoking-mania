export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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
        const productRows = await fetchAllRows(
            `${API}/entity/product?limit=100&expand=images&filter=archived=false`,
            headers
        );
        const folderRows = await fetchAllRows(`${API}/entity/productfolder?limit=1000`, headers);

        // Отчёт по остаткам не критичен для работы бота — если он вдруг недоступен,
        // просто не проставляем "нет в наличии" никому, вместо того чтобы падать целиком.
        let stockRows = [];
        try {
            stockRows = await fetchAllRows(`${API}/report/stock/all?limit=1000`, headers);
        } catch (e) {
            stockRows = [];
        }

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

// Проходит по всем страницам списка (используя meta.nextHref), пока не соберёт все строки.
async function fetchAllRows(url, headers) {
    let rows = [];
    let nextUrl = url;
    while (nextUrl) {
        const response = await fetch(nextUrl, { headers });
        if (!response.ok) {
            throw new Error(`Склад ответил статусом ${response.status} при запросе ${nextUrl}`);
        }
        const data = await response.json();
        rows = rows.concat(data.rows || []);
        nextUrl = data.meta && data.meta.nextHref ? data.meta.nextHref : null;
    }
    return rows;
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
