// Сохраняет список баннеров, настроенных в личном кабинете админа.
// Защищено тем же ключом ADMIN_PANEL_KEY, что и остальной личный кабинет.
import { kvSetJson } from './_catalog-lib.js';
import { BANNERS_KEY } from './get-banners.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

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
            imageUrl: String(b.imageUrl || '').slice(0, 2000),
            buttonText: String(b.buttonText || '').slice(0, 40),
            buttonLink: String(b.buttonLink || '').slice(0, 500)
        }));
        await kvSetJson(BANNERS_KEY, cleaned);
        res.status(200).json({ success: true, banners: cleaned });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
