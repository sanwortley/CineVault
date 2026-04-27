/**
 * HLS Manager for CineVault
 * Handles generation of .m3u8 playlists and manages segment metadata.
 */

const SEGMENT_DURATION = 10; // seconds

const hlsManager = {
    /**
     * Generates a Master Playlist (.m3u8) for a movie.
     * @param {string} fileId Google Drive file ID
     * @param {number} duration Total duration in seconds
     * @param {string} baseUrl Base URL for segments
     */
    generatePlaylist: (fileId, duration, baseUrl) => {
        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}\n`;
        playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';
        playlist += '#EXT-X-PLAYLIST-TYPE:VOD\n';

        const segmentCount = Math.ceil(duration / SEGMENT_DURATION);

        for (let i = 0; i < segmentCount; i++) {
            const currentDuration = Math.min(SEGMENT_DURATION, duration - (i * SEGMENT_DURATION));
            playlist += `#EXTINF:${currentDuration.toFixed(3)},\n`;
            playlist += `${baseUrl}/segment/${i}.ts\n`;
        }

        playlist += '#EXT-X-ENDLIST\n';
        return playlist;
    },

    /**
     * Gets the start time and duration for a specific segment index.
     */
    getSegmentRange: (index) => {
        return {
            startTime: index * SEGMENT_DURATION,
            duration: SEGMENT_DURATION
        };
    }
};

module.exports = hlsManager;
