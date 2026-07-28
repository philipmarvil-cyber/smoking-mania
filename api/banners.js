// Баннеры на главной. Раньше это были два отдельных файла
// (api/get-banners.js и api/save-banners.js), но план Vercel Hobby
// разрешает не больше 12 serverless-функций — пришлось объединить,
// поведение не изменилось:
//
//   GET  /api/banners                    → список баннеров (публично, без ключа)
//   POST /api/banners?key=ADMIN_PANEL_KEY → сохранить список (личный кабинет админа)
import { kvGetJson, kvSetJson } from './_catalog-lib.js';

export const BANNERS_KEY = 'home-banners:v1';

const DEFAULT_BANNERS = [
    {
        id: 'default',
        text: 'Бесплатная доставка от 10.000 ₽',
        subtext: '',
        color1: '#82394a',
        color2: '#5a2530',
        imageUrl: '',
        buttonText: '',
        buttonLink: ''
    }
];

async function handleGet(req, res) {
    try {
        const banners = await kvGetJson(BANNERS_KEY);
        res.status(200).json({ success: true, banners: Array.isArray(banners) && banners.length ? banners : DEFAULT_BANNERS });
    } catch (e) {
        res.status(200).json({ success: true, banners: DEFAULT_BANNERS });
    }
}

async function handlePost(req, res) {
    const requiredKey = process.env.ADMIN_PANEL_KEY;
    if (!requiredKey) {
        res.status(500).json({ success: false, error: 'Не задана переменная окружения ADMIN_PANEL_KEY' });
        return;
    }
    const providedKey = req.query?.key;
    if (providedKey !== requiredKey) {
        res.status(403).json({ success: false, error: 'Неверный ключ' });
        return;
    }

    try {
        const { banners } = req.body || {};
        if (!Array.isArray(banners)) {
            res.status(400).json({ success: false, error: 'banners должен быть массивом' });
            return;
        }
        // Простая защита от совсем мусорных данных — оставляем только ожидаемые поля.
        const cleaned = banners.slice(0, 10).map((b, i) => ({
            id: String(b.id || `banner-${Date.now()}-${i}`),
            text: String(b.text || '').slice(0, 120),
            subtext: String(b.subtext || '').slice(0, 160),
            color1: String(b.color1 || '#82394a').slice(0, 20),
            color2: String(b.color2 || '#5a2530').slice(0, 20),
            imageUrl: String(b.imageUrl || '').slice(0, 900000), // с запасом под data:-URL загруженной картинки (обычная ссылка тоже поместится)
            buttonText: String(b.buttonText || '').slice(0, 40),
            buttonLink: String(b.buttonLink || '').slice(0, 500)
        }));
        await kvSetJson(BANNERS_KEY, cleaned);
        res.status(200).json({ success: true, banners: cleaned });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

export default async function handler(req, res) {
    if (req.method === 'GET') {
        await handleGet(req, res);
    } else if (req.method === 'POST') {
        await handlePost(req, res);
    } else {
        res.status(405).json({ success: false, error: 'Метод не поддерживается' });
    }
}
