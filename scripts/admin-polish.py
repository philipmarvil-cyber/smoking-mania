from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)

# --- Active restock waits in user registry ---
p = Path('api/_user-lib.js')
s = p.read_text(encoding='utf-8')

anchor = """function normalizeFallbackProfile(id, notifyById, legacyOrderCount) {
"""
helper = """async function buildActiveWaitingMap(notifyEntries = [], onlyUserId = '') {
    const entries = (notifyEntries || []).filter(entry => {
        const id = cleanUserId(entry?.telegramUserId);
        const productId = String(entry?.productId || '').trim();
        return id && productId && (!onlyUserId || id === onlyUserId);
    });
    if (!entries.length) return new Map();

    const productIds = [...new Set(entries.map(entry => String(entry.productId)))];
    const subsLists = await mgetJson(productIds.map(productId => `restock:${productId}`));
    const activeByProduct = new Map(productIds.map((productId, index) => [
        productId,
        new Set((Array.isArray(subsLists[index]) ? subsLists[index] : []).map(value => String(value)))
    ]));

    const byUser = new Map();
    const seen = new Set();
    // Журнал хранится от новых к старым, поэтому при дубле оставляем свежую запись.
    for (const entry of entries) {
        const id = cleanUserId(entry.telegramUserId);
        const productId = String(entry.productId);
        if (!activeByProduct.get(productId)?.has(id)) continue;
        const dedupeKey = `${id}:${productId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        if (!byUser.has(id)) byUser.set(id, []);
        byUser.get(id).push({
            productId,
            productName: String(entry.productName || productId),
            at: Number(entry.at) || 0
        });
    }
    return byUser;
}

function normalizeFallbackProfile(id, notifyById, legacyOrderCount) {
"""
s = replace_once(s, anchor, helper, 'waiting helper')

old = """    const [profiles, legacyLists] = await Promise.all([
        mgetJson(idList.map(id => USER_PROFILE_PREFIX + id)),
        mgetJson(idList.map(id => LEGACY_ORDERS_PREFIX + id))
    ]);
"""
new = """    const [profiles, legacyLists, waitingByUser] = await Promise.all([
        mgetJson(idList.map(id => USER_PROFILE_PREFIX + id)),
        mgetJson(idList.map(id => LEGACY_ORDERS_PREFIX + id)),
        buildActiveWaitingMap(notifyEntries)
    ]);
"""
s = replace_once(s, old, new, 'users parallel load')

old = """        return {
            ...p,
            id,
            totalOrders: Math.max(Number(p.totalOrders) || 0, legacyIds.length),
            hasLegacyOrders: legacyIds.length > 0
        };
"""
new = """        const waitingItems = waitingByUser.get(id) || [];
        return {
            ...p,
            id,
            totalOrders: Math.max(Number(p.totalOrders) || 0, legacyIds.length),
            hasLegacyOrders: legacyIds.length > 0,
            waitingItems,
            waitingCount: waitingItems.length
        };
"""
s = replace_once(s, old, new, 'user waiting fields')

old = """            totalOrders: users.reduce((sum, u) => sum + (Number(u.totalOrders) || 0), 0),
            knownRevenue: users.reduce((sum, u) => sum + (Number(u.totalSpent) || 0), 0)
"""
new = """            totalOrders: users.reduce((sum, u) => sum + (Number(u.totalOrders) || 0), 0),
            knownRevenue: users.reduce((sum, u) => sum + (Number(u.totalSpent) || 0), 0),
            waitingUsers: users.filter(u => Number(u.waitingCount) > 0).length,
            waitingRequests: users.reduce((sum, u) => sum + (Number(u.waitingCount) || 0), 0)
"""
s = replace_once(s, old, new, 'waiting stats')

s = replace_once(s,
    'export async function getAdminUserDetail(rawId) {',
    'export async function getAdminUserDetail(rawId, notifyEntries = []) {',
    'detail signature')

old = """    let profile = (await kvGetJson(USER_PROFILE_PREFIX + id)) || normalizeFallbackProfile(id, new Map(), 0);
    const newIds = (await redis(['ZRANGE', USER_ORDERS_PREFIX + id, '0', '49', 'REV'])) || [];
"""
new = """    let profile = (await kvGetJson(USER_PROFILE_PREFIX + id)) || normalizeFallbackProfile(id, new Map(), 0);
    const waitingItems = (await buildActiveWaitingMap(notifyEntries, id)).get(id) || [];
    const newIds = (await redis(['ZRANGE', USER_ORDERS_PREFIX + id, '0', '49', 'REV'])) || [];
"""
s = replace_once(s, old, new, 'detail waiting load')

old = """        },
        orders
    };
}
"""
new = """        },
        orders,
        waitingItems
    };
}
"""
s = replace_once(s, old, new, 'detail waiting return')
p.write_text(s, encoding='utf-8')

# --- Admin protected API passes the notify log to detail, so waits are current ---
p = Path('api/notify-log.js')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    'const detail = await getAdminUserDetail(req.query?.userId);',
    'const detail = await getAdminUserDetail(req.query?.userId, log);',
    'notify detail log')
p.write_text(s, encoding='utf-8')

# --- Banner API keeps the richer editor fields ---
p = Path('api/banners.js')
s = p.read_text(encoding='utf-8')
old = """            imageUrl: String(b.imageUrl || '').slice(0, 900000), // с запасом под data:-URL загруженной картинки (обычная ссылка тоже поместится)
            buttonText: String(b.buttonText || '').slice(0, 40),
            buttonLink: String(b.buttonLink || '').slice(0, 500)
"""
new = """            imageUrl: String(b.imageUrl || '').slice(0, 900000), // с запасом под data:-URL загруженной картинки (обычная ссылка тоже поместится)
            buttonText: String(b.buttonText || '').slice(0, 40),
            buttonLink: String(b.buttonLink || '').slice(0, 500),
            enabled: b.enabled !== false,
            badge: String(b.badge || '').slice(0, 40),
            textTheme: b.textTheme === 'dark' ? 'dark' : 'light',
            align: b.align === 'center' ? 'center' : 'left',
            height: ['compact', 'regular', 'large'].includes(b.height) ? b.height : 'regular',
            overlay: Math.max(0, Math.min(0.75, Number(b.overlay) || 0)),
            backgroundPosition: ['left', 'center', 'right'].includes(b.backgroundPosition) ? b.backgroundPosition : 'center'
"""
s = replace_once(s, old, new, 'banner fields')
p.write_text(s, encoding='utf-8')

# --- Existing users UI: replace misleading total stat with active waiting count ---
p = Path('admin-enhancements.js')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    '<div class="admin-stat"><div class="admin-stat-value" id="stat-revenue">—</div><div class="admin-stat-label">Известная сумма заказов</div></div>',
    '<div class="admin-stat"><div class="admin-stat-value" id="stat-waiting">—</div><div class="admin-stat-label">Ждут поступления</div></div>',
    'admin waiting stat markup')
s = replace_once(s,
    "set('stat-revenue', money(stats.knownRevenue || 0));",
    "set('stat-waiting', Number(stats.waitingUsers || 0).toLocaleString('ru-RU'));",
    'admin waiting stat value')
s = replace_once(s,
    ".user-spent { color:#2f8f4e; font-size:11.8px; margin-top:3px; font-weight:650; }",
    ".user-spent { color:#2f8f4e; font-size:11.8px; margin-top:3px; font-weight:650; }\n            .user-waiting { color:#9a6400; font-size:11.5px; margin-top:4px; font-weight:700; }\n            .waiting-detail-card { background:#fff8eb; border:1px solid #f4e1bb; border-radius:15px; padding:14px; margin-bottom:12px; }\n            .waiting-detail-title { font-size:14px; font-weight:800; margin-bottom:9px; }\n            .waiting-detail-item { background:#fff; border-radius:10px; padding:9px 10px; font-size:12.5px; font-weight:650; margin-top:6px; }\n            .waiting-detail-item small { display:block; color:#9a9a9e; font-weight:500; margin-top:3px; }",
    'admin waiting styles')
old = """                        <div class=\"user-orders-count\">${orderCount} ${orderCount === 1 ? 'заказ' : 'заказов'}</div>
                        <div class=\"user-spent\">${Number(user.totalSpent) > 0 ? money(user.totalSpent) : (orderCount ? 'сумма по клику' : 'без покупок')}</div>
"""
new = """                        <div class=\"user-orders-count\">${orderCount} ${orderCount === 1 ? 'заказ' : 'заказов'}</div>
                        <div class=\"user-spent\">${Number(user.totalSpent) > 0 ? money(user.totalSpent) : (orderCount ? 'сумма по клику' : 'без покупок')}</div>
                        ${Number(user.waitingCount) > 0 ? `<div class=\"user-waiting\">Ждёт: ${Number(user.waitingCount)} тов.</div>` : ''}
"""
s = replace_once(s, old, new, 'user waiting badge')
s = replace_once(s,
    'renderUserDetail(data.profile || {}, data.orders || []);',
    'renderUserDetail(data.profile || {}, data.orders || [], data.waitingItems || []);',
    'detail render call')
s = replace_once(s,
    'function renderUserDetail(profile, orders) {',
    'function renderUserDetail(profile, orders, waitingItems = []) {',
    'detail render signature')
old = """        const totalSpent = orders.length ? orders.reduce((sum, order) => sum + (Number(order.sum) || 0), 0) : Number(profile.totalSpent) || 0;
        const ordersHtml = orders.length ? orders.map((order, orderIndex) => {
"""
new = """        const totalSpent = orders.length ? orders.reduce((sum, order) => sum + (Number(order.sum) || 0), 0) : Number(profile.totalSpent) || 0;
        const waitingHtml = waitingItems.length ? waitingItems.map(item => `
            <div class=\"waiting-detail-item\">${esc(item.productName || item.productId)}<small>Нажал «Уведомить»: ${esc(formatDate(item.at))}</small></div>
        `).join('') : '<div class=\"waiting-empty\">Сейчас ничего не ожидает.</div>';
        const ordersHtml = orders.length ? orders.map((order, orderIndex) => {
"""
s = replace_once(s, old, new, 'detail waiting html')
old = """            </div>
            <div class=\"orders-heading\">История покупок</div>
            ${ordersHtml}
"""
new = """            </div>
            <div class=\"waiting-detail-card\"><div class=\"waiting-detail-title\">Ожидает поступления · ${waitingItems.length}</div>${waitingHtml}</div>
            <div class=\"orders-heading\">История покупок</div>
            ${ordersHtml}
"""
s = replace_once(s, old, new, 'detail waiting card')
p.write_text(s, encoding='utf-8')

# --- Connect new browser modules ---
p = Path('admin.html')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    '    <script src="/admin-enhancements.js?v=20260817a"></script>\n</body>',
    '    <script src="/admin-enhancements.js?v=20260817b"></script>\n    <script src="/admin-banner-tools.js?v=20260817a"></script>\n</body>',
    'admin scripts')
p.write_text(s, encoding='utf-8')

p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    '    <script src="/card-quality.js?v=20260817a"></script>\n</body>',
    '    <script src="/card-quality.js?v=20260817a"></script>\n    <script src="/home-banners.js?v=20260817a"></script>\n</body>',
    'storefront banner script')
p.write_text(s, encoding='utf-8')
