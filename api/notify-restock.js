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
    // видно, что вообще происходит.
    kvSetJson('last-notify-attempt', { at: Date.now(), body: req.body || null }).catch(() => {});

    try {
        const { productId, telegramUserId, name, username } = req.body || {};
        if (!productId) {
            res.status(400).json({ success: false, error: 'productId обязателен' });
            return;
        }

        // Отвечаем покупателю сразу — дальше просто фоновая запись/уведомление.
        res.status(200).json({ success: true });

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
            ).catch((e) => { throw e; });
            await kvSetJson('last-notify-telegram-send', { at: Date.now(), adminChatId, sent: !!sent }).catch(() => {});
        } else {
            await kvSetJson('last-notify-telegram-send', { at: Date.now(), adminChatId: null, sent: false, reason: 'нет сохранённого chat_id админа' }).catch(() => {});
        }
    } catch (e) {
        await kvSetJson('last-notify-error', { at: Date.now(), message: e.message }).catch(() => {});
    }
}
