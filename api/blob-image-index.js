// Shared helpers for direct product-card delivery from Vercel Blob.
export const PRODUCT_IMAGE_BLOB_INDEX_KEY = 'product-image-blob-index:v1';

export function cleanProductImageId(value) {
    return String(value || '').replace(/[^a-f0-9-]/gi, '');
}

export function cleanProductImageVersion(value) {
    return String(value || '0').replace(/[^a-z0-9]/gi, '').slice(0, 30) || '0';
}

export function normalizeProductImageBlobIndex(raw) {
    const baseUrl = typeof raw?.baseUrl === 'string' && /^https:\/\//.test(raw.baseUrl)
        ? raw.baseUrl.replace(/\/$/, '')
        : '';
    const versions = raw?.versions && typeof raw.versions === 'object' && !Array.isArray(raw.versions)
        ? raw.versions
        : {};
    return { baseUrl, versions };
}

export function directBlobCardUrl(index, product) {
    const id = cleanProductImageId(product?.id);
    const version = cleanProductImageVersion(product?.imageVersion);
    if (!id || version === '0' || !index?.baseUrl || index?.versions?.[id] !== version) return '';
    return `${index.baseUrl}/products/${id}/${version}-card-640.webp`;
}
