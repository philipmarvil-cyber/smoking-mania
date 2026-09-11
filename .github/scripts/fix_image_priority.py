from pathlib import Path

# 1) Mobile: do not start HQ downloads until the miniature is actually visible.
card = Path('card-quality.js')
s = card.read_text(encoding='utf-8')
s = s.replace('const MINI_EAGER_COUNT = isMobileWebView ? 20 : 12;', 'const MINI_EAGER_COUNT = isMobileWebView ? 8 : 10;')
s = s.replace('const HQ_MAX_CONCURRENT = isMobileWebView ? 2 : 3;', 'const HQ_MAX_CONCURRENT = isMobileWebView ? 1 : 2;')
s = s.replace("{ rootMargin: isMobileWebView ? '420px 0px' : '650px 0px', threshold: 0.01 }", "{ rootMargin: isMobileWebView ? '260px 0px' : '650px 0px', threshold: 0.01 }")

start = s.index('    function watchImage(img) {')
end = s.index('    function rescueNoPhoto(container) {', start)
replacement = r'''    function armHqAfterMini(img) {
        if (!img || img.dataset.hqArm === '1') return;
        img.dataset.hqArm = '1';

        const startHq = () => {
            if (!document.contains(img) || isStaleCategoryImage(img)) return;
            if (!img.naturalWidth) return;
            img.dataset.miniReady = '1';
            hqObserver.observe(img);
        };

        // На мобильной сети full/640px больше не конкурирует с miniature.
        // Сначала пользователь гарантированно получает маленькое фото,
        // и только после его onload начинаем фоновое улучшение качества.
        if (img.complete && img.naturalWidth > 0) {
            startHq();
        } else {
            img.addEventListener('load', startHq, { once: true });
        }
    }

    function watchImage(img) {
        if (!img || img.dataset.hqObserved || img.closest('.product-card') === null) return;
        if (!prepareMini(img)) return;
        img.dataset.hqObserved = '1';
        if (img.closest('#page-category')) img.dataset.categoryImageEpoch = String(categoryImageEpoch);
        img.dataset.hqState = 'mini';
        armHqAfterMini(img);
    }

'''
s = s[:start] + replacement + s[end:]
card.write_text(s, encoding='utf-8')

# 2) Do not invalidate an otherwise valid image cache when only price/name/etc changed.
lib = Path('api/_catalog-lib.js')
t = lib.read_text(encoding='utf-8')
old = '''        const updatedAt = Date.parse(String(product.updated || '').replace(' ', 'T'));
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
'''
new = '''        // Цена, название, описание и другие поля товара могут менять product.updated,
        // но к фотографии это отношения не имеет. Раньше любая такая правка
        // сбрасывала href/version картинки и следующий покупатель снова становился
        // первым, кто идёт в API МойСклад. Сохраняем image-cache, пока количество
        // фотографий не изменилось. Это резко уменьшает холодные image-запросы.
        const imageStructureChanged = !previous || imageCount !== previousImageCount;
        const canReuseKnownImage = imageCount > 0 && !imageStructureChanged &&
            previous?.imageVersion && previous.imageVersion !== '0';

        if (canReuseKnownImage && previousImageHrefs[product.id]) {
            imageHrefs[product.id] = previousImageHrefs[product.id];
        }

        const hasPhoto = imageCount > 0;
        const imgVer = hasPhoto
            ? (canReuseKnownImage
                ? previous.imageVersion
                : shortHash([product.updated || '', imageCount].join('|')))
            : '0';
'''
if old not in t:
    raise SystemExit('catalog image-cache block not found')
t = t.replace(old, new, 1)
lib.write_text(t, encoding='utf-8')

# 3) One metadata request now fills BOTH mini + full href caches.
product_image = r'''// Versioned image proxy for MoySklad. The miniature is the instant first frame;
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
'''
Path('api/product-image.js').write_text(product_image, encoding='utf-8')

# Bust only the small card-quality script cache; preserve CRLF in index.html.
index = Path('index.html')
b = index.read_bytes()
oldver = b'/card-quality.js?v=20260911instant2'
newver = b'/card-quality.js?v=20260911instant3'
if oldver not in b:
    raise SystemExit('card-quality loader version not found')
index.write_bytes(b.replace(oldver, newver, 1))
