// Создание заказа покупателя в МойСклад из корзины бота.
// Все запросы идут через fetchJson с троттлингом и ретраями на 429.
import { API, fetchJson, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, getLiveStock, sendToAdminsForType } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    try {
        const { items, customerName, phone, telegramUserId, deliveryMethod, address, promoCode, comment } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            res.status(400).json({ success: false, error: 'Корзина пуста' });
            return;
        }
        if (!phone) {
            res.status(400).json({ success: false, error: 'Не указан телефон' });
            return;
        }

        // 0. Проверяем остаток. Берём ОБА источника — наш кэш каталога (который
        // мы сами мгновенно и синхронно уменьшаем на шаге 5 после каждого
        // заказа) и живой отчёт склада (report/stock/all) — и для проверки
        // используем МЕНЬШЕЕ из двух чисел. Это важно: у отчёта МойСклад
        // бывает небольшая задержка пересчёта после только что созданного
        // заказа, и если бы мы верили только живым данным, то при быстрых
        // повторных заказах можно было продать на 1 больше, чем реально есть
        // (именно так и уходило в -1). Берём минимум — какой бы источник ни
        // отставал, мы всё равно не продадим лишнего.
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

            const candidates = [];
            if (liveStock.hasOwnProperty(i.id)) candidates.push(liveStock[i.id]);
            if (cachedProduct && typeof cachedProduct.stock === 'number') candidates.push(cachedProduct.stock);
            const availableStock = candidates.length ? Math.min(...candidates) : null;

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

        // 4. Заказ покупателя.
        // ВАЖНО: раньше сюда попадали только имя и телефон — способ доставки,
        // адрес, промокод и комментарий клиента собирались на фронте, но
        // никогда не передавались на сервер и терялись. Теперь всё это уходит
        // в описание заказа, чтобы менеджер видел куда и что везти.
        const descriptionLines = [
            'Заказ из Telegram-бота.',
            `Клиент: ${customerName || '—'}`,
            `Телефон: ${cleanPhone}`,
            `Доставка: ${deliveryMethod || '—'} (г. Москва, Шипиловская улица, дом 50, корпус 1)`
        ];
        if (address) descriptionLines.push(`Адрес: ${address}`);
        if (promoCode) descriptionLines.push(`Промокод: ${promoCode}`);
        if (comment) descriptionLines.push(`Комментарий клиента: ${comment}`);

        const order = await fetchJson(`${API}/entity/customerorder`, {
            method: 'POST',
            body: JSON.stringify({
                organization: { meta: organization.meta },
                agent: { meta: agent.meta },
                ...(mainStore ? { store: { meta: mainStore.meta } } : {}),
                positions,
                description: descriptionLines.join('\n')
            })
        });

        // 4а. Подтверждаем резерв отдельным запросом на каждую позицию — это
        // задокументированный МойСклад способ гарантированно проставить резерв
        // (поле reserve, переданное прямо при создании документа, не всегда
        // применяется надёжно). Берём позиции через отдельный GET по заказу —
        // `expand=positions` на самом POST создания не гарантированно
        // возвращает настоящие id позиций, поэтому полагаться на него нельзя.
        let reservedCount = 0;
        try {
            const positionsData = await fetchJson(`${API}/entity/customerorder/${order.id}/positions`);
            const createdPositions = positionsData?.rows || [];
            const results = await Promise.all(createdPositions.map(pos =>
                fetchJson(`${API}/entity/customerorder/${order.id}/positions/${pos.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ reserve: pos.quantity })
                }).then(() => true).catch(() => false)
            ));
            reservedCount = results.filter(Boolean).length;
        } catch (e) {
            reservedCount = 0; // не удалось подтвердить резерв — заказ всё равно создан, разберёмся вручную
        }

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

        // Сохраняем связку telegramUserId → id заказа в KV — раньше "Мои
        // заказы" полагались только на локальный CloudStorage устройства,
        // и заказ, оформленный без сохранения orderId (см. фикс ниже), был
        // виден только на этом же телефоне. Теперь список переживёт
        // переустановку/смену устройства.
        if (telegramUserId) {
            const key = `orders-by-user:${telegramUserId}`;
            const existing = (await kvGetJson(key)) || [];
            const updated = [order.id, ...existing.filter(id => id !== order.id)].slice(0, 30);
            await kvSetJson(key, updated);
        }

        // Уведомление админу в Telegram о новом заказе — не полагаемся на то, что
        // МойСклад сам пришлёт push/уведомление по заказу, созданному через API:
        // на практике их нативные уведомления о новых заказах надёжно всплывают
        // только для заказов, оформленных прямо в интерфейсе/приложении МойСклад,
        // а не через JSON API. Шлём сами, тем же каналом, что и "Уведомить о
        // поступлении" — chat_id админа уже сохранён в KV (см. telegram-webhook.js).
        try {
            const orderTotal = items.reduce((sum, i) => {
                const qty = Math.max(1, parseInt(i.qty, 10) || 1);
                return sum + (Number(i.price) || 0) * qty;
            }, 0);
            const itemsLines = items.map(i => `• ${i.name || 'Товар'} × ${Math.max(1, parseInt(i.qty, 10) || 1)}`).join('\n');
            const messageLines = [
                `🛒 Новый заказ №${order.name}`,
                `Клиент: ${customerName || '—'}`,
                `Телефон: ${cleanPhone}`,
                `Доставка: ${deliveryMethod || '—'}`,
                `Сумма: ${orderTotal.toLocaleString('ru-RU')} ₽`,
                '',
                itemsLines
            ];
            if (comment) messageLines.push('', `Комментарий: ${comment}`);
            await sendToAdminsForType('orders', messageLines.join('\n'));
        } catch (e) {
            // Не даём сбою уведомления сорвать уже успешно созданный заказ.
        }

        res.status(200).json({ success: true, orderId: order.id, orderName: order.name, reservedPositions: reservedCount });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
