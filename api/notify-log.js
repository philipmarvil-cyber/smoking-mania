// Отдаёт список подписок "Уведомить" для личного кабинета админа
// (admin.html). Защищено ключом в переменной окружения ADMIN_PANEL_KEY —
// без неё эндпоинт наглухо закрыт (не отдаёт данные вообще никому), чтобы
// по ошибке не выложить список покупателей в открытый доступ.
import { kvGetJson, ADMIN_CHAT_ID_KEY } from './_catalog-lib.js';

const LOG_KEY = 'notify-subs:v1';

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

    try {
        const log = (await kvGetJson(LOG_KEY)) || [];
        const adminChatId = await kvGetJson(ADMIN_CHAT_ID_KEY);
        res.status(200).json({ success: true, entries: log, adminConnected: !!adminChatId });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
