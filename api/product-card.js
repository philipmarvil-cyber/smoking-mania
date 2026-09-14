// Sharp fallback for product cards that are not yet present in Vercel Blob.
// Keep the optimizer source LOCAL so it matches vercel.json localPatterns.
function clean(value) {
    return String(value || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
}

export default function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).end();
        return;
    }

    const id = clean(req.query.id);
    const version = clean(req.query.v) || '0';
    if (!id || version === '0') {
        res.status(400).send('Bad product image id/version');
        return;
    }

    const source = `/api/product-image?id=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}&size=full`;
    const optimized = `/_vercel/image?url=${encodeURIComponent(source)}&w=640&q=82`;

    // Version is embedded in source, so this redirect can be cached safely.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Location', optimized);
    res.status(307).end();
}
