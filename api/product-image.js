// Versioned image proxy for MoySklad. The miniature is the instant first frame;
// the 640px card image is requested only after that miniature has loaded.
import { API, fetchJson, fetchBinary, kvGetJson, kvSetJson, getImageHrefsMap } from './_catalog-lib.js';

const HREF_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function freshCache(value, field) {
    return value && (Date.now() - value.at) < HREF_TTL_MS && Array.isArray(value[field])
        ? value[field]
        : null;
}

async function fetchAndCacheImageLinks(id, v) {
    const data = await fetchJson(`${API}/entity/product/${id}/images?limit=100`);
    const rows = data?.rows || [];
    const minis = rows.map(row => row?.miniature?.downloadHref || '').filter(Boolean);
    const fulls = rows.map(row => row?.meta?.downloadHref || row?.miniature?.downloadHref || '').filter(Boolean);
    const at = Date.now();

    // Один JSON-вызов МойСклад обслуживает и miniature, и будущий full.
    // После первого холодного обращения HQ уже не делает второй metadata request.
    await Promise.all([
        kvSetJson(`imghrefs2:${id}:${v}`, { minis, at }),
        kvSetJson(`imgfull3:${id}:${v}`, { hrefs: fulls, at })
    ]);
    return { minis, fulls };
}

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) return res.status(400).send('Не указан id товара');

    const wantFull = req.query.size === 'full';
    const index = Math.max(0, Math.min(49, parseInt(req.query.index || '0', 10) || 0));
    const v = (req.query.v || '0').replace(/[^a-z0-9]/gi, '').slice(0, 30) || '0';

    try {
        let href = null;
        const hrefMap = await getImageHrefsMap();
        const entry = Object.prototype.hasOwnProperty.call(hrefMap, id) ? hrefMap[id] : null;

        if (wantFull) {
            const cacheKey = `imgfull3:${id}:${v}`;
            let hrefs = freshCache(await kvGetJson(cacheKey), 'hrefs');

            if (!hrefs && entry && typeof entry === 'object') {
                const mapped = Array.isArray(entry.fulls)
                    ? entry.fulls
                    : (entry.full ? [entry.full] : null);
                if (mapped?.length) hrefs = mapped.filter(Boolean);
            }

            if (!hrefs) {
                hrefs = (await fetchAndCacheImageLinks(id, v)).fulls;
            } else {
                await kvSetJson(cacheKey, { hrefs, at: Date.now() });
            }
            href = hrefs?.[index] || null;
        } else {
            if (entry && typeof entry === 'object') {
                href = (Array.isArray(entry.minis) ? entry.minis[index] : null)
                    || (index === 0 ? entry.mini : null)
                    || null;
            } else if (typeof entry === 'string' && index === 0) {
                href = entry;
            }

            if (!href) {
                const cacheKey = `imghrefs2:${id}:${v}`;
                let minis = freshCache(await kvGetJson(cacheKey), 'minis');
                if (!minis) minis = (await fetchAndCacheImageLinks(id, v)).minis;
                href = minis?.[index] || null;
            }
        }

        if (!href) return res.status(404).send('У товара нет фото');

        const { buffer, contentType } = await fetchBinary(href);
        res.setHeader('Content-Type', contentType);
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
