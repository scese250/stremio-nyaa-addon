import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAnimeInfo } from './metadata.js';
import { searchTorrents } from './nyaa.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());

// Registro de peticiones para depuración en consola
app.use((req, res, next) => {
  console.log(`[Stremio] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

/**
 * Decodifica la configuración enviada en la URL (en Base64 URL-safe)
 */
function parseConfig(configStr) {
  const defaultConfig = {
    group: '',
    resolution: '1080p',
    strict: false
  };

  if (!configStr || configStr === 'manifest.json' || configStr === 'configure') {
    return defaultConfig;
  }

  try {
    let base64 = configStr.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return { ...defaultConfig, ...parsed };
  } catch (e) {
    return defaultConfig;
  }
}

/**
 * Construye el manifiesto de Stremio enfocado exclusivamente en proveer STREAMS
 * para cualquier catálogo existente (Kitsu, Cinemeta, etc.)
 */
function getManifest(config = {}) {
  const groupLabel = config.group ? ` [${config.group}]` : '';
  const resLabel = config.resolution && config.resolution !== 'all' ? ` (${config.resolution})` : '';

  return {
    id: 'community.nyaa.streams',
    version: '1.0.0',
    name: `Nyaa Torrents${groupLabel}${resLabel}`,
    description: 'Streams de Nyaa Torrents con filtro de Grupo de Fansub y Resolución. Compatible con Kitsu y Cinemeta.',
    logo: 'https://nyaa.si/static/favicon.png',
    background: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80',
    types: ['anime', 'series', 'movie'],
    resources: ['stream'],
    idPrefixes: ['kitsu:', 'tt'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

// -------------------------------------------------------------
// Rutas de Configuración Web y Ping (Keep-Alive)
// -------------------------------------------------------------
app.get('/ping', (req, res) => res.send('pong'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// -------------------------------------------------------------
// Manifiesto de Stremio
// -------------------------------------------------------------
app.get('/manifest.json', (req, res) => {
  res.json(getManifest());
});

app.get('/:config/manifest.json', (req, res) => {
  const config = parseConfig(req.params.config);
  res.json(getManifest(config));
});

// -------------------------------------------------------------
// Streams (Búsqueda en Nyaa RSS y filtrado)
// -------------------------------------------------------------
async function handleStream(req, res) {
  try {
    const config = parseConfig(req.params.config);
    const { type, id } = req.params;

    console.log(`\n🔍 [Stream Request] Tipo: ${type} | ID: ${id}`);
    console.log(`⚙️  [Filtros] Grupo: "${config.group || 'Cualquiera'}" | Res: "${config.resolution}" | Estricto: ${config.strict}`);

    // Resolver el nombre del anime usando Kitsu o Cinemeta
    const animeInfo = await resolveAnimeInfo(type, id);

    if (!animeInfo || !animeInfo.title) {
      console.warn(`⚠️  No se pudo resolver el título para el ID: ${id}`);
      return res.json({ streams: [] });
    }

    console.log(`🎬 [Anime Detectado] Título Romaji: "${animeInfo.title}" | Temp: ${animeInfo.season || 1} | Ep: ${animeInfo.episode || 'Película'}`);

    const streams = await searchTorrents({
      title: animeInfo.title,
      englishTitle: animeInfo.englishTitle,
      synonyms: animeInfo.synonyms,
      season: animeInfo.season,
      episode: animeInfo.episode,
      preferredGroup: config.group,
      resolution: config.resolution,
      strictGroup: config.strict
    });

    console.log(`✅ [Resultados Nyaa] Se encontraron ${streams.length} streams para Stremio`);
    res.json({ streams });
  } catch (err) {
    console.error('❌ [Stream Error]:', err.message);
    res.json({ streams: [] });
  }
}

app.get('/stream/:type/:id.json', handleStream);
app.get('/:config/stream/:type/:id.json', handleStream);

// -------------------------------------------------------------
// Iniciar Servidor
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log('========================================================');
  console.log(`🚀 Addon Nyaa Streams iniciado en http://localhost:${PORT}`);
  console.log(`⚙️  Configuración: http://localhost:${PORT}/configure`);
  console.log('========================================================');
});
