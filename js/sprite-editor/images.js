// sprite-editor/images.js - Image loading and caching
// Single responsibility: Load and cache PNG images for parts

const imageCache = new Map();
const loadingPromises = new Map();

/**
 * Load an image from a URL (with caching)
 * @param {string} url - The image URL
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(url) {
  // Return cached image if available
  if (imageCache.has(url)) {
    return Promise.resolve(imageCache.get(url));
  }

  // Return existing loading promise if already loading
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url);
  }

  // Start loading
  const promise = new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      imageCache.set(url, img);
      loadingPromises.delete(url);
      resolve(img);
    };

    img.onerror = () => {
      loadingPromises.delete(url);
      console.warn(`[images] Failed to load: ${url}`);
      reject(new Error(`Failed to load image: ${url}`));
    };

    img.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

/**
 * Get a cached image (returns null if not loaded)
 * @param {string} url
 * @returns {HTMLImageElement|null}
 */
export function getCachedImage(url) {
  return imageCache.get(url) || null;
}

/**
 * Manually cache an already-loaded image
 * @param {string} url - The URL/data URL key
 * @param {HTMLImageElement} img - The loaded image
 */
export function cacheImage(url, img) {
  imageCache.set(url, img);
}

/**
 * Preload multiple images
 * @param {string[]} urls
 * @returns {Promise<HTMLImageElement[]>}
 */
export function preloadImages(urls) {
  return Promise.all(urls.map(url => loadImage(url).catch(() => null)));
}

/**
 * Clear the image cache
 */
export function clearCache() {
  imageCache.clear();
}

/**
 * Get the URL for a part's image
 * @param {string} objectId - e.g., 'abrams'
 * @param {string} partType - e.g., 'hull'
 * @param {string} filename - e.g., 'default.png'
 * @param {string} objectType - 'unit' or 'terrain'
 * @returns {string}
 */
export function getPartImageUrl(objectId, partType, filename, objectType = 'unit') {
  const folder = objectType === 'terrain' ? 'terrain' : 'units';
  return `/sprites/${folder}/${objectId}/${partType}/${filename}`;
}
