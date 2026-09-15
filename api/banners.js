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
import { put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { kvGetJson, kvSetJson } from './_catalog-lib.js';

export const BANNERS_KEY = 'home-banners:v1';
const CATEGORY_IMAGE_KEY_PREFIX = 'catalog-category-image:v1:';
const CATEGORY_BLOB_PREFIX = 'category-artwork';

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

function decodeInlineImage(value) {
    const match = /^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(value || ''));
    if (!match) return null;
    const kind = match[1].toLowerCase();
    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) return null;
    return { buffer, ext, contentType };
}

// Старые логотипы/обложки хранились прямо в KV как огромный base64 data:-URL.
// Каждый вход в категорию поэтому тащил через serverless JSON десятки/сотни КБ
// на КАЖДУЮ картинку, после чего WebView ещё отдельно декодировал base64.
// Переносим такие изображения в Vercel Blob один раз и дальше отдаём клиенту
// маленькую постоянную https-ссылку на CDN. Новые загрузки идут сюда сразу.
async function ensureCategoryImageOnBlob(categoryId, value) {
    const decoded = decodeInlineImage(value);
    if (!decoded || !process.env.BLOB_READ_WRITE_TOKEN) return value;

    const digest = createHash('sha256').update(decoded.buffer).digest('hex').slice(0, 20);
    const pathname = `${CATEGORY_BLOB_PREFIX}/${categoryId}/${digest}.${decoded.ext}`;
    const blob = await put(pathname, decoded.buffer, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31536000,
        contentType: decoded.contentType
    });
    return blob.url;
}

async function readCategoryImage(categoryId) {
    const key = `${CATEGORY_IMAGE_KEY_PREFIX}${categoryId}`;
    const raw = await kvGetJson(key);
    if (typeof raw !== 'string' || !raw) return '';
    if (!raw.startsWith('data:image/')) return raw;

    try {
        const fastUrl = await ensureCategoryImageOnBlob(categoryId, raw);
        if (fastUrl && fastUrl !== raw) {
            await kvSetJson(key, fastUrl);
            return fastUrl;
        }
    } catch (e) {
        console.warn('[category-artwork] lazy Blob migration skipped:', categoryId, e?.message);
    }
    // Если Blob временно недоступен, старый data:-URL всё равно остаётся рабочим.
    return raw;
}

async function handleCategoryImagesGet(req, res) {
    const rawIds = String(req.query?.ids || '');
    const ids = [...new Set(rawIds.split(',').map(cleanCategoryId).filter(Boolean))].slice(0, 30);
    if (!ids.length) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
        res.status(200).json({ success: true, images: {} });
        return;
    }

    try {
        const entries = await Promise.all(ids.map(async id => [id, await readCategoryImage(id)]));
        const images = Object.fromEntries(entries);
        const stillInline = Object.values(images).some(value => String(value || '').startsWith('data:image/'));
        // После миграции ответ — всего несколько коротких CDN URL, его можно
        // спокойно кэшировать. Пока хоть один старый data:-URL ещё не переехал,
        // не фиксируем тяжёлый JSON в CDN.
        res.setHeader(
            'Cache-Control',
            stillInline
                ? 'no-store'
                : 'public, max-age=60, s-maxage=60, stale-while-revalidate=600'
        );
        res.status(200).json({ success: true, images });
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
            // Новую локально загруженную картинку сразу складываем в Blob, а в
            // KV сохраняем только URL. Поэтому пользовательская витрина больше
            // никогда не должна получать тяжёлый base64 после новых загрузок.
            const storedImageUrl = imageUrl
                ? await ensureCategoryImageOnBlob(categoryId, imageUrl)
                : '';
            const saved = await kvSetJson(`${CATEGORY_IMAGE_KEY_PREFIX}${categoryId}`, storedImageUrl);
            if (!saved) throw new Error('KV не подтвердил сохранение');
            res.status(200).json({ success: true, categoryId, imageUrl: storedImageUrl });
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
