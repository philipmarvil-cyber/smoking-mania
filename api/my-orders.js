// Отдаёт клиенту список его последних заказов — статус, сумма, дата.
// Раньше этого файла не существовало вовсе, хотя фронтенд уже дёргал
// /api/my-orders — поэтому "Мои заказы" всегда падали в "не удалось
// загрузить заказы".
//
// Источники id заказов (объединяются и дедуплицируются):
// 1. ids — локальная история конкретного устройства (Telegram CloudStorage);
// 2. запись в KV orders-by-user:{telegramUserId} — сохраняется в
//    /api/create-order при оформлении, переживает смену устройства.
import { API, fetchJson, kvGetJson } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    try {
        const { ids, telegramUserId } = req.body || {};
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
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

// МойСклад хранит цвет статуса как целое число (decimal RGB), фронту
// нужен CSS-цвет вида "#rrggbb".
function colorToHex(color) {
    if (typeof color !== 'number') return null;
    return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
}
