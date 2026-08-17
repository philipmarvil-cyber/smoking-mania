from pathlib import Path
import re

lib = Path('api/_catalog-lib.js')
text = lib.read_text(encoding='utf-8')
start = text.index('export async function loadCatalogData() {')
end = text.index('\nexport function extractId(', start)
new_func = r'''export async function loadCatalogData() {
    // ВАЖНО: раньше здесь был expand=images. По правилам МойСклад любой
    // список с expand ограничен 100 сущностями на страницу. На 7000+ товарах
    // это превращалось примерно в 70 страниц только товаров и периодически
    // упиралось в 60-секундный лимит Vercel. Сам список товаров можно получать
    // по 1000 на страницу; поле images без expand всё равно содержит meta.size.
    // Сами href картинок берём из прежнего KV-кэша, а для новых/изменённых
    // товаров существующий /api/product-image лениво запросит /images один раз
    // и закэширует результат. Так полный sync больше не тащит тысячи картинок.
    const [productRows, folderRows, stockRows, firstSeenStored, previousCatalog, previousImageHrefsRaw] = await Promise.all([
        fetchAllRows(`${API}/entity/product?limit=1000&filter=archived=false`),
        fetchAllRows(`${API}/entity/productfolder?limit=1000`),
        fetchAllRows(`${API}/report/stock/all?limit=1000`).catch(() => []),
        kvGetJson(FIRST_SEEN_KEY),
        kvGetCatalog(),
        kvGetJson(IMAGE_HREFS_KEY)
    ]);

    const previousProducts = new Map(
        (previousCatalog?.products || []).map(product => [product.id, product])
    );
    const previousImageHrefs = previousImageHrefsRaw && typeof previousImageHrefsRaw === 'object'
        ? previousImageHrefsRaw
        : {};
    const previousSyncedAt = Number(previousCatalog?.syncedAt) || 0;

    // Товары скрытых категорий (HIDDEN_CATEGORY_NAMES, любая глубина
    // вложенности) исключаем целиком, ещё до всего остального — чтобы они
    // не попадали ни в каталог, ни в поиск, откуда бы он ни читал allProducts.
    const hiddenFolderIds = getHiddenFolderIds(folderRows);
    const visibleProductRows = productRows.filter(p => {
        const folderId = extractId(p.productFolder?.meta?.href);
        if (!folderId) return false;
        return !hiddenFolderIds.has(folderId);
    });

    const stockById = {};
    stockRows.forEach(row => {
        const id = extractId(row.meta?.href);
        if (id) stockById[id] = row.quantity ?? row.stock ?? 0;
    });
    const stockReportHasData = stockRows.length > 0;

    const now = Date.now();
    const isFirstRun = !firstSeenStored;
    const firstSeen = firstSeenStored || {};
    const updatedFirstSeen = {};
    const imageHrefs = {};

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

        const previous = previousProducts.get(product.id);
        const metaImageSize = Number(product.images?.meta?.size);
        const previousImageCount = Number(previous?.imageCount) || (previous?.img ? 1 : 0);
        const imageCount = Number.isFinite(metaImageSize)
            ? Math.max(0, metaImageSize)
            : previousImageCount;

        // Если сущность товара менялась после последней успешной синхронизации,
        // не доверяем старому href изображения: просто выкидываем его из общей
        // карты. При первом показе /api/product-image безопасно получит свежий
        // /images и положит его в 7-дневный точечный кэш. Это также покрывает
        // замену/добавление/удаление фотографий без массовых image-запросов.
        const updatedAt = Date.parse(String(product.updated || '').replace(' ', 'T'));
        const changedSinceLastSync = !previous ||
            imageCount !== previousImageCount ||
            (previousSyncedAt > 0 && Number.isFinite(updatedAt) && updatedAt > previousSyncedAt);

        if (imageCount > 0 && !changedSinceLastSync && previousImageHrefs[product.id]) {
            imageHrefs[product.id] = previousImageHrefs[product.id];
        }

        const hasPhoto = imageCount > 0;
        const imgVer = hasPhoto
            ? (changedSinceLastSync
                ? shortHash([product.updated || '', imageCount].join('|'))
                : (previous?.imageVersion || shortHash([product.updated || '', imageCount].join('|'))))
            : '0';

        return {
            id: product.id,
            name: product.name,
            price: (product.salePrices?.[0]?.value || 0) / 100,
            img: hasPhoto ? `/api/product-image?id=${product.id}&v=${imgVer}` : '',
            imageCount: hasPhoto ? imageCount : 0,
            imageVersion: imgVer,
            description: product.description || '',
            folderId,
            stock: stock === null ? null : Math.max(0, stock),
            outOfStock: stock === null ? false : stock <= 0,
            isNew: seenAt !== BASELINE && (now - seenAt) < NEW_THRESHOLD_MS,
            firstSeenAt: seenAt === BASELINE ? 0 : seenAt
        };
    });

    await kvSetJson(FIRST_SEEN_KEY, updatedFirstSeen);
    // Оставляем только заведомо свежие старые href. Новые/изменённые картинки
    // лениво попадут в точечный 7-дневный кэш product-image.js.
    await kvSetJson(IMAGE_HREFS_KEY, imageHrefs);

    const categories = buildCategoryTree(folderRows);
    return { products, categories };
}
'''
text = text[:start] + new_func + text[end:]
lib.write_text(text, encoding='utf-8')

sync = Path('api/sync-catalog.js')
s = sync.read_text(encoding='utf-8')
s = s.replace(
    "import { loadCatalogData, kvGetCatalog, kvSetCatalog, notifyRestockedProducts } from './_catalog-lib.js';",
    "import { loadCatalogData, kvGetCatalog, kvSetCatalog, kvGetJson, kvSetJson, notifyRestockedProducts } from './_catalog-lib.js';"
)
old_handler_start = s.index('export default async function handler(req, res) {')
new_handler = r'''export default async function handler(req, res) {
    // Ручной запуск из админки — только с ADMIN_PANEL_KEY. GET оставлен для
    // существующего Vercel Cron и старых служебных вызовов.
    if (req.method === 'POST') {
        const requiredKey = process.env.ADMIN_PANEL_KEY;
        if (!requiredKey || req.query?.key !== requiredKey) {
            res.status(403).json({ success: false, error: 'Неверный ключ администратора' });
            return;
        }
    } else if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Метод не поддерживается' });
        return;
    }

    const lockKey = 'catalog-full-sync-lock:v1';
    const startedAt = Date.now();
    try {
        // Защищаем МойСклад от двойного ручного клика/совпадения с cron.
        // Lock сам протухает через 2 минуты, даже если Vercel оборвёт функцию.
        const activeSince = Number(await kvGetJson(lockKey)) || 0;
        if (activeSince && Date.now() - activeSince < 2 * 60 * 1000) {
            res.status(409).json({
                success: false,
                busy: true,
                error: 'Синхронизация уже запущена. Подождите немного и обновите статус.'
            });
            return;
        }
        await kvSetJson(lockKey, startedAt);

        const oldCatalog = await kvGetCatalog();
        const oldById = {};
        if (oldCatalog && Array.isArray(oldCatalog.products)) {
            oldCatalog.products.forEach(p => { oldById[p.id] = p; });
        }

        const data = await loadCatalogData();
        const saved = await kvSetCatalog({ ...data, syncedAt: Date.now() });
        if (!saved) throw new Error('Не удалось сохранить обновлённый каталог в KV');

        const { restockedCount, notified } = await notifyRestockedProducts(oldById, data.products);

        res.status(200).json({
            success: true,
            savedToKv: true,
            products: data.products.length,
            categories: data.categories.length,
            newItems: data.products.filter(p => p.isNew).length,
            restockedProducts: restockedCount,
            restockNotificationsSent: notified,
            durationMs: Date.now() - startedAt
        });
    } catch (e) {
        console.error('[sync-catalog] ошибка синхронизации:', e?.message, e?.stack);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        await kvSetJson(lockKey, 0).catch(() => {});
    }
}
'''
s = s[:old_handler_start] + new_handler
sync.write_text(s, encoding='utf-8')

admin = Path('admin.html')
a = admin.read_text(encoding='utf-8')
old = '''        try {\n            const res = await fetch('/api/sync-catalog');\n            const data = await res.json();\n            if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка синхронизации');\n            statusEl.innerHTML = `\n                ✅ Готово — товаров: <b>${data.products}</b>, категорий: <b>${data.categories}</b>,\n                новых: <b>${data.newItems}</b>${data.restockedProducts ? `, снова в наличии: <b>${data.restockedProducts}</b>` : ''}\n            `;\n            statusEl.style.color = '#1f7a4d';\n            document.getElementById('catalog-sync-info').textContent = 'Последнее обновление: только что';\n        } catch (e) {\n            statusEl.textContent = 'Не удалось обновить: ' + e.message;\n            statusEl.style.color = '#d9482b';\n        } finally {'''
new = '''        const startedAt = Date.now();\n        try {\n            const res = await fetch(`/api/sync-catalog?key=${encodeURIComponent(adminKey)}`, { method: 'POST' });\n            const raw = await res.text();\n            let data = null;\n            try { data = JSON.parse(raw); } catch (e) {}\n            if (!res.ok || !data?.success) {\n                if (res.status === 504) throw new Error('Vercel остановил синхронизацию по таймауту. Повторно нажимать сразу не нужно.');\n                throw new Error(data?.error || `Ошибка синхронизации (HTTP ${res.status})`);\n            }\n            const seconds = ((Number(data.durationMs) || (Date.now() - startedAt)) / 1000).toFixed(1);\n            statusEl.innerHTML = `\n                ✅ Готово за <b>${seconds} сек.</b> — товаров: <b>${data.products}</b>, категорий: <b>${data.categories}</b>,\n                новых: <b>${data.newItems}</b>${data.restockedProducts ? `, снова в наличии: <b>${data.restockedProducts}</b>` : ''}\n            `;\n            statusEl.style.color = '#1f7a4d';\n            document.getElementById('catalog-sync-info').textContent = 'Последнее обновление: только что';\n        } catch (e) {\n            statusEl.textContent = 'Не удалось обновить: ' + e.message;\n            statusEl.style.color = '#d9482b';\n        } finally {'''
if old not in a:
    raise SystemExit('admin sync block not found')
a = a.replace(old, new, 1)
a = a.replace("btn.textContent = 'Обновляем… это может занять минуту';", "btn.textContent = 'Обновляем каталог…';", 1)
admin.write_text(a, encoding='utf-8')
