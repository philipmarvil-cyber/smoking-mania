// Прокси-картинка товара из МойСклад.
// Ссылки МойСклад (downloadHref) требуют заголовок Authorization — браузер не может
// подставить его в <img src>, поэтому раньше вместо фото показывались "битые картинки"
// (те самые кубики). Этот эндпоинт сам ходит в МойСклад с токеном, забирает байты
// и отдаёт их браузеру уже как обычный файл, без всякой авторизации с его стороны.
//
// ВАЖНО: раньше ссылка на файл (если её не было в персональном 7-дневном кэше)
// добывалась отдельным живым запросом GET /entity/product/{id}/images на КАЖДЫЙ
// показ картинки нового/непрокэшированного товара. При одновременной загрузке
// каталога у многих пользователей это давало всплеск таких запросов — именно
// он и привёл к ограничению доступа к API со стороны МойСклад. Теперь ссылки на
// картинки ВСЕХ товаров собираются разом при полной синхронизации (см.
// loadCatalogData) и лежат одной картой в KV — сюда идём в первую очередь, и
// живой запрос к МойСклад делаем только для товаров, которых в этой карте
// почему-то ещё нет (например, совсем новый товар между синхронизациями).
import { API, fetchJson, fetchBinary, kvGetJson, kvSetJson, getImageHrefsMap } from './_catalog-lib.js';

const HREF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней — сама ссылка на файл в МойСклад стабильна

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) {
        res.status(400).send('Не указан id товара');
        return;
    }
    const wantFull = req.query.size === 'full';

    try {
        let href = null;

        if (wantFull) {
            // ВАЖНО: при массовой синхронизации (expand=images на списке
            // товаров) МойСклад отдаёт по картинке только miniature — поля
            // оригинала там нет, даже если исходное фото весит 1080×1080 и
            // больше. Раньше "full" бралось именно из этого массового ответа
            // и по факту оказывалось той же миниатюрой. Теперь оригинал
            // всегда добывается отдельным точечным запросом по конкретному
            // товару (там это поле есть надёжно) — с кэшем на 7 дней, чтобы
            // не дёргать МойСклад повторно при каждом открытии карточки.
            const cacheKey = `imgfull:${id}`;
            const cached = await kvGetJson(cacheKey);
            if (cached && (Date.now() - cached.at) < HREF_TTL_MS) {
                href = cached.href || null;
            } else {
                const data = await fetchJson(`${API}/entity/product/${id}/images?limit=1`);
                const row = data?.rows?.[0];
                href = row?.downloadHref || row?.miniature?.downloadHref || null;
                await kvSetJson(cacheKey, { href: href || '', at: Date.now() });
            }
        } else {
            const hrefMap = await getImageHrefsMap();
            const entry = hrefMap.hasOwnProperty(id) ? hrefMap[id] : null;
            if (entry && typeof entry === 'object') href = entry.mini || null;
            else if (typeof entry === 'string') href = entry || null;

            if (href === null) {
                // Товара нет в карте — редкий случай (совсем новый товар
                // между синхронизациями). Идём в МойСклад напрямую, кэшируем
                // на 7 дней.
                const cacheKey = `imghref:${id}`;
                const cached = await kvGetJson(cacheKey);
                if (cached && (Date.now() - cached.at) < HREF_TTL_MS) {
                    href = cached.mini || null;
                } else {
                    const data = await fetchJson(`${API}/entity/product/${id}/images?limit=1`);
                    const mini = data?.rows?.[0]?.miniature?.downloadHref || '';
                    await kvSetJson(cacheKey, { mini, at: Date.now() });
                    href = mini || null;
                }
            }
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
        res.setHeader('X-Ms-Image-Variant', wantFull ? 'full' : 'mini');
        res.setHeader('X-Ms-Image-Bytes', String(buffer.length));
        res.status(200).send(buffer);
    } catch (e) {
        res.status(500).send('Не удалось получить фото');
    }
}
