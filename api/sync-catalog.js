// Синхронизация каталога: МойСклад → Vercel KV.
// Запускается кроном (vercel.json) раз в сутки или вручную открытием URL.
import { loadCatalogData, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, notifyRestockedProducts } from './_catalog-lib.js';

const CARD_IMAGE_WIDTH = 640;
const CARD_IMAGE_QUALITY = 82;
const MAX_IMAGES_TO_WARM = 8;
const WARM_START_DEADLINE_MS = 45 * 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getOrigin(req) {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
}

function getFullSourceUrl(product) {
    if (!product?.img) return '';
    return /[?&]size=full(?:&|$)/.test(product.img)
        ? product.img
        : `${product.img}${product.img.includes('?') ? '&' : '?'}size=full`;
}

function getOptimizedCardPath(product) {
    const source = getFullSourceUrl(product);
    if (!source) return '';
    return `/_vercel/image?url=${encodeURIComponent(source)}&w=${CARD_IMAGE_WIDTH}&q=${CARD_IMAGE_QUALITY}`;
}

// Прогреваем только НОВЫЕ/ИЗМЕНИВШИЕСЯ картинки и только маленькой порцией.
// Один запрос за раз + пауза — даже при полностью холодном кэше каждый товар
// создаёт максимум metadata + binary запрос к МойСклад последовательно, то есть
// мы остаёмся с большим запасом ниже лимита API и не мешаем самой синхронизации.
async function warmChangedCardImages(req, products, oldById, startedAt) {
    const origin = getOrigin(req);
    if (!origin) return { candidates: 0, attempted: 0, warmed: 0 };

    const candidates = products
        .filter(product => product?.img && oldById[product.id]?.imageVersion !== product.imageVersion)
        .sort((a, b) => Number(!!a.outOfStock) - Number(!!b.outOfStock));

    let attempted = 0;
    let warmed = 0;

    for (const product of candidates.slice(0, MAX_IMAGES_TO_WARM)) {
        // Не рискуем упереться в 60-секундный лимит sync-catalog.
        if (Date.now() - startedAt >= WARM_START_DEADLINE_MS) break;

        const path = getOptimizedCardPath(product);
        if (!path) continue;
        attempted++;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
            const response = await fetch(`${origin}${path}`, {
                headers: { Accept: 'image/webp,image/*;q=0.8,*/*;q=0.5' },
                signal: controller.signal
            });
            if (response.ok) warmed++;
        } catch (e) {
            console.warn('[sync-catalog] image warm skipped:', product.id, e?.message);
        } finally {
            clearTimeout(timer);
        }

        // Намеренно не запускаем прогрев параллельно: это защита лимита МойСклад.
        await sleep(500);
    }

    return { candidates: candidates.length, attempted, warmed };
}

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
        const imageWarm = await warmChangedCardImages(req, data.products, oldById, startedAt);

        res.status(200).json({
            success: true,
            savedToKv: true,
            products: data.products.length,
            categories: data.categories.length,
            newItems: data.products.filter(p => p.isNew).length,
            restockedProducts: restockedCount,
            restockNotificationsSent: notified,
            imageWarmCandidates: imageWarm.candidates,
            imageWarmAttempted: imageWarm.attempted,
            imageWarmed: imageWarm.warmed,
            durationMs: Date.now() - startedAt
        });
    } catch (e) {
        console.error('[sync-catalog] ошибка синхронизации:', e?.message, e?.stack);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        await kvSetJson(lockKey, 0).catch(() => {});
    }
}
