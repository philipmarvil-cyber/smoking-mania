export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Не передан id товара' });
    }

    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9";
    const API = "https://api.moysklad.ru/api/remap/1.2";
    const headers = {
        "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    // Кэшируем фото подольше, чем сам каталог — фото товара меняется намного реже.
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');

    try {
        // Запрос одного товара по id — здесь expand НЕ упирается в ограничение limit<=100,
        // потому что limit тут вообще ни при чём (это не список, а один конкретный товар).
        const response = await fetch(`${API}/entity/product/${id}?expand=images`, { headers });
        if (!response.ok) {
            return res.status(200).json({ img: '' });
        }
        const product = await response.json();
        const img = product.images?.rows?.[0]?.miniature?.downloadHref || '';
        return res.status(200).json({ img });
    } catch (error) {
        return res.status(200).json({ img: '' });
    }
}
