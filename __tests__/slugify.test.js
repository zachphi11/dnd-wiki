const { slugify } = require('../public/slugify');

describe('slugify', () => {
  test('slugifies title and replaces last slug segment', () => {
    expect(slugify('Lord Invuln', 'npcs/lord-invulnerable')).toBe('npcs/lord-invuln');
  });

  test('preserves path prefix', () => {
    expect(slugify('New Title', 'characters/old-title')).toBe('characters/new-title');
  });

  test('top-level slug has no prefix', () => {
    expect(slugify('My Page', 'my-page')).toBe('my-page');
  });

  test('strips special characters', () => {
    expect(slugify("Zeph's Tavern", 'locations/old')).toBe('locations/zephs-tavern');
  });

  test('empty title falls back to untitled', () => {
    expect(slugify('', 'npcs/something')).toBe('npcs/untitled');
  });

  test('collapses multiple spaces and hyphens', () => {
    expect(slugify('Lord  Invuln  the  Great', 'npcs/old')).toBe('npcs/lord-invuln-the-great');
  });
});
