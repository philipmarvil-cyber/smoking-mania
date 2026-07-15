export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9";
    const headers = {
        "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    try {
        // Товары: expand=images подтягивает фото, filter=archived=true;archived=false
        // просит склад отдать И архивные, И обычные товары (по умолчанию архивные скрыты).
        // Категории: отдельный справочник "Группы товаров" (productfolder).
        const [productsRes, foldersRes] = await Promise.all([
            fetch("https://api.moysklad.ru/api/remap/1.2/entity/product?limit=20&expand=images&filter=archived=true;archived=false", { headers }),
            fetch("https://api.moysklad.ru/api/remap/1.2/entity/productfolder?limit=100", { headers })
        ]);

        if (!productsRes.ok) {
            return res.status(productsRes.status).json({ error: `Склад ответил статусом ${productsRes.status} (товары)` });
        }
        if (!foldersRes.ok) {
            return res.status(foldersRes.status).json({ error: `Склад ответил статусом ${foldersRes.status} (категории)` });
        }

        const productsData = await productsRes.json();
        const foldersData = await foldersRes.json();

        // Привязываем товар к категории по ссылке productFolder, и явно помечаем,
        // что товар архивный (использует фронтенд для метки "Нет в наличии").
        const products = (productsData.rows || []).map(product => {
            const folderHref = product.productFolder?.meta?.href || '';
            const folderId = folderHref ? folderHref.split('/').pop() : null;
            return {
                ...product,
                folderId,
                outOfStock: !!product.archived
            };
        });

        const categories = (foldersData.rows || []).map(folder => ({
            id: folder.id,
            name: folder.name
        }));

        return res.status(200).json({ products, categories });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
