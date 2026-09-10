import { kvGetJson, kvGetCatalog } from './_catalog-lib.js';

const LOG_KEY = 'notify-subs:v1';

function cleanUserId(value) {
    const id = String(value || '').trim();
    return /^\d{1,24}$/.test(id) ? id : '';
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Только GET' });
        return;
    }

    const telegramUserId = cleanUserId(req.query.telegramUserId);
    if (!telegramUserId) {
        res.status(400).json({ success: false, error: 'telegramUserId обязателен' });
        return;
    }

    try {
        const [log, catalog] = await Promise.all([
            kvGetJson(LOG_KEY),
            kvGetCatalog().catch(() => null)
        ]);
        const latestByProduct = new Map();

        // Журнал хранится от новых к старым. Берём последнюю заявку пользователя
        // по каждому товару. Сработавшие заявки больше не удаляем из ответа:
        // если товар уже появился на складе, он остаётся в списке со статусом
        // inStock=true, чтобы клиент увидел, что именно пришло.
        for (const entry of Array.isArray(log) ? log : []) {
            if (cleanUserId(entry?.telegramUserId) !== telegramUserId) continue;
            const productId = String(entry?.productId || '').trim();
            if (!productId || latestByProduct.has(productId)) continue;
            latestByProduct.set(productId, {
                productId,
                productName: String(entry?.productName || productId),
                at: Number(entry?.at) || 0
            });
        }

        const productsById = new Map(
            (Array.isArray(catalog?.products) ? catalog.products : [])
                .map(product => [String(product.id), product])
        );
        const candidates = [...latestByProduct.values()];
        const items = [];

        for (let i = 0; i < candidates.length; i += 25) {
            const chunk = candidates.slice(i, i + 25);
            const checked = await Promise.all(chunk.map(async item => {
                const product = productsById.get(item.productId) || null;
                const subs = await kvGetJson(`restock:${item.productId}`);
                const active = Array.isArray(subs) && subs.some(id => String(id) === telegramUserId);
                const inStock = !!product && !product.outOfStock && !product.archived;

                // Активная заявка всегда остаётся. Уже сработавшую показываем,
                // пока товар реально есть в наличии. Старые неактивные записи,
                // которые снова исчезли со склада, не засоряют список ожидания.
                if (!active && !inStock) return null;
                return {
                    ...item,
                    active,
                    inStock
                };
            }));
            items.push(...checked.filter(Boolean));
        }

        items.sort((a, b) => {
            if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
            return b.at - a.at;
        });
        res.status(200).json({ success: true, items });
    } catch (e) {
        console.error('[user-waitlist]', e?.message);
        res.status(500).json({ success: false, error: 'Не удалось загрузить список ожидания' });
    }
}
