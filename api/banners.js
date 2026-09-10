// Баннеры на главной. Раньше это были два отдельных файла
// (api/get-banners.js и api/save-banners.js), но план Vercel Hobby
// разрешает не больше 12 serverless-функций — пришлось объединить,
// поведение не изменилось:
//
//   GET  /api/banners                    → список баннеров (публично, без ключа)
//   POST /api/banners?key=ADMIN_PANEL_KEY → сохранить список (личный кабинет админа)
//
// Этот же endpoint хранит индивидуальные картинки карточек каталога, чтобы
// не добавлять отдельную serverless-функцию и не упираться в лимит Vercel:
//   GET  /api/banners?kind=category-images&ids=id1,id2
//   POST /api/banners?key=... { catalogCategoryImage: { categoryId, imageUrl } }
//
// В схеме v1 также храним внутреннюю цель баннера: товар / категория / URL.
import { kvGetJson, kvSetJson } from './_catalog-lib.js';

export const BANNERS_KEY = 'home-banners:v1';
const CATEGORY_IMAGE_KEY_PREFIX = 'catalog-category-image:v1:';

const DEFAULT_BANNERS = [
    {
        id: 'default',
        text: 'Бесплатная доставка от 10.000 ₽',
        subtext: '',
        color1: '#82394a',
        color2: '#5a2530',
        imageUrl: '',
        buttonText: '',
        buttonLink: '',
        targetType: 'none',
        targetProductId: '',
        targetCategoryId: '',
        targetPathIds: [],
        targetLabel: '',
        targetUrl: ''
    }
];

function cleanCategoryId(value) {
    return String(value || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
}

function cleanCategoryImageUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url.slice(0, 500000);
    if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(url)) return url.slice(0, 500000);
    return null;
}

async function handleCategoryImagesGet(req, res) {
    const rawIds = String(req.query?.ids || '');
    const ids = [...new Set(rawIds.split(',').map(cleanCategoryId).filter(Boolean))].slice(0, 30);
    if (!ids.length) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ success: true, images: {} });
        return;
    }

    try {
        const entries = await Promise.all(ids.map(async id => {
            const value = await kvGetJson(`${CATEGORY_IMAGE_KEY_PREFIX}${id}`);
            return [id, typeof value === 'string' ? value : ''];
        }));
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ success: true, images: Object.fromEntries(entries) });
    } catch (e) {
        res.status(200).json({ success: true, images: {} });
    }
}

async function handleGet(req, res) {
    if (req.query?.kind === 'category-images') {
        await handleCategoryImagesGet(req, res);
        return;
    }

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

    const categoryImageUpdate = req.body?.catalogCategoryImage;
    if (categoryImageUpdate) {
        const categoryId = cleanCategoryId(categoryImageUpdate.categoryId);
        const imageUrl = cleanCategoryImageUrl(categoryImageUpdate.imageUrl);
        if (!categoryId) {
            res.status(400).json({ success: false, error: 'Не указана категория' });
            return;
        }
        if (imageUrl === null) {
            res.status(400).json({ success: false, error: 'Поддерживается JPEG/PNG/WebP или обычная https-ссылка' });
            return;
        }
        try {
            const saved = await kvSetJson(`${CATEGORY_IMAGE_KEY_PREFIX}${categoryId}`, imageUrl);
            if (!saved) throw new Error('KV не подтвердил сохранение');
            res.status(200).json({ success: true, categoryId, imageUrl });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message || 'Не удалось сохранить картинку категории' });
        }
        return;
    }

    try {
        const { banners } = req.body || {};
        if (!Array.isArray(banners)) {
            res.status(400).json({ success: false, error: 'banners должен быть массивом' });
            return;
        }
        // Простая защита от совсем мусорных данных — оставляем только ожидаемые поля.
        const cleaned = banners.slice(0, 10).map((b, i) => {
            const allowedTargetTypes = ['none', 'product', 'category', 'external'];
            const targetType = allowedTargetTypes.includes(b.targetType)
                ? b.targetType
                : (b.buttonLink ? 'external' : 'none');
            const targetUrl = String(b.targetUrl || (targetType === 'external' ? b.buttonLink || '' : '')).slice(0, 500);
            return {
                id: String(b.id || `banner-${Date.now()}-${i}`),
                text: String(b.text || '').slice(0, 120),
                subtext: String(b.subtext || '').slice(0, 160),
                color1: String(b.color1 || '#82394a').slice(0, 20),
                color2: String(b.color2 || '#5a2530').slice(0, 20),
                imageUrl: String(b.imageUrl || '').slice(0, 900000), // с запасом под data:-URL загруженной картинки (обычная ссылка тоже поместится)
                buttonText: String(b.buttonText || '').slice(0, 40),
                // buttonLink оставляем для обратной совместимости со старыми клиентами.
                buttonLink: String(targetType === 'external' ? (targetUrl || b.buttonLink || '') : '').slice(0, 500),
                enabled: b.enabled !== false,
                badge: String(b.badge || '').slice(0, 40),
                textTheme: b.textTheme === 'dark' ? 'dark' : 'light',
                align: b.align === 'center' ? 'center' : 'left',
                height: ['compact', 'regular', 'large'].includes(b.height) ? b.height : 'regular',
                overlay: Math.max(0, Math.min(0.75, Number(b.overlay) || 0)),
                backgroundPosition: ['left', 'center', 'right'].includes(b.backgroundPosition) ? b.backgroundPosition : 'center',
                targetType,
                targetProductId: String(b.targetProductId || '').slice(0, 80),
                targetCategoryId: String(b.targetCategoryId || '').slice(0, 80),
                targetPathIds: Array.isArray(b.targetPathIds) ? b.targetPathIds.slice(0, 10).map(id => String(id).slice(0, 80)) : [],
                targetLabel: String(b.targetLabel || '').slice(0, 240),
                targetUrl
            };
        });
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