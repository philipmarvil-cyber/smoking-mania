// Компактный endpoint остатков.
// В отличие от /api/get-data не читает и не возвращает многомегабайтный каталог.
import { kvGetStock, refreshAllStock } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Только GET' });
        return;
    }

    try {
        if (req.query.refresh === '1') {
            await refreshAllStock().catch(() => false);
        }

        const stock = (await kvGetStock().catch(() => null)) || {};
        res.setHeader('Cache-Control', req.query.refresh === '1' ? 'no-store' : 'public, max-age=5, s-maxage=15');
        res.status(200).json({ success: true, stock });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
