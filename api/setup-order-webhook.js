// Разовая настройка: открой этот адрес в браузере ОДИН РАЗ (а также ещё
// раз после этого обновления), чтобы зарегистрировать в МойСклад вебхуки
// на изменения заказов покупателей — теперь на СОЗДАНИЕ, ИЗМЕНЕНИЕ и
// УДАЛЕНИЕ (раньше был только UPDATE, из-за чего удаление заказа прямо в
// МойСклад никак не подхватывалось ботом). После этого МойСклад сам
// будет дёргать /api/order-webhook при любом из этих событий: статус
// заказа уходит клиенту в Telegram, а остатки в кэше обновляются сразу,
// а не только на ночной синхронизации. Повторный запуск безопасен — уже
// существующие вебхуки не дублируются.
import { API, fetchJson } from './_catalog-lib.js';

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE'];

export default async function handler(req, res) {
    try {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${protocol}://${host}/api/order-webhook`;

        const existing = await fetchJson(`${API}/entity/webhook?limit=100`);
        const existingRows = existing?.rows || [];

        const results = [];
        for (const action of ACTIONS) {
            const already = existingRows.find(w =>
                w.url === webhookUrl && w.entityType === 'customerorder' && w.action === action
            );
            if (already) {
                results.push({ action, alreadyExists: true });
                continue;
            }
            const created = await fetchJson(`${API}/entity/webhook`, {
                method: 'POST',
                body: JSON.stringify({ url: webhookUrl, action, entityType: 'customerorder' })
            });
            results.push({ action, created: true, id: created.id });
        }

        res.status(200).json({ success: true, webhookUrl, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
