// Создание заказа покупателя в МойСклад из корзины бота.
// Все запросы идут через fetchJson с троттлингом и ретраями на 429.
import { API, fetchJson, kvGetCatalog, kvSetCatalog, getLiveStock } from './_catalog-lib.js';

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

        // 0. Проверяем остаток. Кэш каталога (тот же, что видит витрина) обновляется
        // раз в сутки плюс мгновенно после заказов через бот — но остаток мог
        // измениться и другим путём (вручную в МойСклад, другой канал продаж),
        // поэтому здесь дополнительно берём ЖИВОЙ остаток прямо со склада —
        // именно он и является финальным решающим числом, кэш используем только
        // как запасной вариант, если запрос к складу не удался.
        const catalog = await kvGetCatalog();
        const productIds = items.map(i => i.id).filter(Boolean);
        let liveStock = {};
        try {
            liveStock = await getLiveStock(productIds);
        } catch (e) {
            liveStock = {}; // не удалось — работаем по кэшу каталога ниже
        }

        for (const i of items) {
            const requestedQty = Math.max(1, parseInt(i.qty, 10) || 1);
            const cachedProduct = catalog && Array.isArray(catalog.products)
                ? catalog.products.find(p => p.id === i.id)
                : null;
            const displayName = cachedProduct?.name || i.name || 'Товар';

            let availableStock = null;
            if (liveStock.hasOwnProperty(i.id)) {
                availableStock = liveStock[i.id];
            } else if (cachedProduct && typeof cachedProduct.stock === 'number') {
                availableStock = cachedProduct.stock;
            }

            if (availableStock !== null && availableStock < requestedQty) {
                res.status(409).json({
                    success: false,
                    error: availableStock > 0
                        ? `«${displayName}» — в наличии осталось только ${availableStock} шт. Обновите корзину.`
                        : `«${displayName}» уже раскупили. Уберите его из корзины.`
                });
                return;
            }
        }

        // 1. Организация (берём первую)
        const orgData = await fetchJson(`${API}/entity/organization?limit=1`);
        const organization = orgData?.rows?.[0];
        if (!organization) throw new Error('В МойСклад не найдена организация');

        // 1а. Склад. Без него резерв на заказе остаётся просто флагом документа
        // и не привязывается к остаткам конкретного склада — «Доступно» у товара
        // не меняется, хотя на заказе стоит галка «Резерв». Берём склад с именем
        // «Основной склад», если он есть, иначе — первый склад аккаунта.
        const storesData = await fetchJson(`${API}/entity/store?limit=100`);
        const stores = storesData?.rows || [];
        const mainStore = stores.find(s => (s.name || '').trim().toLowerCase() === 'основной склад') || stores[0];

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
        // reserve = quantity — просим зарезервировать товар уже на создании
        // (равносильно галке "Резерв" на заказе). МойСклад иногда не применяет
        // это поле надёжно прямо при создании документа — поэтому шагом 4а
        // ниже мы ЕЩЁ РАЗ явно проставляем резерв через отдельный PUT по каждой
        // позиции, уже используя её настоящий id, что и есть официально
        // задокументированный надёжный способ проставить резерв через API.
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

        // 4. Заказ покупателя (с expand=positions, чтобы сразу получить id
        // созданных позиций — они нужны для шага 4а).
        const order = await fetchJson(`${API}/entity/customerorder?expand=positions`, {
            method: 'POST',
            body: JSON.stringify({
                organization: { meta: organization.meta },
                agent: { meta: agent.meta },
                ...(mainStore ? { store: { meta: mainStore.meta } } : {}),
                positions,
                description: `Заказ из Telegram-бота.\nКлиент: ${customerName || '—'}\nТелефон: ${cleanPhone}`
            })
        });

        // 4а. Подтверждаем резерв отдельным запросом на каждую позицию —
        // так резерв гарантированно фиксируется в МойСклад (галка "Резерв"
        // на заказе), а не остаётся незамеченным полем при создании документа.
        const createdPositions = order?.positions?.rows || [];
        await Promise.all(createdPositions.map(pos =>
            fetchJson(`${API}/entity/customerorder/${order.id}/positions/${pos.id}`, {
                method: 'PUT',
                body: JSON.stringify({ reserve: pos.quantity })
            }).catch(() => {}) // не роняем весь заказ, если конкретная позиция не обновилась
        ));

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
