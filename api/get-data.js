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
        // Товары: только НЕ архивные (архивные в бота вообще не должны попадать).
        // Категории и остатки запрашиваем параллельно.
        const [productsRes, foldersRes, stockRes] = await Promise.all([
            fetch(`${API}/entity/product?limit=20&expand=images&filter=archived=false`, { headers }),
            fetch(`${API}/entity/productfolder?limit=100`, { headers }),
            fetch(`${API}/report/stock/all?limit=1000`, { headers })
        ]);

        if (!productsRes.ok) {
            return res.status(productsRes.status).json({ error: `Склад ответил статусом ${productsRes.status} (товары)` });
        }
        if (!foldersRes.ok) {
            return res.status(foldersRes.status).json({ error: `Склад ответил статусом ${foldersRes.status} (категории)` });
        }

        const productsData = await productsRes.json();
        const foldersData = await foldersRes.json();
        // Отчёт по остаткам не критичен — если он вдруг недоступен, просто считаем,
        // что остатков нет данных (и не проставляем "нет в наличии" всем подряд).
        const stockData = stockRes.ok ? await stockRes.json() : { rows: [] };

        const stockById = {};
        (stockData.rows || []).forEach(row => {
            const href = row.meta?.href || '';
            const id = href ? href.split('/').pop() : null;
            if (id) stockById[id] = row.stock ?? 0;
        });

        // Привязываем товар к категории по ссылке productFolder,
        // и помечаем "нет в наличии", если остаток по складу равен 0.
        const products = (productsData.rows || []).map(product => {
            const folderHref = product.productFolder?.meta?.href || '';
            const folderId = folderHref ? folderHref.split('/').pop() : null;
            const stock = stockById.hasOwnProperty(product.id) ? stockById[product.id] : null;
            return {
                ...product,
                folderId,
                outOfStock: stock !== null ? stock <= 0 : false
            };
        });

        const categories = buildCategoryTree(foldersData.rows || []);

        return res.status(200).json({ products, categories });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

function getParentFolderId(folder) {
    const href = folder.productFolder?.meta?.href || '';
    return href ? href.split('/').pop() : null;
}

// Берём только категории, лежащие внутри папки "Katalog" в МойСклад,
// и строим по ним двухуровневое дерево: категория -> подкатегории.
function buildCategoryTree(allFolders) {
    const katalogFolder = allFolders.find(
        f => (f.name || '').trim().toLowerCase() === 'katalog'
    );
    if (!katalogFolder) return [];

    const topFolders = allFolders.filter(f => getParentFolderId(f) === katalogFolder.id);

    return topFolders.map(top => {
        const subFolders = allFolders.filter(f => getParentFolderId(f) === top.id);
        return {
            id: top.id,
            name: top.name,
            subcategories: subFolders.map(sub => ({ id: sub.id, name: sub.name }))
        };
    });
}
