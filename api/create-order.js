// Создание заказа покупателя в МойСклад из корзины бота.
// Все запросы идут через fetchJson с троттлингом и ретраями на 429.
import { API, fetchJson, kvGetCatalog, kvSetCatalog } from './_catalog-lib.js';

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

        // 0. Проверяем актуальный остаток по нашему кэшу каталога (тому же,
        // что видит витрина) — чтобы не продать то, что кто-то уже купил
        // секунду назад, до следующей синхронизации с МойСклад.
        const catalog = await kvGetCatalog();
        if (catalog && Array.isArray(catalog.products)) {
            for (const i of items) {
                const product = catalog.products.find(p => p.id === i.id);
                const requestedQty = Math.max(1, parseInt(i.qty, 10) || 1);
                if (product && typeof product.stock === 'number' && product.stock < requestedQty) {
                    res.status(409).json({
                        success: false,
                        error: product.stock > 0
                            ? `«${product.name}» — в наличии осталось только ${product.stock} шт. Обновите корзину.`
                            : `«${product.name}» уже раскупили. Уберите его из корзины.`
                    });
                    return;
                }
            }
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

        // 3. Позиции заказа (цены в МойСклад — в копейках).
        // reserve = quantity — резервируем товар в МойСклад сразу при создании заказа
        // (это равносильно проставлению галки "Резерв" на заказе вручную).
        const positions = items.map(i => {
            const qty = Math.max(1, parseInt(i.qty, 10) || 1);
            return {
                quantity: qty,
                reserve: qty,
                price: Math.round((Number(i.price) || 0) * 100),
                assortment: {
                    meta: {
                        href: `${API}/entity/product/${i.id}`,
                        type: 'product',
                        mediaType: 'application/json'
                    }
                }
            };
        });

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

        // 5. Списываем купленное количество из кэша каталога сразу же —
        // чтобы все пользователи бота мгновенно увидели актуальный остаток
        // и пометку "Нет в наличии", не дожидаясь ночной синхронизации.
        if (catalog && Array.isArray(catalog.products)) {
            items.forEach(i => {
                const product = catalog.products.find(p => p.id === i.id);
                if (product && typeof product.stock === 'number') {
                    const qty = Math.max(1, parseInt(i.qty, 10) || 1);
                    product.stock = Math.max(0, product.stock - qty);
                    product.outOfStock = product.stock <= 0;
                }
            });
            await kvSetCatalog(catalog);
        }

        res.status(200).json({ success: true, orderName: order.name });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
