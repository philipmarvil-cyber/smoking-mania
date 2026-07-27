// Заказы клиента: список ("Мои заказы") и состав конкретного заказа по тапу.
// Раньше это были два отдельных файла (api/my-orders.js и
// api/order-detail.js), но план Vercel Hobby разрешает не больше 12
// serverless-функций — пришлось объединить, поведение не изменилось:
//
//   POST { id }                       → детали одного заказа (состав, статус, сумма)
//   POST { ids, telegramUserId }      → список последних заказов
//
// Источники id заказов для списка (объединяются и дедуплицируются):
// 1. ids — локальная история конкретного устройства (Telegram CloudStorage);
// 2. запись в KV orders-by-user:{telegramUserId} — сохраняется в
//    /api/create-order при оформлении, переживает смену устройства.
import { API, fetchJson, kvGetJson, colorToHex } from './_catalog-lib.js';

async function handleOrderDetail(id, res) {
    const order = await fetchJson(`${API}/entity/customerorder/${id}?expand=state,positions.assortment`);
    const positions = (order.positions?.rows || []).map(p => ({
        name: p.assortment?.name || 'Товар',
        quantity: p.quantity || 1,
        price: (p.price || 0) / 100
    }));

    res.status(200).json({
        success: true,
        order: {
            id: order.id,
            name: order.name,
            stateName: order.state?.name || 'Оформлен',
            stateColor: colorToHex(order.state?.color),
            moment: (order.moment || '').replace(' ', 'T'),
            sum: (order.sum || 0) / 100,
            description: order.description || '',
            positions
        }
    });
}

async function handleOrdersList(ids, telegramUserId, res) {
    const idSet = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);

    if (telegramUserId) {
        const stored = await kvGetJson(`orders-by-user:${telegramUserId}`);
        if (Array.isArray(stored)) stored.forEach(id => idSet.add(id));
    }

    const allIds = [...idSet].slice(0, 20);
    if (!allIds.length) {
        res.status(200).json({ success: true, orders: [] });
        return;
    }

    const results = await Promise.all(allIds.map(id =>
        fetchJson(`${API}/entity/customerorder/${id}?expand=state`).catch(() => null)
    ));

    const orders = results.filter(Boolean).map(o => ({
        id: o.id,
        name: o.name,
        stateName: o.state?.name || 'Оформлен',
        stateColor: colorToHex(o.state?.color),
        moment: (o.moment || '').replace(' ', 'T'),
        sum: (o.sum || 0) / 100
    })).sort((a, b) => new Date(b.moment) - new Date(a.moment));

    res.status(200).json({ success: true, orders });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    try {
        const { id, ids, telegramUserId } = req.body || {};
        if (id) {
            await handleOrderDetail(id, res);
        } else {
            await handleOrdersList(ids, telegramUserId, res);
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
