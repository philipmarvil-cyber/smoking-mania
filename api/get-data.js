// Больше НЕ ходит в МойСклад напрямую при каждом заходе пользователя в бота —
// это и было причиной долгой загрузки/429/таймаутов при большом каталоге.
// Теперь просто читает уже готовые данные, которые в фоне (по расписанию, см. vercel.json
// и sync-catalog.js) заранее сложил туда /api/sync-catalog. Поэтому ответ почти мгновенный.
import { loadCatalogData, kvGetCatalog, kvSetCatalog } from './_catalog-lib.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const cached = await kvGetCatalog();
        if (cached && cached.data) {
            res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
            return res.status(200).json(cached.data);
        }

        // Кэш пуст — это бывает только один раз, до первого срабатывания фонового
        // обновления (/api/sync-catalog). В этот единственный раз считаем каталог
        // прямо сейчас (это может занять время) и сразу сохраняем в кэш на будущее.
        res.setHeader('Cache-Control', 'no-store');
        const data = await loadCatalogData();
        kvSetCatalog({ data, updatedAt: Date.now() }).catch(() => {});
        return res.status(200).json(data);
    } catch (error) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ error: error.message });
    }
}
