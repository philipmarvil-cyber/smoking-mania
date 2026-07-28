// Telegram сам дёргает этот адрес при любом сообщении боту (регистрируется
// один раз через /api/setup?type=telegram). Задача — если написавший это
// администратор (сверяем по юзернейму — либо это ОСНОВНОЙ админ из
// ADMIN_TELEGRAM_USERNAME, либо кто-то, кого добавили в личном кабинете и
// кто ещё не подтверждён), запомнить его числовой chat_id в общем списке
// администраторов. Без этого шага боту физически некому слать уведомления —
// Telegram Bot API не даёт написать пользователю первым по одному только
// юзернейму, только когда сам пользователь уже написал боту хотя бы раз.
//
// ВАЖНО: раньше ответ Telegram отправлялся СРАЗУ, а вся работа (запись в KV,
// отправка подтверждения) шла "в фоне" уже после res.json(). На практике
// оказалось, что эта фоновая часть иногда не успевала выполниться — судя по
// всему, платформа не всегда даёт функции доработать после того, как ответ
// уже улетел. Теперь весь порядок обратный: сначала делаем всю работу и ждём
// её завершения, и только потом отвечаем Telegram. Задержка в доли секунды
// Telegram не критична (таймаут у него — секунды, не миллисекунды).
import { kvGetJson, kvSetJson, sendTelegramMessage, ADMIN_TELEGRAM_USERNAME, ADMIN_CHAT_IDS_KEY, ADMIN_PENDING_USERNAMES_KEY } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(200).json({ ok: true }); // Telegram проверяет доступность GET'ом при настройке — не ругаемся
        return;
    }

    try {
        const update = req.body || {};
        const message = update.message || update.edited_message;
        const from = message?.from;

        // Диагностика: запоминаем последний входящий апдейт, даже если это не
        // админ — так через /api/kv-status видно, доходят ли сообщения от
        // Telegram вообще, и какой юзернейм Telegram реально присылает (это
        // помогает поймать опечатку/несовпадение регистра, из-за которого
        // сравнение тихо не срабатывает).
        const wroteUpdate = await kvSetJson('last-telegram-update', {
            at: Date.now(),
            hasMessage: !!message,
            fromUsername: from?.username || null,
            fromId: from?.id || null,
            text: message?.text || null
        });
        if (!wroteUpdate) console.error('[telegram-webhook] не удалось записать last-telegram-update в KV');

        if (!from) {
            res.status(200).json({ ok: true });
            return;
        }

        const senderUsername = (from.username || '').toLowerCase();
        if (!senderUsername) {
            console.log('[telegram-webhook] у отправителя нет публичного @username, пропускаем', from.id);
            res.status(200).json({ ok: true });
            return;
        }

        const pending = (await kvGetJson(ADMIN_PENDING_USERNAMES_KEY)) || [];
        const isPrimary = senderUsername === ADMIN_TELEGRAM_USERNAME;
        const isPending = pending.includes(senderUsername);
        if (!isPrimary && !isPending) {
            console.log('[telegram-webhook] не админ и не в списке ожидающих:', senderUsername);
            res.status(200).json({ ok: true });
            return;
        }

        const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
        if (!list.some(a => a.chatId === from.id)) {
            list.push({ chatId: from.id, username: senderUsername, addedAt: Date.now() });
            const wroteList = await kvSetJson(ADMIN_CHAT_IDS_KEY, list);
            if (!wroteList) console.error('[telegram-webhook] не удалось записать список админов в KV');
        }
        if (isPending) {
            await kvSetJson(ADMIN_PENDING_USERNAMES_KEY, pending.filter(u => u !== senderUsername));
        }

        const sent = await sendTelegramMessage(
            from.id,
            '✅ Готово, вы подключены как администратор.\n\nТеперь сюда будут приходить уведомления о новых заказах и когда покупатель нажимает «Уведомить» на товаре не в наличии.'
        );
        if (!sent) console.error('[telegram-webhook] не удалось отправить подтверждение в Telegram, chatId=', from.id);

        res.status(200).json({ ok: true });
    } catch (e) {
        console.error('[telegram-webhook] исключение при обработке апдейта:', e?.message, e?.stack);
        // Telegram всё равно должен получить 200, иначе будет повторять доставку.
        if (!res.headersSent) res.status(200).json({ ok: true });
    }
}
