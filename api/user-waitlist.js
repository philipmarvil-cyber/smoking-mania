import { kvGetJson } from './_catalog-lib.js';

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
        const log = (await kvGetJson(LOG_KEY)) || [];
        const latestByProduct = new Map();

        // Журнал хранится от новых к старым. Берём последнюю заявку пользователя
        // по каждому товару, а ниже дополнительно проверяем, что подписка всё ещё
        // активна в restock:{productId}. Поэтому уже сработавшие уведомления
        // автоматически исчезают из списка ожидания.
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

        const candidates = [...latestByProduct.values()];
        const activeItems = [];

        // Не создаём сотни параллельных запросов к KV, если у пользователя
        // накопилось много заявок: проверяем небольшими пачками.
        for (let i = 0; i < candidates.length; i += 25) {
            const chunk = candidates.slice(i, i + 25);
            const checked = await Promise.all(chunk.map(async item => {
                const subs = await kvGetJson(`restock:${item.productId}`);
                const active = Array.isArray(subs) && subs.some(id => String(id) === telegramUserId);
                return active ? item : null;
            }));
            activeItems.push(...checked.filter(Boolean));
        }

        activeItems.sort((a, b) => b.at - a.at);
        res.status(200).json({ success: true, items: activeItems });
    } catch (e) {
        console.error('[user-waitlist]', e?.message);
        res.status(500).json({ success: false, error: 'Не удалось загрузить список ожидания' });
    }
}
