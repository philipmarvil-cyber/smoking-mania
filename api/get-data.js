// Отдаёт каталог фронтенду. Обычная загрузка читает готовый каталог из KV
// и НЕ ждёт живого запроса к МойСклад. Обновление остатков запускается
// отдельно через ?refresh=1 уже после первого рендера интерфейса.
import { kvGetCatalog, kvSetCatalog, loadCatalogData, refreshAllStock } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        let catalog = await kvGetCatalog();
        let isColdStart = false;

        if (!catalog) {
            // Холодный старт: кэша ещё нет. Только в этом редком случае нужна
            // тяжёлая загрузка из МойСклад до ответа пользователю.
            isColdStart = true;
            catalog = await loadCatalogData();
            await kvSetCatalog({ ...catalog, syncedAt: Date.now() });
        }

        // Важно для скорости: обычный /api/get-data сразу отдаёт KV.
        // Клиент вызывает refresh=1 уже после того, как каталог показан.
        // refreshAllStock сам защищён 3-минутным cooldown, так что несколько
        // пользователей не создадут шквал запросов к МойСклад.
        if (!isColdStart && req.query.refresh === '1') {
            const refreshed = await refreshAllStock().catch(() => false);
            if (refreshed) catalog = await kvGetCatalog();
        }

        res.setHeader(
            'Cache-Control',
            req.query.refresh === '1'
                ? 'no-store'
                : 'public, max-age=15, s-maxage=30, stale-while-revalidate=120'
        );
        res.status(200).json({
            products: catalog.products || [],
            categories: catalog.categories || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
