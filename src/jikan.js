import NodeCache from 'node-cache';

// Caché en memoria: 30 minutos para catálogos, 2 horas para metadatos de animes
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

const JIKAN_BASE = 'https://api.jikan.moe/v4';

/**
 * Petición con reintento y control de rate-limit
 */
async function fetchWithRetry(url, retries = 2, delayMs = 1200) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'StremioMALNyaaAddon/1.0.0 (https://github.com)'
        }
      });

      if (res.status === 429) {
        // Rate limit alcanzado, esperar y reintentar
        console.warn(`[Jikan] Rate limit (429). Esperando ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      if (!res.ok) {
        throw new Error(`Jikan HTTP error: ${res.status} ${res.statusText}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

/**
 * Formatea un item de Jikan para el catálogo de Stremio
 */
function formatStremioMetaSummary(anime) {
  const isMovie = anime.type === 'Movie';
  return {
    id: `mal:${anime.mal_id}`,
    type: isMovie ? 'movie' : 'series',
    name: anime.title || anime.title_english || anime.title_japanese,
    poster: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url,
    description: anime.synopsis || '',
    genres: (anime.genres || []).map(g => g.name),
    releaseInfo: anime.year ? String(anime.year) : (anime.aired?.string || '')
  };
}

/**
 * Obtener animes por catálogo (Airing o Popularity)
 */
export async function getAnimeCatalog(category = 'airing', page = 1) {
  const cacheKey = `catalog_${category}_${page}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let endpoint = `${JIKAN_BASE}/top/anime?page=${page}&limit=25`;
  if (category === 'airing') {
    endpoint += '&filter=airing';
  } else if (category === 'popular') {
    endpoint += '&filter=bypopularity';
  }

  const data = await fetchWithRetry(endpoint);
  const metas = (data.data || []).map(formatStremioMetaSummary);

  cache.set(cacheKey, metas, 1800);
  return metas;
}

/**
 * Buscar animes por título en MyAnimeList
 */
export async function searchAnime(query) {
  if (!query || query.trim() === '') return [];

  const cacheKey = `search_${query.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const endpoint = `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=20&sfw=true`;
  const data = await fetchWithRetry(endpoint);
  const metas = (data.data || []).map(formatStremioMetaSummary);

  cache.set(cacheKey, metas, 1800);
  return metas;
}

/**
 * Obtener detalles completos de un anime para Stremio (sinopsis, póster, episodios)
 */
export async function getAnimeMeta(malId) {
  const cacheKey = `meta_${malId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const endpoint = `${JIKAN_BASE}/anime/${malId}/full`;
  const data = await fetchWithRetry(endpoint);
  const anime = data.data;

  if (!anime) throw new Error(`Anime con ID ${malId} no encontrado en Jikan`);

  const isMovie = anime.type === 'Movie';
  const totalEpisodes = anime.episodes || 1;

  // Generar lista de episodios para Stremio
  const videos = [];
  if (!isMovie) {
    for (let ep = 1; ep <= totalEpisodes; ep++) {
      videos.push({
        id: `mal:${malId}:${ep}`,
        title: `Episodio ${ep}`,
        season: 1,
        episode: ep,
        released: anime.aired?.from || new Date().toISOString()
      });
    }
  }

  const meta = {
    id: `mal:${malId}`,
    type: isMovie ? 'movie' : 'series',
    name: anime.title,
    english_title: anime.title_english,
    japanese_title: anime.title_japanese,
    genres: (anime.genres || []).map(g => g.name),
    poster: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url,
    background: anime.trailer?.images?.maximum_image_url || anime.images?.jpg?.large_image_url,
    description: anime.synopsis || '',
    releaseInfo: anime.year ? String(anime.year) : (anime.aired?.string || ''),
    imdbRating: anime.score ? String(anime.score) : undefined,
    videos: isMovie ? undefined : videos
  };

  cache.set(cacheKey, meta, 7200); // Guardar en caché 2 horas
  return meta;
}
