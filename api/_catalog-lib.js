// Общий модуль: поход в МойСклад + работа с Vercel KV.
// Имя файла начинается с "_" — Vercel не создаёт для него отдельный API-роут.

const MY_SKLAD_TOKEN = process.env.MY_SKLAD_TOKEN;
if (!MY_SKLAD_TOKEN) {
    throw new Error('Не задана переменная окружения MY_SKLAD_TOKEN — добавьте её в настройках проекта на Vercel и сделайте Redeploy');
}

export const API = "https://api.moysklad.ru/api/remap/1.2";
const HEADERS = {
    "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
    "Content-Type": "application/json"
};

const CATALOG_KEY = 'catalog:v2'; // v2 — формат стал компактным (только нужные поля)

// Дата "первого появления" каждого товара: { productId: timestampMs }.
// При самом первом запуске все существующие товары получают метку BASELINE (0)
// и не считаются новинками. Новинки — только то, что появилось после.
const FIRST_SEEN_KEY = 'product-first-seen:v1';
const IMAGE_HREFS_KEY = 'image-hrefs:v1';
const BASELINE = 0;

const NEW_THRESHOLD_MS = 20 * 24 * 60 * 60 * 1000; // 20 дней

// Единый список полностью скрытых категорий — не показываются в каталоге
// И не должны находиться через поиск. Раньше это исключение делалось в
// двух разных, несогласованных местах (одно для списка категорий, другое
// клиентское — для поиска), из-за чего товары скрытых разделов всё равно
// просачивались в поиск. Теперь один список, и товары фильтруются здесь же,
// на сервере, вместе с ЛЮБОЙ вложенностью подкатегорий — не только прямые
// подкатегории, а вообще все уровни вниз.
// "katalog" сюда не входит — это не скрытая категория, а служебная папка-
// обёртка, её содержимое, наоборот, поднимается на видимый верхний уровень
// (см. buildCategoryTree ниже).
const HIDDEN_CATEGORY_NAMES = [
    'sale (распродажа)',
    'электронки',
    'жевательный табак',
    'самокруточный табак',
    'жидкости',
    'оэсдн'
];

// =====================================================================
// Vercel KV (Upstash) через REST API напрямую, без доп. npm-пакетов.
// =====================================================================
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function isKvConfigured() {
    return !!(KV_URL && KV_TOKEN);
}

export async function kvGetJson(key) {
    if (!KV_URL || !KV_TOKEN) return null;
    try {
        const response = await fetch(`${KV_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        if (!response.ok) {
            console.error(`[kvGetJson] HTTP ${response.status} для ключа "${key}"`);
            return null;
        }
        const body = await response.json();
        if (body.error) {
            console.error(`[kvGetJson] KV вернул ошибку для ключа "${key}":`, body.error);
            return null;
        }
        if (!body.result) return null;
        return JSON.parse(body.result);
    } catch (e) {
        console.error(`[kvGetJson] исключение для ключа "${key}":`, e?.message);
        return null;
    }
}

export async function kvSetJson(key, value) {
    if (!KV_URL || !KV_TOKEN) return false;
    try {
        const response = await fetch(`${KV_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_TOKEN}` },
            body: JSON.stringify(value)
        });
        if (!response.ok) {
            console.error(`[kvSetJson] HTTP ${response.status} для ключа "${key}"`);
            return false;
        }
        // ВАЖНО: у Upstash REST API бывает так, что HTTP-статус 200, а сама
        // команда всё равно не выполнилась — ошибка тогда видна только в теле
        // ответа. Раньше это тихо считалось успехом.
        const body = await response.json().catch(() => null);
        if (body?.error) {
            console.error(`[kvSetJson] KV вернул ошибку для ключа "${key}":`, body.error);
            return false;
        }
        return true;
    } catch (e) {
        console.error(`[kvSetJson] исключение для ключа "${key}":`, e?.message);
        return false;
    }
}

export async function kvGetCatalog() {
    return kvGetJson(CATALOG_KEY);
}

export async function kvSetCatalog(value) {
    return kvSetJson(CATALOG_KEY, value);
}

// =====================================================================
// Глобальный ограничитель скорости запросов к МойСклад.
// Лимиты склада: 45 запросов / 3 сек, не более 5 параллельных.
// Раньше здесь стояло 5 параллельных / ~14 запросов в сек, чтобы уложить
// полную синхронизацию в 60-секундный лимит функции Vercel — но после
// добавления вебхука, который теперь дёргает обновление остатков при
// каждом изменении заказа, суммарная нагрузка на API МойСклад выросла, и
// сотруднику ограничили доступ к JSON API. Возвращаем более щадящие
// настройки; таймаут синхронизации решаем через кулдаун (см. ниже), а не
// через агрессивную скорость запросов.
const MS_MAX_CONCURRENT = 3;
const MS_MIN_INTERVAL_MS = 100; // ~10 запросов/сек, с хорошим запасом

let msActive = 0;
let msLastStart = 0;
const msQueue = [];

function msAcquire() {
    return new Promise(resolve => {
        msQueue.push(resolve);
        msPump();
    });
}

function msPump() {
    if (!msQueue.length || msActive >= MS_MAX_CONCURRENT) return;
    const wait = Math.max(0, msLastStart + MS_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) { setTimeout(msPump, wait); return; }
    msActive++;
    msLastStart = Date.now();
    msQueue.shift()();
}

function msRelease() {
    msActive--;
    msPump();
}

// Единственная точка входа для ВСЕХ запросов к МойСклад.
// Троттлинг + ретраи на 429 с уважением Retry-After.
export async function fetchJson(url, options = {}, attempt = 1) {
    await msAcquire();
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: { ...HEADERS, ...(options.headers || {}) }
        });
    } finally {
        msRelease();
    }

    if (response.status === 429) {
        if (attempt > 5) {
            throw new Error('Склад отвечает статусом 429 (слишком много запросов) даже после нескольких повторов');
        }
        const lognexRetryMs = response.headers.get('X-Lognex-Retry-After');
        const retryAfterSec = response.headers.get('Retry-After');
        let waitMs = 2000 * attempt;
        if (lognexRetryMs && !isNaN(parseInt(lognexRetryMs, 10))) {
            waitMs = Math.max(waitMs, parseInt(lognexRetryMs, 10));
        } else if (retryAfterSec && !isNaN(parseInt(retryAfterSec, 10))) {
            waitMs = Math.max(waitMs, parseInt(retryAfterSec, 10) * 1000);
        }
        await sleep(waitMs);
        return fetchJson(url, options, attempt + 1);
    }

    // 502/503/504 — временная недоступность самого МойСклад (перегрузка,
    // технические работы и т.п.), не наша ошибка запроса. Раньше это сразу
    // валило всю синхронизацию (в т.ч. на 200-й же странице из тысяч), хотя
    // повторный запрос через пару секунд обычно проходит нормально —
    // ретраим так же, как и 429, просто с фиксированной паузой.
    if ([502, 503, 504].includes(response.status)) {
        if (attempt > 5) {
            throw new Error(`Склад отвечает статусом ${response.status} даже после нескольких повторов — похоже, МойСклад сейчас недоступен`);
        }
        await sleep(3000 * attempt);
        return fetchJson(url, options, attempt + 1);
    }

    if (!response.ok) {
        let detail = '';
        try {
            const body = await response.json();
            detail = body?.errors?.[0]?.error || body?.errors?.[0]?.moreInfo || JSON.stringify(body);
        } catch (e) {}
        throw new Error(`Склад ответил статусом ${response.status} при запросе ${url}${detail ? ` — ${detail}` : ''}`);
    }
    return response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Скачивание бинарного файла (картинки) с авторизацией — через тот же троттлер,
// что и обычные JSON-запросы, чтобы не пробивать лимит МойСклад параллельно.
export async function fetchBinary(url) {
    await msAcquire();
    let response;
    try {
        response = await fetch(url, { headers: HEADERS });
    } finally {
        msRelease();
    }
    if (!response.ok) {
        throw new Error(`Не удалось скачать файл: ${response.status}`);
    }
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || 'image/jpeg'
    };
}

// Сравнивает старое/новое состояние остатков и рассылает уведомления тем,
// кто нажимал "Уведомить о поступлении" для товара, который был "нет в
// наличии", а теперь снова доступен. Общая логика для sync-catalog.js
// (полная синхронизация) И refreshAllStock (лёгкое обновление по вебхуку/
// при обычной загрузке каталога) — раньше это умела делать только полная
// синхронизация, и уведомления не приходили, если остаток обновлялся
// только "лёгким" путём.
export async function notifyRestockedProducts(oldById, newProducts) {
    let notified = 0;
    const restocked = newProducts.filter(p => {
        const before = oldById[p.id];
        return before && before.outOfStock && !p.outOfStock;
    });
    for (const product of restocked) {
        const key = `restock:${product.id}`;
        const subscribers = await kvGetJson(key);
        if (!subscribers || !subscribers.length) continue;
        await Promise.all(subscribers.map(chatId =>
            sendTelegramMessage(chatId, `✅ «${product.name}» снова в наличии!`)
        ));
        notified += subscribers.length;
        await kvSetJson(key, []);
    }
    return { restockedCount: restocked.length, notified };
}

// =====================================================================
// Лёгкое обновление ТОЛЬКО остатков в уже закэшированном каталоге — без
// картинок, папок и т.п. Не ждём ночную полную синхронизацию: дёргаем
// это при любом изменении заказа (создание/смена статуса/удаление) через
// вебхук, чтобы остаток был актуален почти сразу, даже если заказ
// поменяли/удалили прямо в МойСклад, а не через бота.
//
// ВАЖНО: сотрудники МойСклад в рабочий день правят заказы десятки раз —
// каждое такое действие теперь шлёт нам вебхук. Без ограничения частоты
// это означало бы отдельный полный запрос отчёта по остаткам на КАЖДОЕ
// такое действие, что перегружает API и может привести к ограничению
// доступа со стороны МойСклад. Поэтому обновляем остатки не чаще, чем
// раз в REFRESH_COOLDOWN_MS — этого более чем достаточно для "почти
// мгновенно", и совершенно безопасно по нагрузке.
const REFRESH_COOLDOWN_MS = 3 * 60 * 1000; // не чаще раза в 3 минуты
const REFRESH_COOLDOWN_KEY = 'stock-refresh-cooldown';

export async function refreshAllStock() {
    const lastRun = await kvGetJson(REFRESH_COOLDOWN_KEY);
    if (lastRun && Date.now() - lastRun < REFRESH_COOLDOWN_MS) return false; // ещё рано, недавно уже обновляли
    await kvSetJson(REFRESH_COOLDOWN_KEY, Date.now()); // ставим "занято" сразу, до самого запроса

    const catalog = await kvGetCatalog();
    if (!catalog || !Array.isArray(catalog.products) || !catalog.products.length) return false;

    const stockRows = await fetchAllRows(`${API}/report/stock/all?limit=1000`).catch(() => null);
    if (!stockRows) return false; // не удалось получить отчёт — кэш не трогаем

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        if (id) stockById[id] = row.quantity ?? row.stock ?? 0;
    });
    const stockReportHasData = stockRows.length > 0;

    // Снимок "было" — до перезаписи — нужен, чтобы понять, какие товары
    // именно СЕЙЧАС появились в наличии (а не просто были в наличии всегда).
    const beforeById = {};
    catalog.products.forEach(p => { beforeById[p.id] = { outOfStock: p.outOfStock }; });

    catalog.products.forEach(product => {
        const stock = stockById.hasOwnProperty(product.id)
            ? stockById[product.id]
            : (stockReportHasData ? 0 : null);
        product.stock = stock === null ? null : Math.max(0, stock);
        product.outOfStock = stock === null ? false : stock <= 0;
    });

    const saved = await kvSetCatalog(catalog);
    // Уведомляем подписавшихся на "Уведомить о поступлении" — раньше это
    // делала только ночная полная синхронизация, и уведомления не приходили,
    // если остаток обновлялся этим "лёгким" путём (через вебхук или при
    // обычной загрузке каталога).
    await notifyRestockedProducts(beforeById, catalog.products).catch(() => {});
    return saved;
}

// =====================================================================
// Тяжёлая загрузка каталога из МойСклад. Вызывается из /api/sync-catalog.
// Товары грузим с expand=images (лимит при expand — 100 на страницу),
// чтобы ссылки на фото попали в каталог сразу и фронту не нужны были
// сотни отдельных запросов за картинками.
// =====================================================================
export async function loadCatalogData() {
    const [productRows, folderRows, stockRows, firstSeenStored] = await Promise.all([
        fetchAllRows(`${API}/entity/product?limit=100&expand=images&filter=archived=false`),
        fetchAllRows(`${API}/entity/productfolder?limit=1000`),
        fetchAllRows(`${API}/report/stock/all?limit=1000`).catch(() => []),
        kvGetJson(FIRST_SEEN_KEY)
    ]);

    // Товары скрытых категорий (HIDDEN_CATEGORY_NAMES, любая глубина
    // вложенности) исключаем целиком, ещё до всего остального — чтобы они
    // не попадали ни в каталог, ни в поиск, откуда бы он ни читал allProducts.
    const hiddenFolderIds = getHiddenFolderIds(folderRows);
    const visibleProductRows = productRows.filter(p => {
        const folderId = extractId(p.productFolder?.meta?.href);
        // Товар без назначенной категории раньше всё равно попадал в
        // allProducts на фронте — не виден ни в одной категории, но
        // "протекал" в "Новинки" на главной и в поиск. Пока в МойСклад не
        // назначена категория — товар в боте вообще не должен появляться.
        if (!folderId) return false;
        return !hiddenFolderIds.has(folderId);
    });

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        // "quantity" в отчёте МойСклад — это уже ДОСТУПНОЕ количество
        // (остаток − резерв + ожидание), а не просто физический остаток.
        // Именно оно должно определять "нет в наличии" на витрине —
        // иначе зарезервированный при заказе товар продолжал бы выглядеть
        // доступным, пока склад физически его не спишет.
        if (id) stockById[id] = row.quantity ?? row.stock ?? 0;
    });
    const stockReportHasData = stockRows.length > 0;

    const now = Date.now();
    const isFirstRun = !firstSeenStored;
    const firstSeen = firstSeenStored || {};
    const updatedFirstSeen = {};
    const imageHrefs = {};

    // Компактный формат: только те поля, которые реально использует фронтенд.
    // Полные объекты МойСклад весят в ~20 раз больше и тормозят загрузку.
    const products = visibleProductRows.map(product => {
        const folderId = extractId(product.productFolder?.meta?.href);
        const stock = stockById.hasOwnProperty(product.id)
            ? stockById[product.id]
            : (stockReportHasData ? 0 : null);

        let seenAt;
        if (firstSeen.hasOwnProperty(product.id)) {
            seenAt = firstSeen[product.id];
        } else {
            seenAt = isFirstRun ? BASELINE : now;
        }
        updatedFirstSeen[product.id] = seenAt;

        // ВАЖНО: downloadHref из МойСклад требует заголовок Authorization — браузер
        // не может подставить его в <img src>, поэтому раньше вместо фото показывались
        // "битые картинки" (кубики). Отдаём фронту не сам downloadHref, а свой прокси-урл:
        // /api/product-image сам сходит в МойСклад с токеном и отдаст готовый файл.
        const imageRow = product.images?.rows?.[0];
        const hasPhoto = !!imageRow;
        const miniHref = hasPhoto ? (imageRow.miniature?.downloadHref || '') : '';
        // Оригинал сюда больше не кладём: при массовой синхронизации
        // (expand=images) МойСклад его в этом ответе не отдаёт — только
        // миниатюру. Полноразмерное фото для страницы товара теперь всегда
        // добывается отдельно, точечным запросом (см. api/product-image.js).
        if (hasPhoto) imageHrefs[product.id] = miniHref;
        // "Версия" картинки в URL: меняется сама, когда в МойСклад реально
        // заменили фото (ссылка на файл стала другой) — раньше вместо этого
        // в index.html был зашит один и тот же статичный "&v=3" на все товары
        // и на все времена, поэтому браузер/CDN у тех, кто уже открывал
        // карточку, продолжали показывать старую картинку из своего
        // 7-дневного кэша даже после замены фото в МойСклад.
        const imgVer = shortHash(miniHref);

        return {
            id: product.id,
            name: product.name,
            price: (product.salePrices?.[0]?.value || 0) / 100,
            img: hasPhoto ? `/api/product-image?id=${product.id}&v=${imgVer}` : '',
            description: product.description || '',
            folderId,
            stock: stock === null ? null : Math.max(0, stock), // доступное количество; null = учёт остатков выключен в МойСклад
            outOfStock: stock === null ? false : stock <= 0,
            isNew: seenAt !== BASELINE && (now - seenAt) < NEW_THRESHOLD_MS,
            firstSeenAt: seenAt === BASELINE ? 0 : seenAt
        };
    });

    await kvSetJson(FIRST_SEEN_KEY, updatedFirstSeen);
    // Ссылки на картинки уже пришли вместе с товарами (expand=images) — сохраняем
    // их все ОДНИМ запросом в KV. Это значит, что /api/product-image почти никогда
    // не должен сам ходить в МойСклад за ссылкой — только доставать готовую отсюда.
    // Раньше он делал это поштучно "по требованию" для каждого товара, и именно
    // всплеск таких запросов (GET .../images) привёл к ограничению доступа к API.
    await kvSetJson(IMAGE_HREFS_KEY, imageHrefs);

    const categories = buildCategoryTree(folderRows);
    return { products, categories };
}

export function extractId(href) {
    if (!href) return null;
    return href.split('/').pop().split('?')[0];
}

// Короткий детерминированный хэш строки — используется как "версия" картинки
// товара в её URL (см. loadCatalogData). Ссылка МойСклад на файл содержит
// собственный id этого файла, и когда в МойСклад заменяют фото товара —
// старое изображение удаляется и подгружается новое, с другим id файла,
// то есть с другой ссылкой. Поэтому хэш от этой ссылки меняется ровно тогда,
// когда реально поменялась картинка — и никогда просто так.
export function shortHash(str) {
    if (!str) return '0';
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

// МойСклад хранит цвет статуса заказа как целое число (decimal RGB) —
// фронту нужен обычный CSS-цвет вида "#rrggbb". Общий хелпер (раньше был
// продублирован в my-orders.js).
export function colorToHex(color) {
    if (typeof color !== 'number') return null;
    return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
}

// Карта id товара → готовая ссылка на картинку, собранная разом во время
// полной синхронизации (см. loadCatalogData). Позволяет /api/product-image
// почти никогда не ходить в МойСклад за ссылкой поштучно.
export async function getImageHrefsMap() {
    return (await kvGetJson(IMAGE_HREFS_KEY)) || {};
}

// =====================================================================
// Отправка сообщений клиенту в Telegram (уведомления о статусе заказа
// и о появлении товара в наличии) через Bot API.
// =====================================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export function isTelegramConfigured() {
    return !!TELEGRAM_BOT_TOKEN;
}

// Юзернейм администратора (без "@"), которому шлём уведомления о клиентах,
// нажавших "Уведомить". Можно переопределить переменной окружения
// ADMIN_TELEGRAM_USERNAME, не трогая код. chat_id самого админа Telegram
// по юзернейму напрямую не отдаёт (это ограничение самого Bot API, не наше) —
// поэтому chat_id узнаём автоматически, как только админ сам хоть раз
// напишет что-нибудь боту (см. api/telegram-webhook.js), и дальше уже
// используем сохранённый в KV chat_id.
export const ADMIN_TELEGRAM_USERNAME = (process.env.ADMIN_TELEGRAM_USERNAME || 'propervoperpropervoperpropervope').replace(/^@/, '').toLowerCase();
export const ADMIN_CHAT_ID_KEY = 'admin-chat-id:v1'; // старый формат — один chat_id; оставлен ради обратной совместимости
export const ADMIN_CHAT_IDS_KEY = 'admin-chat-ids:v1'; // новый формат — список { chatId, username, addedAt }
export const ADMIN_PENDING_USERNAMES_KEY = 'admin-pending-usernames:v1'; // юзернеймы, добавленные в личном кабинете, но ещё не написавшие боту

// Единый список chat_id всех администраторов (без разбивки по типу
// уведомлений) — используется только для диагностики (/api/kv-status).
export async function getAllAdminChatIds() {
    const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
    const ids = new Set(list.map(a => a.chatId));
    const legacy = await kvGetJson(ADMIN_CHAT_ID_KEY);
    if (legacy) ids.add(legacy);
    return [...ids];
}

// Список chat_id админов, которым нужно слать уведомления КОНКРЕТНОГО типа —
// 'orders' (новый заказ) или 'restock' ("Уведомить о поступлении"). У каждого
// админа в ADMIN_CHAT_IDS_KEY может быть свой набор notifyOrders/notifyRestock
// (задаётся при добавлении в личном кабинете) — если поле не указано (старые
// записи, самый первый/основной админ), по умолчанию считаем, что нужны ОБА
// типа, чтобы никто не перестал получать уведомления при миграции.
export async function getAdminChatIdsForType(type) {
    const field = type === 'restock' ? 'notifyRestock' : 'notifyOrders';
    // Если поле явно не задано (запись создана до появления разделения по
    // типам) — по умолчанию считаем "заказы: да", "уведомить о поступлении:
    // нет". Раньше оба типа по умолчанию считались "да", из-за чего админ,
    // которому в личном кабинете чекбокс честно показывал "выключено", всё
    // равно продолжал получать уведомления о поступлении — интерфейс не врал,
    // врала как раз эта логика отправки.
    const defaultIncluded = type !== 'restock';
    const list = (await kvGetJson(ADMIN_CHAT_IDS_KEY)) || [];
    const ids = new Set(
        list
            .filter(a => (a[field] === undefined ? defaultIncluded : a[field] === true))
            .map(a => a.chatId)
    );
    const legacy = await kvGetJson(ADMIN_CHAT_ID_KEY);
    if (legacy) ids.add(legacy); // самый первый (старого формата) админ — всегда оба типа
    return [...ids];
}

// Шлёт сообщение всем администраторам, подписанным на этот тип уведомлений.
// Ошибка отправки одному не должна мешать остальным — поэтому
// Promise.allSettled, а не Promise.all.
export async function sendToAdminsForType(type, text) {
    const ids = await getAdminChatIdsForType(type);
    await Promise.allSettled(ids.map(id => sendTelegramMessage(id, text)));
}

export async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

// Живой (не кэшированный) остаток по конкретным товарам — используется при
// оформлении заказа, чтобы проверять доступное количество не по вчерашнему
// кэшу каталога, а по факту на складе прямо сейчас.
export async function getLiveStock(productIds) {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (!ids.length) return {};
    const params = new URLSearchParams();
    ids.forEach(id => params.append('filter', `product=${API}/entity/product/${id}`));
    const data = await fetchJson(`${API}/report/stock/all?${params.toString()}`);
    const result = {};
    (data.rows || []).forEach(row => {
        const id = extractId(row.meta?.href);
        // "quantity" — уже доступное количество (остаток − резерв + ожидание).
        if (id) result[id] = row.quantity ?? row.stock ?? 0;
    });
    return result;
}

// Страницы грузим параллельно (ограничено общим троттлером выше) —
// раньше грузили строго по одной, и с каталогом в 7000+ товаров это
// упиралось в 60-секундный лимит функции на Vercel. 3 одновременно —
// баланс между скоростью и бережным отношением к лимитам МойСклад.
const PAGE_CONCURRENCY = 3;

async function fetchAllRows(url) {
    const first = await fetchJson(url);
    let rows = first.rows || [];
    const meta = first.meta;

    if (meta && typeof meta.size === 'number' && typeof meta.limit === 'number' && meta.size > rows.length) {
        const pageCount = Math.ceil(meta.size / meta.limit);
        const pageUrls = [];
        for (let page = 1; page < pageCount; page++) {
            pageUrls.push(withOffset(url, page * meta.limit));
        }
        const pages = await fetchWithLimitedConcurrency(pageUrls, PAGE_CONCURRENCY);
        pages.forEach(p => { rows = rows.concat(p.rows || []); });
    }

    return rows;
}

async function fetchWithLimitedConcurrency(urls, concurrency) {
    const results = new Array(urls.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < urls.length) {
            const current = nextIndex++;
            results[current] = await fetchJson(urls[current]);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

function withOffset(url, offset) {
    try {
        const u = new URL(url);
        u.searchParams.set('offset', String(offset));
        return u.toString();
    } catch (e) {
        console.error(`[withOffset] не удалось разобрать URL для страницы: "${url}" (offset=${offset}):`, e?.message);
        throw new Error(`Не удалось построить адрес страницы №${offset} каталога (см. логи Vercel для функции sync-catalog — там exact URL)`);
    }
}

function getParentFolderId(folder) {
    return extractId(folder.productFolder?.meta?.href);
}

function normalizeName(name) {
    return (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Находит id всех скрытых категорий (HIDDEN_CATEGORY_NAMES) и ЛЮБЫХ их
// потомков, на любую глубину вложенности — не только прямые подкатегории.
function getHiddenFolderIds(allFolders) {
    const hiddenIds = new Set();
    allFolders.forEach(f => {
        if (HIDDEN_CATEGORY_NAMES.includes(normalizeName(f.name))) hiddenIds.add(f.id);
    });
    // Несколько проходов вниз по дереву, пока не перестанут находиться новые
    // потомки — так собираются все уровни вложенности, а не только первый.
    let changed = true;
    while (changed) {
        changed = false;
        allFolders.forEach(f => {
            const parentId = getParentFolderId(f);
            if (parentId && hiddenIds.has(parentId) && !hiddenIds.has(f.id)) {
                hiddenIds.add(f.id);
                changed = true;
            }
        });
    }
    return hiddenIds;
}

export function buildCategoryTree(allFolders) {
    const EXCLUDED_NAMES = ['katalog', ...HIDDEN_CATEGORY_NAMES];
    const isHidden = f => EXCLUDED_NAMES.includes(normalizeName(f.name));

    const katalogFolder = allFolders.find(f => normalizeName(f.name) === 'katalog');

    // ВАЖНО: раньше здесь фильтровались по имени только "прочие" корневые
    // папки (otherTopFolders) — а дети служебной папки "katalog" (именно
    // они обычно и есть видимые верхние категории каталога) не проверялись
    // вообще. Если скрытая категория лежала именно там — она проходила
    // насквозь, что и было причиной "скрытые категории всё равно видны".
    const katalogChildren = katalogFolder
        ? allFolders.filter(f => getParentFolderId(f) === katalogFolder.id && !isHidden(f))
        : [];

    const rootFolders = allFolders.filter(f => getParentFolderId(f) === null);
    const otherTopFolders = rootFolders.filter(f => !isHidden(f));

    const displayFolders = [...katalogChildren, ...otherTopFolders];

    // Рекурсивно строим дерево на ЛЮБУЮ глубину вложенности. Раньше
    // подкатегории собирались только один уровень вниз (прямые дети),
    // и товары из под-подкатегорий (3-й уровень и глубже) не попадали
    // ни в одну категорию/подкатегорию во фронтенде — их folderId не
    // совпадал ни с cat.id, ни с id прямых подкатегорий.
    function buildNode(folder) {
        const children = allFolders
            .filter(f => getParentFolderId(f) === folder.id && !isHidden(f))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
        return {
            id: folder.id,
            name: folder.name,
            subcategories: children.map(buildNode)
        };
    }

    return displayFolders.map(buildNode);
}
