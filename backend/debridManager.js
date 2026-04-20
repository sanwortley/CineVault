const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://api.real-debrid.com/rest/1.0';

const getRD = () => {
    const token = process.env.REAL_DEBRID_API_TOKEN;
    return axios.create({
        baseURL: BASE_URL,
        headers: { 'Authorization': `Bearer ${token}` }
    });
};

class DebridManager {
    constructor() {
        if (!API_TOKEN) {
            console.warn('[DebridManager] No REAL_DEBRID_API_TOKEN found in .env');
        }
    }

    async addMagnet(magnet) {
        const params = new URLSearchParams();
        params.append('magnet', magnet);
        const response = await getRD().post('/torrents/addMagnet', params);
        return response.data; // { id, uri }
    }

    async getTorrentInfo(id) {
        const response = await getRD().get(`/torrents/info/${id}`);
        return response.data;
    }

    async selectAllFiles(id) {
        const params = new URLSearchParams();
        params.append('files', 'all');
        await getRD().post(`/torrents/selectFiles/${id}`, params);
    }

    async unrestrictLink(link) {
        const params = new URLSearchParams();
        params.append('link', link);
        const response = await getRD().post('/unrestrict/link', params);
        return response.data.download; // Direct HTTPS URL
    }

    /**
     * Complete flow: Add -> Select -> Poll -> Unrestrict
     */
    async processMagnet(magnet, progressCallback) {
        try {
            console.log('[Debrid] Añadiendo magnet...');
            const addResult = await this.addMagnet(magnet);
            const torrentId = addResult.id;

            console.log('[Debrid] Seleccionando archivos...');
            await this.selectAllFiles(torrentId);

            // Polling for completion
            let isReady = false;
            let info;
            let attempts = 0;

            while (!isReady && attempts < 60) { // Max 5 mins
                info = await this.getTorrentInfo(torrentId);
                
                if (progressCallback) {
                    progressCallback(info.progress, info.status);
                }

                if (info.status === 'downloaded' || info.links.length > 0) {
                    isReady = true;
                } else if (info.status === 'error' || info.status === 'dead') {
                    throw new Error(`Error en Real-Debrid: ${info.status}`);
                } else {
                    attempts++;
                    await new Promise(r => setTimeout(r, 5000)); // Wait 5s
                }
            }

            if (!isReady) throw new Error('Tiempo de espera de Real-Debrid agotado');

            console.log('[Debrid] Desacoplando link final...');
            // We take the last link (usually the video file if selected correctly)
            const internalLink = info.links[0];
            const directLink = await this.unrestrictLink(internalLink);

            return {
                id: torrentId,
                downloadUrl: directLink,
                filename: info.filename
            };

        } catch (err) {
            console.error('[Debrid] Error en proceso:', err.message);
            throw err;
        }
    }
}

module.exports = new DebridManager();
