// Versioned image proxy for MoySklad. Product cards use only the light
// miniature. Full images (including gallery images #2/#3) are resolved
// lazily on the product page and their href list is cached in KV.
import { API, fetchJson, fetchBinary, kvGetJson, kvSetJson, getImageHrefsMap } from './_catalog-lib.js';

const HREF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) return res.status(400).send('Не указан id товара');

    const wantFull = req.query.size === 'full';
    const index = Math.max(0, Math.min(49, parseInt(req.query.index || '0', 10) || 0));
    const v = (req.query.v || '0').replace(/[^a-z0-9]/gi, '').slice(0, 30) || '0';

    try {
        let href = null;

        if (wantFull) {
            // Один metadata-запрос получает ссылки СРАЗУ на все фото товара.
            // Свайп ко 2/3 фото не создаёт новый запрос метаданных к МойСклад.
            const cacheKey = `imgfull3:${id}:${v}`;
            const cached = await kvGetJson(cacheKey);
            let hrefs = (cached && (Date.now() - cached.at) < HREF_TTL_MS && Array.isArray(cached.hrefs))
                ? cached.hrefs
                : null;

            if (!hrefs) {
                const data = await fetchJson(`${API}/entity/product/${id}/images?limit=100`);
                hrefs = (data?.rows || []).map(row =>
                    row?.meta?.downloadHref || row?.miniature?.downloadHref || ''
                ).filter(Boolean);
                await kvSetJson(cacheKey, { hrefs, at: Date.now() });
            }
            href = hrefs[index] || null;
        } else {
            // Первая миниатюра почти всегда уже собрана массовой синхронизацией.
            const hrefMap = await getImageHrefsMap();
            const entry = Object.prototype.hasOwnProperty.call(hrefMap, id) ? hrefMap[id] : null;
            if (entry && typeof entry === 'object') {
                href = (Array.isArray(entry.minis) ? entry.minis[index] : null)
                    || (index === 0 ? entry.mini : null)
                    || null;
            } else if (typeof entry === 'string' && index === 0) {
                href = entry;
            }

            // Редкий fallback: товара/фото ещё нет в массовой карте.
            if (!href) {
                const cacheKey = `imghrefs2:${id}`;
                const cached = await kvGetJson(cacheKey);
                let minis = (cached && (Date.now() - cached.at) < HREF_TTL_MS && Array.isArray(cached.minis))
                    ? cached.minis
                    : null;
                if (!minis) {
                    const data = await fetchJson(`${API}/entity/product/${id}/images?limit=100`);
                    minis = (data?.rows || []).map(row => row?.miniature?.downloadHref || '').filter(Boolean);
                    await kvSetJson(cacheKey, { minis, at: Date.now() });
                }
                href = minis[index] || null;
            }
        }

        if (!href) return res.status(404).send('У товара нет фото');

        const { buffer, contentType } = await fetchBinary(href);
        res.setHeader('Content-Type', contentType);
        // v меняется вместе с фото, поэтому versioned URL можно кэшировать
        // агрессивно и в Telegram WebView, и на Vercel CDN.
        res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=31536000, stale-while-revalidate=2592000, immutable');
        res.setHeader('X-Ms-Image-Variant', wantFull ? `full-${index}` : `mini-${index}`);
        res.setHeader('X-Ms-Image-Bytes', String(buffer.length));
        res.status(200).send(buffer);
    } catch (e) {
        console.error('[product-image]', e?.message);
        res.status(500).send('Не удалось получить фото');
    }
}
