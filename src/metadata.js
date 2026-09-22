import NodeCache from 'node-cache';

// Guardar títulos en caché por 24 horas para respuestas instantáneas
const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

/**
 * Traduce cualquier título en inglés a Romaji y Japonés usando AniList GraphQL
 * (Es ultra rápida, sin límites agresivos y 100% confiable, a diferencia de Jikan que suele dar 504)
 */
async function translateToRomaji(englishTitle) {
  if (!englishTitle) return null;

  const cacheKey = `anilist_${englishTitle.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        idMal
        countryOfOrigin
        title {
          romaji
          english
          native
        }
        synonyms
      }
    }
  `;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: query,
        variables: { search: englishTitle }
      })
    });

    if (!res.ok) {
      console.warn(`[AniList] Error HTTP ${res.status}`);
      return null;
    }

    const json = await res.json();
    const media = json?.data?.Media;
    if (!media) return null;

    const isJapanese = media.countryOfOrigin === 'JP';

    const result = {
      isJapanese: isJapanese,
      romaji: media.title?.romaji || '',
      english: media.title?.english || englishTitle,
      native: media.title?.native || '',
      synonyms: media.synonyms || [],
      idMal: media.idMal
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[AniList] Error al consultar metadatos: ${err.message}`);
    return null;
  }
}

/**
 * Obtiene el título en Romaji desde Kitsu
 */
export async function getAnimeTitleFromKitsu(kitsuId) {
  const cacheKey = `kitsu_${kitsuId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://kitsu.io/api/edge/anime/${kitsuId}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      }
    });

    if (!res.ok) return null;

    const json = await res.json();
    const attrs = json?.data?.attributes;
    if (!attrs) return null;

    const result = {
      romajiTitle: attrs.titles?.en_jp || attrs.canonicalTitle || '',
      englishTitle: attrs.titles?.en || '',
      japaneseTitle: attrs.titles?.ja_jp || ''
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[Kitsu] Error: ${err.message}`);
    return null;
  }
}

/**
 * Obtiene el título desde Cinemeta para IDs de IMDb (ej: "tt11034066")
 */
export async function getTitleFromCinemeta(type, imdbId) {
  const cacheKey = `cinemeta_${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const cinemetaType = type === 'movie' ? 'movie' : 'series';
    const url = `https://v3-cinemeta.strem.io/meta/${cinemetaType}/${imdbId}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const meta = data?.meta;
    if (!meta) return null;

    const result = {
      name: meta.name || ''
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[Cinemeta] Error: ${err.message}`);
    return null;
  }
}

/**
 * Resuelve cualquier ID de Stremio (Kitsu o IMDb) y lo convierte en el título oficial en Romaji / Japonés
 */
export async function resolveAnimeInfo(type, fullId) {
  // Caso 1: ID de Kitsu (ej: "kitsu:42898:3")
  if (fullId.startsWith('kitsu:')) {
    const parts = fullId.split(':');
    const kitsuId = parts[1];
    const episode = parts.length > 2 ? parseInt(parts[2], 10) : null;

    const info = await getAnimeTitleFromKitsu(kitsuId);
    return {
      title: info?.romajiTitle || '',
      englishTitle: info?.englishTitle || '',
      episode: episode,
      season: 1
    };
  }

  // Caso 2: ID de IMDb / Cinemeta (ej: "tt11034066:4:23")
  if (fullId.startsWith('tt')) {
    const parts = fullId.split(':');
    const imdbId = parts[0];
    const season = parts.length > 1 ? parseInt(parts[1], 10) : 1;
    const episode = parts.length > 2 ? parseInt(parts[2], 10) : null;

    const cinemetaInfo = await getTitleFromCinemeta(type, imdbId);
    const rawEnglishTitle = cinemetaInfo?.name || '';

    // Consultar metadatos (origen y traducciones)
    const translated = await translateToRomaji(rawEnglishTitle);

    // Si es japonesa nativa, usamos Romaji como título principal; si no, dejamos el original en inglés
    const isJp = translated?.isJapanese ?? true;
    const primaryTitle = (isJp && translated?.romaji) ? translated.romaji : rawEnglishTitle;
    const secondaryTitle = rawEnglishTitle;

    return {
      title: primaryTitle,
      originalTitle: rawEnglishTitle,
      romajiTitle: translated?.romaji || '',
      englishTitle: secondaryTitle,
      synonyms: translated?.synonyms || [],
      season: season,
      episode: episode
    };
  }

  return null;
}
