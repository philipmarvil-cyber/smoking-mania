import { kvGetCatalog, kvGetJson } from './_catalog-lib.js';
import { PRODUCT_IMAGE_BLOB_INDEX_KEY, normalizeProductImageBlobIndex, directBlobCardUrl } from './blob-image-index.js';

const P = 'product-image-blob:v1:';
const clean = v => String(v || '').replace(/[^a-z0-9-]/gi, '').slice(0, 100);

function key(p) {
  return `${P}${clean(p?.id)}:${clean(p?.imageVersion || '0')}`;
}

async function probe(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { Accept: 'image/*' }, redirect: 'manual' });
    return {
      status: r.status,
      location: r.headers.get('location') || '',
      type: r.headers.get('content-type') || '',
      source: r.headers.get('x-product-image-source') || '',
      bytes: r.headers.get('x-ms-image-bytes') || ''
    };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || 'black burn').trim().toLowerCase();
    const catalog = await kvGetCatalog();
    const products = (catalog?.products || []).filter(p => String(p?.name || '').toLowerCase().includes(q)).slice(0, 20);
    const rawIndex = await kvGetJson(PRODUCT_IMAGE_BLOB_INDEX_KEY).catch(() => null);
    const index = normalizeProductImageBlobIndex(rawIndex);
    const origin = `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()}`;

    const out = [];
    for (const p of products) {
      const blobEntry = await kvGetJson(key(p)).catch(() => null);
      const version = clean(p.imageVersion || '0');
      const productImage = `${origin}/api/product-image?id=${encodeURIComponent(p.id)}&v=${encodeURIComponent(version)}&size=full&blob-bypass=1`;
      const card = `${origin}/api/product-card?id=${encodeURIComponent(p.id)}&v=${encodeURIComponent(version)}`;
      const direct = directBlobCardUrl(index, p);
      out.push({
        id: p.id,
        name: p.name,
        imageCount: Number(p.imageCount || 0),
        imageVersion: version,
        hasLegacyImg: Boolean(p.img),
        indexVersion: index?.versions?.[clean(p.id)] || '',
        directBlobCard: direct,
        blobEntry: blobEntry ? { version: blobEntry.version, cardUrl: blobEntry.cardUrl, fullUrl: blobEntry.fullUrl, migratedAt: blobEntry.migratedAt } : null,
        sourceProbe: await probe(productImage),
        cardProbe: await probe(card),
        blobCardProbe: await probe(direct)
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ query: q, matches: out.length, products: out });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
