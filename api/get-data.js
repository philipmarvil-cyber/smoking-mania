// Отдаёт каталог фронтенду. Обычная загрузка читает готовый каталог из KV
// и НЕ ждёт живого запроса к МойСклад. Обновление остатков запускается
// отдельно через ?refresh=1 уже после первого рендера интерфейса.
import { kvGetCatalog, kvSetCatalog, loadCatalogData, refreshAllStock, kvGetJson } from './_catalog-lib.js';
import { PRODUCT_IMAGE_BLOB_INDEX_KEY, normalizeProductImageBlobIndex, directBlobCardUrl } from './blob-image-index.js';

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
            const cardImg = directBlobCardUrl(blobIndex, product);
            return cardImg ? { ...product, cardImg, imageDelivery: 'vercel-blob' } : product;
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
