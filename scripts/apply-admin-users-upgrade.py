from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        if new in text:
            return
        raise SystemExit(f'{label}: pattern not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# orders.js: lightweight user touch endpoint, no new Vercel function.
replace_once(
    'api/orders.js',
    "import { API, fetchJson, kvGetJson, colorToHex } from './_catalog-lib.js';",
    "import { API, fetchJson, kvGetJson, colorToHex } from './_catalog-lib.js';\nimport { registerTelegramUser } from './_user-lib.js';",
    'orders import'
)
replace_once(
    'api/orders.js',
    "        const { id, ids, telegramUserId } = req.body || {};\n        if (id) {",
    "        const { id, ids, telegramUserId, action, user } = req.body || {};\n        if (action === 'touch-user') {\n            const profile = await registerTelegramUser(user || {});\n            if (!profile) {\n                res.status(400).json({ success: false, error: 'Некорректный Telegram user' });\n                return;\n            }\n            res.status(200).json({ success: true });\n            return;\n        }\n        if (id) {",
    'orders touch action'
)

# create-order.js: cache purchase snapshots for fast admin history.
replace_once(
    'api/create-order.js',
    "import { API, fetchJson, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, getLiveStock, sendToAdminsForType } from './_catalog-lib.js';",
    "import { API, fetchJson, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, getLiveStock, sendToAdminsForType } from './_catalog-lib.js';\nimport { recordTelegramOrder } from './_user-lib.js';",
    'create-order import'
)
marker = "        // Уведомление админу в Telegram о новом заказе — не полагаемся на то, что\n"
insert = """        // Сохраняем компактный снимок заказа для админ-панели. Это позволяет\n        // смотреть историю покупок из KV, не дёргая МойСклад при каждом открытии\n        // карточки пользователя. Старые заказы при необходимости подгрузятся\n        // отдельно только для выбранного пользователя.\n        if (telegramUserId) {\n            try {\n                await recordTelegramOrder(\n                    { id: telegramUserId, phone: cleanPhone },\n                    { id: order.id, name: order.name, moment: order.moment },\n                    items\n                );\n            } catch (e) {\n                // Заказ уже создан — ошибка аналитического кэша не должна его ломать.\n            }\n        }\n\n""" + marker
replace_once('api/create-order.js', marker, insert, 'create-order snapshot')

# notify-log.js: authenticated admin views for users and one user's purchases.
replace_once(
    'api/notify-log.js',
    "import { kvGetJson, kvSetJson, ADMIN_CHAT_ID_KEY, ADMIN_CHAT_IDS_KEY, ADMIN_PENDING_USERNAMES_KEY, ADMIN_TELEGRAM_USERNAME } from './_catalog-lib.js';",
    "import { kvGetJson, kvSetJson, ADMIN_CHAT_ID_KEY, ADMIN_CHAT_IDS_KEY, ADMIN_PENDING_USERNAMES_KEY, ADMIN_TELEGRAM_USERNAME } from './_catalog-lib.js';\nimport { getAdminUsers, getAdminUserDetail } from './_user-lib.js';",
    'notify import'
)
replace_once(
    'api/notify-log.js',
    "async function handleGet(req, res) {\n    try {\n        const log = (await kvGetJson(LOG_KEY)) || [];\n        const { admins, pending } = await getAdminsState();",
    "async function handleGet(req, res) {\n    try {\n        const log = (await kvGetJson(LOG_KEY)) || [];\n        const view = String(req.query?.view || '');\n\n        if (view === 'users') {\n            const result = await getAdminUsers(log);\n            res.status(200).json({ success: true, ...result });\n            return;\n        }\n\n        if (view === 'user') {\n            const detail = await getAdminUserDetail(req.query?.userId);\n            if (!detail) {\n                res.status(400).json({ success: false, error: 'Некорректный пользователь' });\n                return;\n            }\n            res.status(200).json({ success: true, ...detail });\n            return;\n        }\n\n        const { admins, pending } = await getAdminsState();",
    'notify admin views'
)

# Existing storefront enhancement file is already loaded by index.html, so user
# registration adds zero extra JS requests/files on the critical rendering path.
p = Path('storefront-enhancements.js')
s = p.read_text(encoding='utf-8')
tracking = r'''
    // Реестр пользователей для админ-панели. Не трогаем МойСклад: это один
    // маленький POST в KV максимум раз в 6 часов с данного устройства.
    function touchTelegramUserForAdmin() {
        const webApp = window.Telegram?.WebApp;
        const user = webApp?.initDataUnsafe?.user;
        if (!user?.id) return;
        const storageKey = `admin_user_touch_v1:${user.id}`;
        const now = Date.now();
        const last = Number(localStorage.getItem(storageKey)) || 0;
        if (now - last < 6 * 60 * 60 * 1000) return;
        localStorage.setItem(storageKey, String(now));
        fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'touch-user',
                user: {
                    id: user.id,
                    firstName: user.first_name || '',
                    lastName: user.last_name || '',
                    username: user.username || '',
                    photoUrl: user.photo_url || ''
                }
            })
        }).then(response => {
            if (!response.ok) localStorage.removeItem(storageKey);
        }).catch(() => localStorage.removeItem(storageKey));
    }
    setTimeout(touchTelegramUserForAdmin, 250);
'''
if 'function touchTelegramUserForAdmin()' not in s:
    pos = s.rfind('\n})();')
    if pos < 0:
        raise SystemExit('storefront tail not found')
    s = s[:pos] + '\n' + tracking + s[pos:]
    p.write_text(s, encoding='utf-8')

# Connect enhanced admin UI, preserving existing admin.html logic.
p = Path('admin.html')
h = p.read_text(encoding='utf-8')
tag = '    <script src="/admin-enhancements.js?v=20260817a"></script>\n'
if '/admin-enhancements.js?' not in h:
    if '</body>' not in h:
        raise SystemExit('admin body tail not found')
    h = h.replace('</body>', tag + '</body>', 1)
    p.write_text(h, encoding='utf-8')
