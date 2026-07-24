// Создание заказа покупателя в МойСклад из корзины бота.
// Все запросы идут через fetchJson с троттлингом и ретраями на 429.
import { API, fetchJson } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    try {
        const { items, customerName, phone } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            res.status(400).json({ success: false, error: 'Корзина пуста' });
            return;
        }
        if (!phone) {
            res.status(400).json({ success: false, error: 'Не указан телефон' });
            return;
        }

        // 1. Организация (берём первую)
        const orgData = await fetchJson(`${API}/entity/organization?limit=1`);
        const organization = orgData?.rows?.[0];
        if (!organization) throw new Error('В МойСклад не найдена организация');

        // 2. Контрагент: ищем по телефону, если нет — создаём
        const cleanPhone = String(phone).replace(/[^\d+]/g, '');
        const search = await fetchJson(
            `${API}/entity/counterparty?filter=phone=${encodeURIComponent(cleanPhone)}&limit=1`
        );
        let agent = search?.rows?.[0];
        if (!agent) {
            agent = await fetchJson(`${API}/entity/counterparty`, {
                method: 'POST',
                body: JSON.stringify({
                    name: `${customerName || 'Клиент Telegram'} (${cleanPhone})`,
                    phone: cleanPhone
                })
            });
        }

        // 3. Позиции заказа (цены в МойСклад — в копейках)
        const positions = items.map(i => ({
            quantity: Math.max(1, parseInt(i.qty, 10) || 1),
            price: Math.round((Number(i.price) || 0) * 100),
            assortment: {
                meta: {
                    href: `${API}/entity/product/${i.id}`,
                    type: 'product',
                    mediaType: 'application/json'
                }
            }
        }));

        // 4. Заказ покупателя
        const order = await fetchJson(`${API}/entity/customerorder`, {
            method: 'POST',
            body: JSON.stringify({
                organization: { meta: organization.meta },
                agent: { meta: agent.meta },
                positions,
                description: `Заказ из Telegram-бота.\nКлиент: ${customerName || '—'}\nТелефон: ${cleanPhone}`
            })
        });

        res.status(200).json({ success: true, orderName: order.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
