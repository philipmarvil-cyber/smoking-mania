// Реестр пользователей Telegram + история покупок для админ-панели.
// Файл начинается с "_" — Vercel не создаёт отдельную serverless-функцию.
import { API, fetchJson, kvGetJson, kvSetJson, colorToHex } from './_catalog-lib.js';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const USER_IDS_KEY = 'telegram-users:v1';
const USER_PROFILE_PREFIX = 'telegram-user:v1:';
const USER_ORDERS_PREFIX = 'telegram-user-orders:v1:';
const USER_ORDER_IDS_PREFIX = 'telegram-user-order-ids:v1:';
const USER_ORDER_PREFIX = 'telegram-user-order:v1:';
const LEGACY_ORDERS_PREFIX = 'orders-by-user:';

function cleanUserId(value) {
    const id = String(value || '').trim();
    return /^\d{1,24}$/.test(id) ? id : '';
}

async function redis(command) {
    if (!KV_URL || !KV_TOKEN) return null;
    try {
        const response = await fetch(KV_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${KV_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(command)
        });
        if (!response.ok) return null;
        const body = await response.json().catch(() => null);
        return body && !body.error ? body.result : null;
    } catch (e) {
        return null;
    }
}

function parseJson(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (e) { return null; }
}

async function mgetJson(keys) {
    if (!keys.length) return [];
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        const result = await redis(['MGET', ...chunk]);
        out.push(...(Array.isArray(result) ? result.map(parseJson) : chunk.map(() => null)));
    }
    return out;
}

async function scanKeys(pattern) {
    const keys = [];
    let cursor = '0';
    let guard = 0;
    do {
        const result = await redis(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 250]);
        if (!Array.isArray(result) || result.length < 2) break;
        cursor = String(result[0] ?? '0');
        if (Array.isArray(result[1])) keys.push(...result[1]);
        guard++;
    } while (cursor !== '0' && guard < 40);
    return [...new Set(keys)];
}

export async function registerTelegramUser(input = {}) {
    const id = cleanUserId(input.id || input.telegramUserId);
    if (!id) return null;

    const now = Date.now();
    const key = USER_PROFILE_PREFIX + id;
    const current = (await kvGetJson(key)) || {};
    const profile = {
        id,
        firstName: String(input.firstName ?? input.first_name ?? current.firstName ?? '').slice(0, 120),
        lastName: String(input.lastName ?? input.last_name ?? current.lastName ?? '').slice(0, 120),
        username: String(input.username ?? current.username ?? '').replace(/^@/, '').slice(0, 80),
        photoUrl: String(input.photoUrl ?? input.photo_url ?? current.photoUrl ?? '').slice(0, 1000),
        phone: String(input.phone ?? current.phone ?? '').slice(0, 80),
        firstSeenAt: Number(current.firstSeenAt) || now,
        lastSeenAt: now,
        totalOrders: Number(current.totalOrders) || 0,
        totalSpent: Number(current.totalSpent) || 0
    };

    await Promise.all([
        redis(['SADD', USER_IDS_KEY, id]),
        kvSetJson(key, profile)
    ]);
    return profile;
}

export async function recordTelegramOrder(userInput = {}, order = {}, items = []) {
    const id = cleanUserId(userInput.id || userInput.telegramUserId);
    if (!id || !order?.id) return false;

    let profile = await registerTelegramUser(userInput);
    if (!profile) return false;

    const at = order.moment ? new Date(String(order.moment).replace(' ', 'T')).getTime() : Date.now();
    const safeAt = Number.isFinite(at) ? at : Date.now();
    const normalizedItems = (items || []).slice(0, 200).map(item => ({
        id: String(item.id || ''),
        name: String(item.name || 'Товар').slice(0, 300),
        quantity: Math.max(1, Number(item.qty ?? item.quantity) || 1),
        price: Math.max(0, Number(item.price) || 0)
    }));
    const sum = normalizedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const snapshot = {
        id: String(order.id),
        name: String(order.name || ''),
        moment: new Date(safeAt).toISOString(),
        sum,
        stateName: String(order.stateName || 'Оформлен'),
        stateColor: order.stateColor || null,
        positions: normalizedItems
    };

    const isNew = Number(await redis(['SADD', USER_ORDER_IDS_PREFIX + id, snapshot.id])) === 1;
    await Promise.all([
        redis(['ZADD', USER_ORDERS_PREFIX + id, safeAt, snapshot.id]),
        kvSetJson(`${USER_ORDER_PREFIX}${id}:${snapshot.id}`, snapshot)
    ]);

    if (isNew) {
        profile = (await kvGetJson(USER_PROFILE_PREFIX + id)) || profile;
        profile.totalOrders = (Number(profile.totalOrders) || 0) + 1;
        profile.totalSpent = (Number(profile.totalSpent) || 0) + sum;
        profile.lastSeenAt = Date.now();
        if (userInput.phone) profile.phone = String(userInput.phone).slice(0, 80);
        await kvSetJson(USER_PROFILE_PREFIX + id, profile);
    }
    return true;
}

function normalizeFallbackProfile(id, notifyById, legacyOrderCount) {
    const n = notifyById.get(id) || {};
    return {
        id,
        firstName: String(n.name || ''),
        lastName: '',
        username: String(n.username || '').replace(/^@/, ''),
        photoUrl: '',
        phone: '',
        firstSeenAt: Number(n.at) || 0,
        lastSeenAt: Number(n.at) || 0,
        totalOrders: legacyOrderCount || 0,
        totalSpent: 0,
        legacy: true
    };
}

export async function getAdminUsers(notifyEntries = []) {
    const ids = new Set((await redis(['SMEMBERS', USER_IDS_KEY])) || []);
    const legacyKeys = await scanKeys(`${LEGACY_ORDERS_PREFIX}*`);
    legacyKeys.forEach(key => ids.add(String(key).slice(LEGACY_ORDERS_PREFIX.length)));

    const notifyById = new Map();
    for (const entry of notifyEntries || []) {
        const id = cleanUserId(entry.telegramUserId);
        if (!id) continue;
        ids.add(id);
        const old = notifyById.get(id);
        if (!old || Number(entry.at) > Number(old.at)) notifyById.set(id, entry);
    }

    const idList = [...ids].filter(cleanUserId);
    const [profiles, legacyLists] = await Promise.all([
        mgetJson(idList.map(id => USER_PROFILE_PREFIX + id)),
        mgetJson(idList.map(id => LEGACY_ORDERS_PREFIX + id))
    ]);

    const users = idList.map((id, i) => {
        const legacyIds = Array.isArray(legacyLists[i]) ? legacyLists[i] : [];
        const p = profiles[i] || normalizeFallbackProfile(id, notifyById, legacyIds.length);
        return {
            ...p,
            id,
            totalOrders: Math.max(Number(p.totalOrders) || 0, legacyIds.length),
            hasLegacyOrders: legacyIds.length > 0
        };
    }).sort((a, b) => (Number(b.lastSeenAt) || Number(b.firstSeenAt) || 0) - (Number(a.lastSeenAt) || Number(a.firstSeenAt) || 0));

    return {
        users,
        stats: {
            totalUsers: users.length,
            buyers: users.filter(u => Number(u.totalOrders) > 0).length,
            totalOrders: users.reduce((sum, u) => sum + (Number(u.totalOrders) || 0), 0),
            knownRevenue: users.reduce((sum, u) => sum + (Number(u.totalSpent) || 0), 0)
        }
    };
}

function mapLiveOrder(order) {
    return {
        id: order.id,
        name: order.name,
        stateName: order.state?.name || 'Оформлен',
        stateColor: colorToHex(order.state?.color),
        moment: (order.moment || '').replace(' ', 'T'),
        sum: (order.sum || 0) / 100,
        description: order.description || '',
        positions: (order.positions?.rows || []).map(p => ({
            name: p.assortment?.name || 'Товар',
            quantity: p.quantity || 1,
            price: (p.price || 0) / 100
        }))
    };
}

function readDescriptionField(description, label) {
    const line = String(description || '').split(/\r?\n/).find(x => x.toLowerCase().startsWith(label.toLowerCase() + ':'));
    return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

export async function getAdminUserDetail(rawId) {
    const id = cleanUserId(rawId);
    if (!id) return null;

    let profile = (await kvGetJson(USER_PROFILE_PREFIX + id)) || normalizeFallbackProfile(id, new Map(), 0);
    const newIds = (await redis(['ZRANGE', USER_ORDERS_PREFIX + id, '0', '49', 'REV'])) || [];
    const legacyIds = (await kvGetJson(LEGACY_ORDERS_PREFIX + id)) || [];
    const orderIds = [...new Set([...newIds, ...(Array.isArray(legacyIds) ? legacyIds : [])])].slice(0, 30);

    const snapshots = await mgetJson(orderIds.map(orderId => `${USER_ORDER_PREFIX}${id}:${orderId}`));
    const missing = orderIds.filter((_, i) => !snapshots[i]);
    const liveMap = new Map();

    if (missing.length) {
        const live = await Promise.all(missing.map(orderId =>
            fetchJson(`${API}/entity/customerorder/${orderId}?expand=state,positions.assortment`).catch(() => null)
        ));
        live.filter(Boolean).forEach(order => liveMap.set(order.id, mapLiveOrder(order)));
    }

    const orders = orderIds.map((orderId, i) => snapshots[i] || liveMap.get(orderId)).filter(Boolean)
        .sort((a, b) => new Date(b.moment || 0) - new Date(a.moment || 0));

    const firstWithDescription = orders.find(o => o.description);
    if (firstWithDescription) {
        const name = readDescriptionField(firstWithDescription.description, 'Клиент');
        const phone = readDescriptionField(firstWithDescription.description, 'Телефон');
        if (name && !profile.firstName && !profile.lastName) profile.firstName = name;
        if (phone && !profile.phone) profile.phone = phone;
    }

    return {
        profile: {
            ...profile,
            id,
            totalOrders: orders.length || Number(profile.totalOrders) || 0,
            totalSpent: orders.length ? orders.reduce((sum, o) => sum + (Number(o.sum) || 0), 0) : Number(profile.totalSpent) || 0
        },
        orders
    };
}
