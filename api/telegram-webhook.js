// Telegram сам дёргает этот адрес при любом сообщении боту (регистрируется
// один раз через /api/setup-telegram-webhook). Единственная задача — если
// написавший это АДМИН (сверяем по юзернейму, см. ADMIN_TELEGRAM_USERNAME в
// _catalog-lib.js), запомнить его числовой chat_id в KV. Без этого шага
// боту физически некому слать уведомления о клиентах, нажавших "Уведомить" —
// Telegram Bot API не даёт написать пользователю первым по одному только
// юзернейму, только когда сам пользователь уже написал боту хотя бы раз.
import { kvSetJson, sendTelegramMessage, ADMIN_TELEGRAM_USERNAME, ADMIN_CHAT_ID_KEY } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(200).json({ ok: true }); // Telegram проверяет доступность GET'ом при настройке — не ругаемся
        return;
    }

    // Telegram не обязательно ждёт быстрый ответ так же строго, как МойСклад,
    // но всё равно отвечаем сразу — чтобы не ловить повторные доставки апдейта.
    res.status(200).json({ ok: true });

    try {
        const update = req.body || {};
        const message = update.message || update.edited_message;
        const from = message?.from;
        if (!from) return;

        const senderUsername = (from.username || '').toLowerCase();
        if (senderUsername !== ADMIN_TELEGRAM_USERNAME) return; // не админ — просто игнорируем

        await kvSetJson(ADMIN_CHAT_ID_KEY, from.id);
        await sendTelegramMessage(
            from.id,
            '✅ Готово, вы подключены как администратор.\n\nТеперь сюда будут приходить уведомления, когда покупатель нажимает «Уведомить» на товаре не в наличии.'
        ).catch(() => {});
    } catch (e) {
        // Ответ Telegram уже ушёл — просто не даём процессу упасть.
    }
}
