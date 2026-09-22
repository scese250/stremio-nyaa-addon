# Stremio Addon: MyAnimeList (Jikan v4) + Nyaa Torrents

Plugin Todo en 1 para Stremio que te permite:
1. **Explorar y buscar animes** directamente desde la base de datos oficial de **MyAnimeList** (animes en emisión, más populares y buscador).
2. **Reproducir vía P2P** desde **Nyaa Torrents**, con la capacidad de:
   - Elegir o escribir cualquier **Grupo de Fansub / Release Group** (ej: `SubsPlease`, `Erai-raws`, `Judee`, `PuyaSubs!`, etc.).
   - Filtrar por **Resolución** (`1080p`, `720p`, `480p` o todas).
   - Elegir entre **Modo Prioritario** (coloca tu grupo arriba con ⭐ y otros abajo para que nunca te quedes sin ver el episodio) o **Modo Estricto** (solo tu grupo).

---

## 🚀 Cómo ejecutar en tu PC

Una vez que tengas **Node.js** instalado:

1. Abre la consola (PowerShell o CMD) en esta carpeta (`c:\Users\Usuario\Desktop\Stremio Plugin`).
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Inicia el servidor:
   ```bash
   npm start
   ```
4. Abre en tu navegador:
   ```text
   http://localhost:7000/configure
   ```

---

## 📱 Cómo usarlo en Stremio Android

Hay dos formas muy sencillas de tenerlo en tu móvil:

### Opción A: Desde tu misma red WiFi (Túnel gratuito Cloudflare)
Si estás ejecutando el servidor en tu PC y quieres instalarlo en tu móvil:
1. Puedes usar un túnel gratuito temporal como `cloudflared`:
   ```bash
   npx cloudflared tunnel --url http://localhost:7000
   ```
2. Te dará una dirección web segura `https://xxxx.trycloudflare.com`.
3. Abre esa URL en el navegador de tu Android, configura tu grupo y dale a **"Instalar en Stremio"** (o copia el enlace e insértalo en el buscador de Stremio en Android).

### Opción B: Despliegue en la nube gratuito 24/7 (Recomendado para Android)
Para no tener que encender el ordenador cada vez que veas anime en tu móvil:
- Puedes subir esta carpeta a un repositorio gratuito de GitHub y desplegarla gratis en **Render.com**, **Koyeb** o **Hugging Face Spaces (Node.js)**.
- Tendrás tu propio enlace HTTPS activo 24/7 para tu Stremio.
