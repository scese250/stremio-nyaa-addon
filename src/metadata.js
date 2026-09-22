import NodeCache from 'node-cache';

// Guardar títulos en caché por 24 horas para respuestas instantáneas
const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

// Instancia de Jikan en Cloudflare Workers (rápida, sin 504, con paridad completa de MyAnimeList)
const JIKAN_EDGE_BASE = 'https://jikan.lucashdo.com/v1';

/**
 * Consulta la base de datos de MyAnimeList a través de jikan-edge
 */
async function searchMyAnimeList(query) {
  if (!query || query.trim() === '') return [];

  const cacheKey = `jikan_search_${query.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `${JIKAN_EDGE_BASE}/anime?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      console.warn(`[Jikan-Edge] Error HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const results = json?.data || [];
    cache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.error(`[Jikan-Edge] Error al consultar: ${err.message}`);
    return [];
  }
}

/**
 * Traduce usando AniList como respaldo si MAL no da resultado
 */
async function searchAniList(englishTitle) {
  if (!englishTitle) return null;

  const cacheKey = `anilist_${englishTitle.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
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

    if (!res.ok) return null;
    const json = await res.json();
    const media = json?.data?.Media;
    if (!media) return null;

    const result = {
      isJapanese: media.countryOfOrigin === 'JP',
      romaji: media.title?.romaji || '',
      english: media.title?.english || englishTitle,
      synonyms: media.synonyms || []
    };

    cache.set(cacheKey, result);
    return result;
  } catch {
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
 * Resuelve cualquier ID de Stremio combinando MyAnimeList (jikan-edge), Kitsu y AniList
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
      originalTitle: info?.englishTitle || info?.romajiTitle || '',
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

    // 1. Consultar MyAnimeList directamente a través de jikan-edge
    const malResults = await searchMyAnimeList(rawEnglishTitle);

    let chosenMalTitle = null;
    let malSynonyms = [];

    if (malResults.length > 0) {
      // Si se especificó una temporada (ej: Temp 4, 3, 2), buscar la entrada exacta en MAL
      if (season > 1) {
        const seasonPatterns = [
          new RegExp(`(?:${season}nd|${season}rd|${season}th|${season}st)\\s*Season`, 'i'),
          new RegExp(`Season\\s*${season}`, 'i'),
          new RegExp(`S${season}`, 'i')
        ];

        for (const pattern of seasonPatterns) {
          const match = malResults.find(item => pattern.test(item.title));
          if (match) {
            chosenMalTitle = match.title;
            break;
          }
        }
      }

      // Si no hay temporada específica o no coincidió, tomar el primer resultado más relevante
      if (!chosenMalTitle) {
        chosenMalTitle = malResults[0].title;
      }

      malSynonyms = malResults.slice(0, 3).map(r => r.title);
    }

    // 2. Respaldo opcional con AniList si MAL no devolvió nada
    let aniInfo = null;
    if (!chosenMalTitle) {
      aniInfo = await searchAniList(rawEnglishTitle);
    }

    const finalRomaji = chosenMalTitle || aniInfo?.romaji || rawEnglishTitle;

    return {
      title: finalRomaji,
      originalTitle: rawEnglishTitle,
      englishTitle: rawEnglishTitle,
      synonyms: malSynonyms,
      season: season,
      episode: episode
    };
  }

  return null;
}
