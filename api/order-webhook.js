// МойСклад дёргает этот адрес сам (через зарегистрированный вебхук —
// см. api/setup-order-webhook.js) при ЛЮБОМ изменении заказа покупателя
// (создание/изменение/удаление). Статус в Telegram шлём только при
// реальной смене статуса. А ещё — при ЛЮБОМ из этих событий (в том числе
// когда заказ удалили прямо в МойСклад, а не через бота) обновляем
// остатки в кэше: не ждём ночную полную синхронизацию, а сразу же
// подтягиваем актуальный остаток именно потому, что заказ мог измениться
// не через наш бот, и наш обычный "мгновенный" механизм (шаг 5 в
// create-order.js) в этом случае просто не сработал бы.
import { API, fetchJson, kvGetJson, kvSetJson, sendTelegramMessage, refreshAllStock } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    // Отвечаем МойСклад сразу 200 — иначе он будет ретраить и заваливать
    // повторными вызовами; сама обработка при этом продолжает идти в фоне.
    res.status(200).json({ success: true });

    // Диагностика: что вебхук вообще получил — можно посмотреть через
    // /api/kv-status (поле lastWebhookEvent), чтобы убедиться, что МойСклад
    // реально дёргает этот адрес, и как выглядит присланное событие.
    try {
        const events = (req.body && req.body.events) || [];
        await kvSetJson('last-webhook-event', {
            at: Date.now(),
            count: events.length,
            events: events.map(e => ({ type: e?.meta?.type, action: e?.action }))
        }).catch(() => {});
    } catch (e) {}

    try {
        const events = (req.body && req.body.events) || [];
        const orderEvents = events.filter(e => e?.meta?.type === 'customerorder');

        if (orderEvents.length) {
            // ВАЖНО: обязательно ждём (await) — без этого функция могла
            // завершиться (а вместе с ней и весь процесс на Vercel) раньше,
            // чем запрос к складу реально успевал доехать и примениться,
            // особенно на событии удаления, где ниже почти нечего ждать.
            const refreshed = await refreshAllStock().catch(err => ({ error: err.message }));
            await kvSetJson('last-stock-refresh', { at: Date.now(), result: refreshed }).catch(() => {});
        }

        for (const event of orderEvents) {
            if (event.action !== 'UPDATE') continue; // статус смотрим только у существующих заказов

            const orderId = event.meta.href?.split('/').pop()?.split('?')[0];
            if (!orderId) continue;

            let order;
            try {
                order = await fetchJson(`${API}/entity/customerorder/${orderId}?expand=state`);
            } catch (e) {
                continue; // заказ мог быть удалён — пропускаем
            }

            const newStateName = order.state?.name || 'Новый';
            const stateKey = `order-state:${orderId}`;
            const prevStateName = await kvGetJson(stateKey);

            if (prevStateName === newStateName) continue; // статус не менялся — просто другое поле заказа отредактировали

            await kvSetJson(stateKey, newStateName);

            const telegramUserId = await kvGetJson(`order-tg:${orderId}`);
            if (telegramUserId) {
                await sendTelegramMessage(
                    telegramUserId,
                    `📦 Заказ ${order.name}\nНовый статус: <b>${newStateName}</b>`
                );
            }
        }
    } catch (e) {
        // Ответ пользователю уже ушёл выше — здесь просто не даём процессу упасть.
    }
}
