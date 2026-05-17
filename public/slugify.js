function slugify(title, prefixSlug) {
  const prefix = prefixSlug.includes('/')
    ? prefixSlug.slice(0, prefixSlug.lastIndexOf('/') + 1)
    : '';
  const segment = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return prefix + (segment || 'untitled');
}

if (typeof module !== 'undefined') module.exports = { slugify };
