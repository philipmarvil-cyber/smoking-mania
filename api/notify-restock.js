// Покупатель нажал "Уведомить" на карточке товара не в наличии.
// 1) Сохраняем подписку в KV — чтобы админ видел её в личном кабинете
//    (/admin.html), даже если сообщение в Telegram не смогло уйти.
// 2) Если чат админа уже известен (см. api/telegram-webhook.js — он
//    появляется там сам, как только админ хоть раз напишет боту), сразу
//    шлём ему уведомление в Telegram: кто и о каком товаре просит сообщить.
import { kvGetJson, kvSetJson, kvGetCatalog, sendTelegramMessage, ADMIN_CHAT_ID_KEY } from './_catalog-lib.js';

const LOG_KEY = 'notify-subs:v1';
const MAX_LOG_ENTRIES = 500; // не даём логу расти бесконечно

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    // Диагностика: запоминаем КАЖДЫЙ входящий запрос как есть, ДО всех
    // проверок ниже — иначе если запрос вообще не доходит с клиента (сеть,
    // WebView) или приходит без productId, в /api/kv-status и подавно не
    // видно, что вообще происходит. Не ждём (await) специально — не хотим
    // тормозить ответ клиенту из-за диагностики.
    kvSetJson('last-notify-attempt', { at: Date.now(), body: req.body || null }).catch(() => {});

    try {
        const { productId, telegramUserId, name, username } = req.body || {};
        if (!productId) {
            res.status(400).json({ success: false, error: 'productId обязателен' });
            return;
        }

        // ВАЖНО: раньше здесь сразу уходил res.status(200), а вся работа ниже
        // (запись в лог, отправка в Telegram) продолжалась "в фоне" уже после
        // ответа — ровно как в order-webhook.js. Там это отрабатывало, а
        // здесь на практике Vercel обрывал выполнение функции сразу же после
        // отправки ответа клиенту, не дожидаясь фонового кода — до записи
        // лога и отправки в Telegram дело просто не доходило. Поэтому теперь
        // делаем всё ДО ответа: чуть медленнее для клиента (доли секунды),
        // зато гарантированно выполняется целиком.
        const catalog = await kvGetCatalog().catch(() => null);
        const product = (catalog?.products || []).find(p => p.id === productId);
        const productName = product?.name || productId;

        const entry = {
            productId,
            productName,
            telegramUserId: telegramUserId || null,
            name: name || null,
            username: username || null,
            at: Date.now()
        };

        const log = (await kvGetJson(LOG_KEY)) || [];
        log.unshift(entry);
        if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
        await kvSetJson(LOG_KEY, log);

        // Собственно подписка на "товар снова в наличии" — именно этот ключ
        // читает notifyRestockedProducts() в _catalog-lib.js (вызывается при
        // каждом обновлении остатков) и рассылает по нему сообщения. Раньше
        // этот шаг просто отсутствовал: заявка сохранялась в лог для админки,
        // но подписчика в restock:{productId} никто не добавлял — поэтому
        // сам факт восстановления остатка никогда никого не уведомлял.
        if (telegramUserId) {
            const restockKey = `restock:${productId}`;
            const subs = (await kvGetJson(restockKey)) || [];
            if (!subs.includes(telegramUserId)) {
                subs.push(telegramUserId);
                await kvSetJson(restockKey, subs);
            }
        }

        const adminChatId = await kvGetJson(ADMIN_CHAT_ID_KEY);
        if (adminChatId) {
            const whoParts = [];
            if (entry.name) whoParts.push(entry.name);
            if (entry.username) whoParts.push(`@${entry.username}`);
            if (entry.telegramUserId) whoParts.push(`id ${entry.telegramUserId}`);
            const who = whoParts.length ? whoParts.join(' · ') : 'Неизвестный пользователь';
            const sent = await sendTelegramMessage(
                adminChatId,
                `🔔 Хотят узнать о поступлении\n\n<b>${productName}</b>\n${who}`
            );
            await kvSetJson('last-notify-telegram-send', { at: Date.now(), adminChatId, sent: !!sent }).catch(() => {});
        } else {
            await kvSetJson('last-notify-telegram-send', { at: Date.now(), adminChatId: null, sent: false, reason: 'нет сохранённого chat_id админа' }).catch(() => {});
        }

        res.status(200).json({ success: true });
    } catch (e) {
        await kvSetJson('last-notify-error', { at: Date.now(), message: e.message }).catch(() => {});
        res.status(200).json({ success: true }); // покупателю всё равно не показываем ошибку — попап уже увидел
    }
}
