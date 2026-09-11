// Versioned image proxy for MoySklad. The lightweight miniature remains the
// instant fallback, while card-quality.js asks Vercel Image Optimization for a
// 640px WebP based on the original image. Both source URLs are versioned, so
// browser/CDN caches can keep them for a long time without showing stale photos.
import { API, fetchJson, fetchBinary, kvGetJson, kvSetJson, getImageHrefsMap } from './_catalog-lib.js';

// Metadata links are keyed by product id + image version. If the image changes,
// v changes as well, therefore keeping the resolved hrefs for 90 days is safe
// and saves repeated /images calls to MoySklad.
const HREF_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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

            // На случай если будущая/старая массовая синхронизация уже положила
            // full-ссылки в общую карту, используем их без отдельного API-запроса.
            if (!hrefs) {
                const hrefMap = await getImageHrefsMap();
                const entry = Object.prototype.hasOwnProperty.call(hrefMap, id) ? hrefMap[id] : null;
                if (entry && typeof entry === 'object') {
                    const mapped = Array.isArray(entry.fulls)
                        ? entry.fulls
                        : (entry.full ? [entry.full] : null);
                    if (mapped?.length) hrefs = mapped.filter(Boolean);
                }
            }

            if (!hrefs) {
                const data = await fetchJson(`${API}/entity/product/${id}/images?limit=100`);
                hrefs = (data?.rows || []).map(row =>
                    row?.meta?.downloadHref || row?.miniature?.downloadHref || ''
                ).filter(Boolean);
            }

            if (hrefs?.length) {
                // Обновляем точечный кэш даже если ссылки пришли из общей карты:
                // последующие запросы full вообще не трогают её и не ходят в API.
                await kvSetJson(cacheKey, { hrefs, at: Date.now() });
            }
            href = hrefs?.[index] || null;
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
                const cacheKey = `imghrefs2:${id}:${v}`;
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

        // URL содержит v, поэтому изменившаяся фотография автоматически получает
        // новый адрес. Старый ответ можно держать максимально долго в Telegram
        // WebView и на Vercel CDN — это ключ к мгновенным повторным открытиям.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, stale-while-revalidate=2592000');
        res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=31536000, stale-while-revalidate=2592000');
        res.setHeader('X-Ms-Image-Variant', wantFull ? `full-${index}` : `mini-${index}`);
        res.setHeader('X-Ms-Image-Bytes', String(buffer.length));
        res.status(200).send(buffer);
    } catch (e) {
        console.error('[product-image]', e?.message);
        res.status(500).send('Не удалось получить фото');
    }
}
