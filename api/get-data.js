// Отдаёт каталог фронтенду. Читает В ОСНОВНОМ из KV — в МойСклад по-крупному
// не ходит, сколько бы пользователей ни открыло бота одновременно.
// Единственное исключение: KV пустой (самый первый запуск) — тогда один раз
// грузим каталог напрямую, чтобы бот не встречал пользователей пустым экраном.
import { kvGetCatalog, kvSetCatalog, loadCatalogData, refreshAllStock } from './_catalog-lib.js';

export default async function handler(req, res) {
    try {
        let catalog = await kvGetCatalog();
        let isColdStart = false;

        if (!catalog) {
            // Холодный старт: кэша ещё нет. Грузим один раз и сохраняем.
            isColdStart = true;
            catalog = await loadCatalogData();
            await kvSetCatalog({ ...catalog, syncedAt: Date.now() });
        }

        if (!isColdStart) {
            // Не полагаемся только на вебхук из МойСклад — он не всегда
            // присылается (например, при перемещении заказа в Корзину вместо
            // окончательного удаления МойСклад в части случаев вообще не шлёт
            // событие). Поэтому здесь же, при обычной загрузке каталога,
            // тоже пробуем обновить остатки. Внутри уже стоит защита "не чаще
            // раза в 3 минуты", так что это не создаёт лишней нагрузки —
            // подавляющее большинство запросов эту проверку проходят мгновенно.
            const refreshed = await refreshAllStock().catch(() => false);
            if (refreshed) catalog = await kvGetCatalog();
        }

        // Кэш на CDN Vercel: короткий, чтобы после заказа (списание остатка
        // в create-order.js) все пользователи увидели актуальный остаток
        // почти мгновенно — а не только через 5 минут/час, как было раньше.
        res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
        res.status(200).json({
            products: catalog.products || [],
            categories: catalog.categories || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
