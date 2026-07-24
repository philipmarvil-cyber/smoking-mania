// Синхронизация каталога: МойСклад → Vercel KV.
// Запускается кроном (vercel.json) раз в сутки или вручную открытием URL.
import { loadCatalogData, kvSetCatalog } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        const data = await loadCatalogData();
        const saved = await kvSetCatalog({ ...data, syncedAt: Date.now() });
        res.status(200).json({
            success: true,
            savedToKv: saved,
            products: data.products.length,
            categories: data.categories.length,
            newItems: data.products.filter(p => p.isNew).length
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
