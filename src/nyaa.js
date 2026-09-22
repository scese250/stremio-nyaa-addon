import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

const NYAA_RSS_BASE = 'https://nyaa.si/?page=rss';

/**
 * Limpia el título eliminando caracteres especiales
 */
function sanitizeTitle(title) {
  if (!title) return '';
  return title
    .replace(/[^\w\s\-\:]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte número a ordinal en inglés: 1st, 2nd, 3rd, 4th...
 */
function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Consulta el feed RSS de Nyaa para un término de búsqueda
 */
async function fetchNyaaRss(query) {
  const url = `${NYAA_RSS_BASE}&q=${encodeURIComponent(query)}&c=1_2&f=0`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) {
      console.warn(`[Nyaa] Error en respuesta RSS: ${res.status}`);
      return [];
    }

    const xmlText = await res.text();
    const parsed = parser.parse(xmlText);

    const items = parsed?.rss?.channel?.item;
    if (!items) return [];

    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.map(item => ({
      title: item.title || '',
      infoHash: item['nyaa:infoHash'] || '',
      seeds: parseInt(item['nyaa:seeders'] || item['nyaa:seeds'] || '0', 10),
      size: item['nyaa:size'] || '',
      link: item.link || ''
    })).filter(t => t.infoHash);
  } catch (err) {
    console.error(`[Nyaa] Error al consultar RSS para "${query}":`, err.message);
    return [];
  }
}

/**
 * Extrae el grupo de fansub del título (ej. "[Erai-raws] ...")
 */
function extractGroup(title) {
  const match = title.match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : '';
}

/**
 * Detecta la resolución (1080p, 720p, 480p, etc.)
 */
function extractResolution(title) {
  const match = title.match(/(1080p|720p|480p|2160p|4k)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Descarta torrents donde el número de episodio solo coincidió porque estaba dentro del hash CRC32
 */
function matchesWithoutCrc(torrentTitle, episode) {
  if (episode === null || episode === undefined) return true;

  // Eliminar únicamente el CRC32 (8 caracteres hexadecimales entre corchetes, ej: [A13B45C6])
  const titleWithoutCrc = torrentTitle.replace(/\[[0-9a-fA-F]{8}\]/gi, '');

  const epNum = parseInt(episode, 10);
  // Verifica si el número de episodio (ej: 13 o 013) sigue existiendo fuera del CRC
  const regex = new RegExp(`\\b0*${epNum}\\b`, 'i');

  return regex.test(titleWithoutCrc);
}

/**
 * Busca torrents en Nyaa aplicando filtros de Grupo y Resolución
 */
export async function searchTorrents({
  title,
  englishTitle,
  synonyms = [],
  season = 1,
  episode,
  preferredGroup = '',
  resolution = '1080p',
  strictGroup = false
}) {
  const cleanTitle = sanitizeTitle(title);
  const cleanEngTitle = sanitizeTitle(englishTitle);
  const paddedEp = episode ? String(episode).padStart(2, '0') : null;

  // Lista de términos de búsqueda en orden de relevancia
  const searchQueries = [];

  if (episode) {
    // Si es una temporada superior a 1 (ej: Temporada 2, 3, 4...)
    if (season && season > 1) {
      const ordinal = getOrdinal(season); // ej: "2nd", "3rd", "4th"
      // 1. Título Romaji + Ordinal Season + Ep (ej: "Mairimashita Iruma kun 3rd Season 23")
      searchQueries.push(`${cleanTitle} ${ordinal} Season ${paddedEp}`);
      searchQueries.push(`${cleanTitle} S${season} ${paddedEp}`);
      searchQueries.push(`${cleanTitle} Season ${season} ${paddedEp}`);
      searchQueries.push(`${cleanTitle} ${season} ${paddedEp}`);
    }

    // Búsqueda estándar: Título Romaji + Episodio (ej: "Mairimashita Iruma kun 23")
    searchQueries.push(`${cleanTitle} ${paddedEp}`);
    searchQueries.push(`${cleanTitle} ${episode}`);

    // Si tiene título en inglés alternativo
    if (cleanEngTitle && cleanEngTitle !== cleanTitle) {
      searchQueries.push(`${cleanEngTitle} ${paddedEp}`);
    }

    // Sinónimos adicionales (si existen)
    for (const syn of synonyms.slice(0, 2)) {
      const cleanSyn = sanitizeTitle(syn);
      if (cleanSyn && cleanSyn !== cleanTitle && cleanSyn !== cleanEngTitle) {
        searchQueries.push(`${cleanSyn} ${paddedEp}`);
      }
    }
  } else {
    // Películas
    searchQueries.push(cleanTitle);
    if (cleanEngTitle && cleanEngTitle !== cleanTitle) {
      searchQueries.push(cleanEngTitle);
    }
  }

  console.log(`🔎 [Nyaa Consultas]: Probando ${searchQueries.length} variantes:`, searchQueries.slice(0, 3));

  const seenHashes = new Set();
  let allTorrents = [];

  for (const query of searchQueries) {
    const results = await fetchNyaaRss(query);
    for (const torrent of results) {
      const hashLower = torrent.infoHash.toLowerCase();
      if (!seenHashes.has(hashLower)) {
        seenHashes.add(hashLower);
        allTorrents.push(torrent);
      }
    }
    // Si ya tenemos suficientes resultados de calidad, no saturamos Nyaa
    if (allTorrents.length >= 20) break;
  }

  console.log(`📦 [Nyaa Encontrados]: ${allTorrents.length} torrents brutos antes de filtrar`);

  // 1. FILTRADO CRC32: descartar torrents donde el episodio solo coincidió por el hash CRC32
  if (episode !== null && episode !== undefined) {
    allTorrents = allTorrents.filter(t => matchesWithoutCrc(t.title, episode));
    console.log(`🎯 [Filtro CRC32]: ${allTorrents.length} torrents válidos para el episodio ${episode}`);
  }

  // Filtrado por Resolución
  let filteredByRes = allTorrents;
  if (resolution && resolution !== 'all') {
    const matched = allTorrents.filter(t =>
      t.title.toLowerCase().includes(resolution.toLowerCase())
    );
    if (matched.length > 0) {
      filteredByRes = matched;
    } else {
      console.log(`⚠️  No hubo torrents en ${resolution}, manteniendo otras resoluciones como alternativa`);
    }
  }

  // Filtrado por Grupo de Fansub
  const targetGroup = preferredGroup.trim().toLowerCase();
  let matchingGroupTorrents = [];
  let otherGroupTorrents = [];

  if (targetGroup) {
    for (const torrent of filteredByRes) {
      const groupInTitle = extractGroup(torrent.title).toLowerCase();
      if (groupInTitle.includes(targetGroup) || torrent.title.toLowerCase().includes(targetGroup)) {
        matchingGroupTorrents.push(torrent);
      } else {
        otherGroupTorrents.push(torrent);
      }
    }
  } else {
    matchingGroupTorrents = filteredByRes;
  }

  // Ordenar por número de semilleros (seeds)
  matchingGroupTorrents.sort((a, b) => b.seeds - a.seeds);
  otherGroupTorrents.sort((a, b) => b.seeds - a.seeds);

  let finalTorrents = [];
  if (strictGroup && targetGroup) {
    finalTorrents = matchingGroupTorrents;
  } else {
    // Prioritario: primero tu grupo elegido (con estrella ⭐) y luego los demás
    finalTorrents = [...matchingGroupTorrents, ...otherGroupTorrents];
  }

  return finalTorrents.map(t => {
    const groupName = extractGroup(t.title) || 'Nyaa';
    const res = extractResolution(t.title) || 'SD';
    const isPreferred = targetGroup && (groupName.toLowerCase().includes(targetGroup) || t.title.toLowerCase().includes(targetGroup));

    return {
      name: `${isPreferred ? '⭐ ' : ''}[${groupName}]\n${res.toUpperCase()}`,
      title: `${t.title}\n💾 ${t.size}  👤 ${t.seeds} seeds`,
      infoHash: t.infoHash,
      behaviorHints: {
        bingeGroup: `nyaa-${groupName.toLowerCase()}-${res}`
      }
    };
  });
}
