// Telegram сам дёргает этот адрес при любом сообщении боту (регистрируется
// один раз через /api/setup?type=telegram). Задача — если написавший это
// администратор (сверяем по юзернейму — либо это ОСНОВНОЙ админ из
// ADMIN_TELEGRAM_USERNAME, либо кто-то, кого добавили в личном кабинете и
// кто ещё не подтверждён), запомнить его числовой chat_id в общем списке
// администраторов. Без этого шага боту физически некому слать уведомления —
// Telegram Bot API не даёт написать пользователю первым по одному только
// юзернейму, только когда сам пользователь уже написал боту хотя бы раз.
import { kvGetJson, kvSetJson, sendTelegramMessage, ADMIN_TELEGRAM_USERNAME, ADMIN_CHAT_IDS_KEY, ADMIN_PENDING_USERNAMES_KEY } from './_catalog-lib.js';

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

        // Диагностика: запоминаем последний входящий апдейт, даже если это не
        // админ — так через /api/kv-status видно, доходят ли сообщения от
        // Telegram вообще, и какой юзернейм Telegram реально присылает (это
        // помогает поймать опечатку/несовпадение регистра, из-за которого
        // сравнение тихо не срабатывает).
        await kvSetJson('last-telegram-update', {
            at: Date.now(),
            hasMessage: !!message,
            fromUsername: from?.username || null,
            fromId: from?.id || null,
            text: message?.text || null
        }).catch(() => {});

        if (!from) return;

        const senderUsername = (from.username || '').toLowerCase();
        if (!senderUsername) return;

        const pending = (await kvGetJson(ADMIN_PENDING_USERNAMES_KEY)) || [];
        const isPrimary = senderUsername === ADMIN_TELEGRAM_USERNAME;
        const isPending = pending.includes(senderUsername);
        if (!isPrimary && !isPending) return; // не админ и не в списке ожидающих — просто игнорируем

        const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
        if (!list.some(a => a.chatId === from.id)) {
            list.push({ chatId: from.id, username: senderUsername, addedAt: Date.now() });
            await kvSetJson(ADMIN_CHAT_IDS_KEY, list);
        }
        if (isPending) {
            await kvSetJson(ADMIN_PENDING_USERNAMES_KEY, pending.filter(u => u !== senderUsername));
        }

        await sendTelegramMessage(
            from.id,
            '✅ Готово, вы подключены как администратор.\n\nТеперь сюда будут приходить уведомления о новых заказах и когда покупатель нажимает «Уведомить» на товаре не в наличии.'
        ).catch(() => {});
    } catch (e) {
        // Ответ Telegram уже ушёл — просто не даём процессу упасть.
    }
}
