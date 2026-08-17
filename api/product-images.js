// Returns only safe gallery metadata (currently image count), never MoySklad
// download URLs. The same cached href list is shared with product-image.js.
import { API, fetchJson, kvGetJson, kvSetJson } from './_catalog-lib.js';

const HREF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) return res.status(400).json({ success: false, error: 'Не указан id товара' });

    const v = (req.query.v || '0').replace(/[^a-z0-9]/gi, '').slice(0, 30) || '0';
    const cacheKey = `imgfull3:${id}:${v}`;

    try {
        let cached = await kvGetJson(cacheKey);

        // При открытии карточки первый full-image уже начинает получать тот же
        // список. Даём ему небольшой шанс закончить, чтобы не делать два
        // metadata-запроса к МойСклад одновременно на первом открытии товара.
        if (!(cached && (Date.now() - cached.at) < HREF_TTL_MS && Array.isArray(cached.hrefs))) {
            await sleep(450);
            cached = await kvGetJson(cacheKey);
        }

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

        res.setHeader('Cache-Control', v === '0'
            ? 'public, max-age=300, s-maxage=900'
            : 'public, max-age=86400, s-maxage=604800, immutable');
        res.status(200).json({ success: true, count: hrefs.length });
    } catch (e) {
        console.error('[product-images]', e?.message);
        res.status(500).json({ success: false, count: 1 });
    }
}
