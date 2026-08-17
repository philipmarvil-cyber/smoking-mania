// Синхронизация каталога: МойСклад → Vercel KV.
// Запускается кроном (vercel.json) раз в сутки или вручную открытием URL.
import { loadCatalogData, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, notifyRestockedProducts } from './_catalog-lib.js';

export default async function handler(req, res) {
    // Ручной запуск из админки — только с ADMIN_PANEL_KEY. GET оставлен для
    // существующего Vercel Cron и старых служебных вызовов.
    if (req.method === 'POST') {
        const requiredKey = process.env.ADMIN_PANEL_KEY;
        if (!requiredKey || req.query?.key !== requiredKey) {
            res.status(403).json({ success: false, error: 'Неверный ключ администратора' });
            return;
        }
    } else if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Метод не поддерживается' });
        return;
    }

    const lockKey = 'catalog-full-sync-lock:v1';
    const startedAt = Date.now();
    try {
        // Защищаем МойСклад от двойного ручного клика/совпадения с cron.
        // Lock сам протухает через 2 минуты, даже если Vercel оборвёт функцию.
        const activeSince = Number(await kvGetJson(lockKey)) || 0;
        if (activeSince && Date.now() - activeSince < 2 * 60 * 1000) {
            res.status(409).json({
                success: false,
                busy: true,
                error: 'Синхронизация уже запущена. Подождите немного и обновите статус.'
            });
            return;
        }
        await kvSetJson(lockKey, startedAt);

        const oldCatalog = await kvGetCatalog();
        const oldById = {};
        if (oldCatalog && Array.isArray(oldCatalog.products)) {
            oldCatalog.products.forEach(p => { oldById[p.id] = p; });
        }

        const data = await loadCatalogData();
        const saved = await kvSetCatalog({ ...data, syncedAt: Date.now() });
        if (!saved) throw new Error('Не удалось сохранить обновлённый каталог в KV');

        const { restockedCount, notified } = await notifyRestockedProducts(oldById, data.products);

        res.status(200).json({
            success: true,
            savedToKv: true,
            products: data.products.length,
            categories: data.categories.length,
            newItems: data.products.filter(p => p.isNew).length,
            restockedProducts: restockedCount,
            restockNotificationsSent: notified,
            durationMs: Date.now() - startedAt
        });
    } catch (e) {
        console.error('[sync-catalog] ошибка синхронизации:', e?.message, e?.stack);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        await kvSetJson(lockKey, 0).catch(() => {});
    }
}
