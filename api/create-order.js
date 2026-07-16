export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9";
    const API = "https://api.moysklad.ru/api/remap/1.2";
    const headers = {
        "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    try {
        const { items, customerName, phone } = req.body || {};

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ error: 'Корзина пуста' });
        }
        if (!phone) {
            return res.status(400).json({ error: 'Не передан номер телефона' });
        }

        // 1. Организация и склад — берём первую (единственную) запись по каждой сущности.
        const [orgRes, storeRes] = await Promise.all([
            fetch(`${API}/entity/organization?limit=1`, { headers }),
            fetch(`${API}/entity/store?limit=1`, { headers })
        ]);
        const orgData = await orgRes.json();
        const storeData = await storeRes.json();
        const organization = orgData.rows && orgData.rows[0];
        const store = storeData.rows && storeData.rows[0];

        if (!organization || !store) {
            return res.status(500).json({ error: 'В МойСклад не найдена организация или склад' });
        }

        // 2. Контрагент — ищем по номеру телефона, если нет — создаём нового.
        const cleanPhone = String(phone).replace(/[^\d+]/g, '');
        const searchRes = await fetch(
            `${API}/entity/counterparty?filter=${encodeURIComponent('phone=' + cleanPhone)}`,
            { headers }
        );
        const searchData = await searchRes.json();
        let counterparty = searchData.rows && searchData.rows[0];

        if (!counterparty) {
            const createAgentRes = await fetch(`${API}/entity/counterparty`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    name: customerName || 'Клиент из Telegram-бота',
                    phone: cleanPhone
                })
            });
            if (!createAgentRes.ok) {
                const err = await createAgentRes.json().catch(() => ({}));
                return res.status(500).json({ error: `Не удалось создать контрагента: ${err.errors?.[0]?.error || createAgentRes.status}` });
            }
            counterparty = await createAgentRes.json();
        }

        // 3. Позиции заказа — ссылаемся на товары по их id из МойСклад.
        const positions = items.map(item => ({
            quantity: item.qty,
            price: Math.round(item.price * 100),
            assortment: {
                meta: {
                    href: `${API}/entity/product/${item.id}`,
                    type: "product",
                    mediaType: "application/json"
                }
            }
        }));

        // 4. Создаём "Заказ покупателя".
        const orderRes = await fetch(`${API}/entity/customerorder`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                organization: { meta: organization.meta },
                agent: { meta: counterparty.meta },
                store: { meta: store.meta },
                description: "Заказ оформлен через Telegram-бота",
                positions
            })
        });

        if (!orderRes.ok) {
            const err = await orderRes.json().catch(() => ({}));
            return res.status(500).json({ error: `Склад отклонил заказ: ${err.errors?.[0]?.error || orderRes.status}` });
        }

        const order = await orderRes.json();
        return res.status(200).json({ success: true, orderName: order.name, orderId: order.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
