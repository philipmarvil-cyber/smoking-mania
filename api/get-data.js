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
    // `img` is only the legacy cached href. Some perfectly valid MoySklad
    // products have imageCount/imageVersion but no `img`, so requiring it here
    // made their catalogue card permanently blank and also hid the real image
    // endpoint that can resolve the href by product id.
    if (!product?.id || Number(product.imageCount || 0) <= 0) return '';
    const version = String(product.imageVersion || '0');
    if (version === '0') return '';
    const origin = requestOrigin(req);
    if (!origin) return '';
    return `${origin}/api/product-card?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}`;
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

        const rawBlobIndex = await kvGetJson(PRODUCT_IMAGE_BLOB_INDEX_KEY).catch(() => null);
        const blobIndex = normalizeProductImageBlobIndex(rawBlobIndex);
        const products = (catalog.products || []).map(product => {
            const blobCard = directBlobCardUrl(blobIndex, product);
            if (blobCard) {
                return { ...product, cardImg: blobCard, imageDelivery: 'vercel-blob' };
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
            categories: catalog.categories || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
