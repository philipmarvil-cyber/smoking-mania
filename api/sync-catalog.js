// Синхронизация каталога: МойСклад → Vercel KV.
// Запускается кроном (vercel.json) раз в сутки или вручную открытием URL.
import { loadCatalogData, kvGetCatalog, kvSetCatalog, notifyRestockedProducts } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        const oldCatalog = await kvGetCatalog();
        const oldById = {};
        if (oldCatalog && Array.isArray(oldCatalog.products)) {
            oldCatalog.products.forEach(p => { oldById[p.id] = p; });
        }

        const data = await loadCatalogData();
        const saved = await kvSetCatalog({ ...data, syncedAt: Date.now() });

        // Товар, который был "нет в наличии", а теперь снова есть —
        // разослать всем, кто нажимал "Уведомить о поступлении".
        const { restockedCount, notified } = await notifyRestockedProducts(oldById, data.products);

        res.status(200).json({
            success: true,
            savedToKv: saved,
            products: data.products.length,
            categories: data.categories.length,
            newItems: data.products.filter(p => p.isNew).length,
            restockedProducts: restockedCount,
            restockNotificationsSent: notified
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
