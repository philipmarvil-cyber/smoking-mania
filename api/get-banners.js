// Отдаёт список баннеров для карусели на главной. Настраиваются в личном
// кабинете админа (admin.html) — цвет/градиент, текст, картинка-фон, кнопка.
// Пока админ ничего не настроил, отдаём тот же баннер, что был раньше
// зашит в коде, чтобы главная не осталась пустой.
import { kvGetJson } from './_catalog-lib.js';

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

export default async function handler(req, res) {
    try {
        const banners = await kvGetJson(BANNERS_KEY);
        res.status(200).json({ success: true, banners: Array.isArray(banners) && banners.length ? banners : DEFAULT_BANNERS });
    } catch (e) {
        res.status(200).json({ success: true, banners: DEFAULT_BANNERS });
    }
}
