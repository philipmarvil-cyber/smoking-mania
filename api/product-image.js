// Отдаёт ссылку на миниатюру товара. Ходит в МойСклад только при промахе кэша:
// результат (в т.ч. "у товара нет фото") сохраняется в KV на 7 дней.
// Именно этот эндпоинт раньше бомбил склад — по запросу на каждый товар
// от каждого пользователя. Теперь склад спрашивается про товар один раз.
import { API, fetchJson, kvGetJson, kvSetJson } from './_catalog-lib.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

export default async function handler(req, res) {
    const id = (req.query.id || '').replace(/[^a-f0-9-]/gi, '');
    if (!id) {
        res.status(400).json({ error: 'Не указан id товара' });
        return;
    }

    const cacheKey = `img:${id}`;
    const cached = await kvGetJson(cacheKey);
    if (cached && (Date.now() - cached.at) < TTL_MS) {
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
        res.status(200).json({ img: cached.img });
        return;
    }

    try {
        const data = await fetchJson(`${API}/entity/product/${id}/images?limit=1`);
        const img = data?.rows?.[0]?.miniature?.downloadHref || '';
        // Кэшируем и пустой результат тоже — иначе товары без фото
        // будут дергать склад при каждом открытии каталога.
        await kvSetJson(cacheKey, { img, at: Date.now() });
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
        res.status(200).json({ img });
    } catch (e) {
        // При ошибке отдаём пустоту, но НЕ кэшируем — попробуем в другой раз.
        res.status(200).json({ img: '' });
    }
}
