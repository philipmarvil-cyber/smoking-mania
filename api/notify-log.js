// Отдаёт список подписок "Уведомить" для личного кабинета админа
// (admin.html), а заодно управляет списком администраторов, которым бот
// шлёт уведомления о заказах и о "Уведомить о поступлении":
//   GET  /api/notify-log?key=...                                → заявки + список админов (подтверждённых и ожидающих)
//   POST /api/notify-log?key=... {action:'add-admin', username}    → добавить юзернейм в список ожидающих
//   POST /api/notify-log?key=... {action:'remove-admin', chatId}   → убрать подтверждённого админа
//   POST /api/notify-log?key=... {action:'remove-pending', username} → убрать из списка ожидающих
// Защищено ключом в переменной окружения ADMIN_PANEL_KEY — без неё эндпоинт
// наглухо закрыт (не отдаёт данные вообще никому), чтобы по ошибке не
// выложить список покупателей в открытый доступ.
import { kvGetJson, kvSetJson, ADMIN_CHAT_ID_KEY, ADMIN_CHAT_IDS_KEY, ADMIN_PENDING_USERNAMES_KEY, ADMIN_TELEGRAM_USERNAME } from './_catalog-lib.js';

const LOG_KEY = 'notify-subs:v1';

async function getAdminsState() {
    const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
    const legacy = await kvGetJson(ADMIN_CHAT_ID_KEY);
    if (legacy && !list.some(a => a.chatId === legacy)) {
        list.push({ chatId: legacy, username: ADMIN_TELEGRAM_USERNAME || null, addedAt: null });
    }
    const pending = (await kvGetJson(ADMIN_PENDING_USERNAMES_KEY)) || [];
    return { admins: list, pending };
}

async function handleGet(req, res) {
    try {
        const log = (await kvGetJson(LOG_KEY)) || [];
        const { admins, pending } = await getAdminsState();
        res.status(200).json({ success: true, entries: log, adminConnected: admins.length > 0, admins, pending });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

async function handlePost(req, res) {
    try {
        const { action, username, chatId } = req.body || {};

        if (action === 'add-admin') {
            const clean = String(username || '').replace(/^@/, '').trim().toLowerCase();
            if (!clean) {
                res.status(400).json({ success: false, error: 'Укажите юзернейм' });
                return;
            }
            const { admins, pending } = await getAdminsState();
            if (admins.some(a => (a.username || '').toLowerCase() === clean)) {
                res.status(400).json({ success: false, error: 'Этот пользователь уже подключён' });
                return;
            }
            if (!pending.includes(clean)) {
                pending.push(clean);
                await kvSetJson(ADMIN_PENDING_USERNAMES_KEY, pending);
            }
            const { admins: a2, pending: p2 } = await getAdminsState();
            res.status(200).json({ success: true, admins: a2, pending: p2 });
            return;
        }

        if (action === 'remove-admin') {
            const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
            const updated = list.filter(a => a.chatId !== chatId);
            await kvSetJson(ADMIN_CHAT_IDS_KEY, updated);
            const { admins, pending } = await getAdminsState();
            res.status(200).json({ success: true, admins, pending });
            return;
        }

        if (action === 'remove-pending') {
            const clean = String(username || '').replace(/^@/, '').trim().toLowerCase();
            const pending = ((await kvGetJson(ADMIN_PENDING_USERNAMES_KEY)) || []).filter(u => u !== clean);
            await kvSetJson(ADMIN_PENDING_USERNAMES_KEY, pending);
            const { admins } = await getAdminsState();
            res.status(200).json({ success: true, admins, pending });
            return;
        }

        res.status(400).json({ success: false, error: 'Неизвестное действие' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

export default async function handler(req, res) {
    const requiredKey = process.env.ADMIN_PANEL_KEY;
    if (!requiredKey) {
        res.status(500).json({ success: false, error: 'Не задана переменная окружения ADMIN_PANEL_KEY' });
        return;
    }
    const providedKey = req.query?.key;
    if (providedKey !== requiredKey) {
        res.status(403).json({ success: false, error: 'Неверный ключ' });
        return;
    }

    if (req.method === 'GET') {
        await handleGet(req, res);
    } else if (req.method === 'POST') {
        await handlePost(req, res);
    } else {
        res.status(405).json({ success: false, error: 'Метод не поддерживается' });
    }
}
