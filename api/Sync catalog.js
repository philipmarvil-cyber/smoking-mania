// Этот файл дёргает cron (см. vercel.json) раз в несколько минут — а не пользователь
// при заходе в бота. Здесь можно не торопиться: спокойно сходить в МойСклад,
// собрать весь каталог и сохранить готовый результат в Vercel KV.
// /api/get-data.js после этого просто читает готовые данные оттуда — мгновенно.
import { loadCatalogData, kvSetCatalog } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        const data = await loadCatalogData();
        const saved = await kvSetCatalog({ data, updatedAt: Date.now() });
        return res.status(200).json({
            ok: true,
            saved,
            products: data.products.length,
            categories: data.categories.length,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
}
