// Отдаёт каталог фронтенду. Читает ТОЛЬКО из KV — в МойСклад не ходит,
// сколько бы пользователей ни открыло бота одновременно.
// Единственное исключение: KV пустой (самый первый запуск) — тогда один раз
// грузим каталог напрямую, чтобы бот не встречал пользователей пустым экраном.
import { kvGetCatalog, kvSetCatalog, loadCatalogData } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        let catalog = await kvGetCatalog();

        if (!catalog) {
            // Холодный старт: кэша ещё нет. Грузим один раз и сохраняем.
            catalog = await loadCatalogData();
            await kvSetCatalog({ ...catalog, syncedAt: Date.now() });
        }

        // Кэш на CDN Vercel: повторные запросы в течение 5 минут
        // вообще не доходят до функции.
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
        res.status(200).json({
            products: catalog.products || [],
            categories: catalog.categories || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
