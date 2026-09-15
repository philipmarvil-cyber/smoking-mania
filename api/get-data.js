// Отдаёт каталог фронтенду. Обычная загрузка читает готовый каталог из KV
// и НЕ ждёт живого запроса к МойСклад. Обновление остатков запускается
// отдельно через ?refresh=1 уже после первого рендера интерфейса.
import { kvGetCatalog, kvSetCatalog, loadCatalogData, refreshAllStock, kvGetJson } from './_catalog-lib.js';
import { PRODUCT_IMAGE_BLOB_INDEX_KEY, normalizeProductImageBlobIndex, directBlobCardUrl } from './blob-image-index.js';

function requestOrigin(req) {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
}

function optimizedFallbackCardUrl(req, product) {
    if (!product?.id || Number(product.imageCount || 0) <= 0) return '';
    const version = String(product.imageVersion || '0');
    if (version === '0') return '';
    const origin = requestOrigin(req);
    if (!origin) return '';
    return `${origin}/api/product-card?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}`;
}

function normalizedCategoryName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
}

function splitDiscountCategory(categories) {
    const hiddenFolderIds = new Set();

    function collect(node, inheritedHidden = false) {
        if (!node) return;
        const hidden = inheritedHidden || normalizedCategoryName(node.name) === 'дисконт';
        if (hidden && node.id) hiddenFolderIds.add(String(node.id));
        (node.subcategories || []).forEach(child => collect(child, hidden));
    }

    (categories || []).forEach(cat => collect(cat, false));

    return {
        hiddenFolderIds,
        categories: (categories || []).filter(cat => normalizedCategoryName(cat?.name) !== 'дисконт')
    };
}

export default async function handler(req, res) {
    try {
        let catalog = await kvGetCatalog();
        let isColdStart = false;

        if (!catalog) {
            isColdStart = true;
            catalog = await loadCatalogData();
            await kvSetCatalog({ ...catalog, syncedAt: Date.now() });
        }

        if (!isColdStart && req.query.refresh === '1') {
            const refreshed = await refreshAllStock().catch(() => false);
            if (refreshed) catalog = await kvGetCatalog();
        }

        // Полный откат раздела «Дисконт»: одного скрытия плитки недостаточно,
        // потому что товары этой папки уже лежат в KV и продолжали попадать
        // в общие ленты (в том числе «Новинки») и поиск. Пока раздел выключен,
        // вырезаем его товары прямо из ответа даже до следующего полного sync.
        const discount = splitDiscountCategory(catalog.categories || []);
        const visibleProducts = (catalog.products || []).filter(product =>
            !discount.hiddenFolderIds.has(String(product?.folderId || ''))
        );

        const rawBlobIndex = await kvGetJson(PRODUCT_IMAGE_BLOB_INDEX_KEY).catch(() => null);
        const blobIndex = normalizeProductImageBlobIndex(rawBlobIndex);
        const products = visibleProducts.map(product => {
            const blobCard = directBlobCardUrl(blobIndex, product);
            if (blobCard) {
                // index.html historically keeps only `img` when it copies the
                // catalogue into allProducts. Supplying cardImg alone therefore
                // silently threw away the direct Blob URL and cards fell back to
                // the slower product-image/MoySklad route. Make the already
                // migrated 640px WebP the primary display image as well. Add a
                // harmless query marker so the legacy detail code can append
                // `&size=full` without turning it into part of the Blob pathname.
                const directDisplay = `${blobCard}?delivery=blob`;
                return {
                    ...product,
                    img: directDisplay,
                    cardImg: directDisplay,
                    imageDelivery: 'vercel-blob'
                };
            }

            const fallbackCard = optimizedFallbackCardUrl(req, product);
            return fallbackCard
                ? { ...product, cardImg: fallbackCard, imageDelivery: 'vercel-optimizer-fallback' }
                : product;
        });

        res.setHeader(
            'Cache-Control',
            req.query.refresh === '1'
                ? 'no-store'
                : 'public, max-age=15, s-maxage=30, stale-while-revalidate=120'
        );
        res.status(200).json({
            products,
            categories: discount.categories
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
