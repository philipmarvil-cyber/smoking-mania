// Прокси-картинка товара из МойСклад.
// Ссылки МойСклад (downloadHref) требуют заголовок Authorization — браузер не может
// подставить его в <img src>, поэтому раньше вместо фото показывались "битые картинки"
// (те самые кубики). Этот эндпоинт сам ходит в МойСклад с токеном, забирает байты
// и отдаёт их браузеру уже как обычный файл, без всякой авторизации с его стороны.
import { API, fetchJson, fetchBinary, kvGetJson, kvSetJson } from './_catalog-lib.js';

const HREF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней — сама ссылка на файл в МойСклад стабильна

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) {
        res.status(400).send('Не указан id товара');
        return;
    }

    try {
        const cacheKey = `imghref:${id}`;
        const cached = await kvGetJson(cacheKey);
        let href = cached && (Date.now() - cached.at) < HREF_TTL_MS ? cached.href : null;

        if (href === null) {
            const data = await fetchJson(`${API}/entity/product/${id}/images?limit=1`);
            href = data?.rows?.[0]?.miniature?.downloadHref || '';
            await kvSetJson(cacheKey, { href, at: Date.now() });
        }

        if (!href) {
            res.status(404).send('У товара нет фото');
            return;
        }

        const { buffer, contentType } = await fetchBinary(href);
        res.setHeader('Content-Type', contentType);
        // Кэш на CDN Vercel — повторные запросы этой же картинки от любых пользователей
        // не будут повторно ходить в МойСклад целую неделю.
        res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
        res.status(200).send(buffer);
    } catch (e) {
        res.status(500).send('Не удалось получить фото');
    }
}
