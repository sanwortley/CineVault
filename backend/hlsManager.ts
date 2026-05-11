const SEGMENT_DURATION = 6

interface SegmentRange {
  startTime: number
  duration: number
}

const hlsManager = {
  generatePlaylist(fileId: string, duration: number, baseUrl: string, quality: string = '480'): string {
    let playlist = '#EXTM3U\n'
    playlist += '#EXT-X-VERSION:3\n'
    playlist += `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}\n`
    playlist += '#EXT-X-MEDIA-SEQUENCE:0\n'
    playlist += '#EXT-X-PLAYLIST-TYPE:VOD\n'

    const segmentCount = Math.ceil(duration / SEGMENT_DURATION)

    for (let i = 0; i < segmentCount; i++) {
      const currentDuration = Math.min(SEGMENT_DURATION, duration - i * SEGMENT_DURATION)
      playlist += `#EXTINF:${currentDuration.toFixed(3)},\n`
      playlist += `segment/${i}.ts?q=${quality}\n`
    }

    playlist += '#EXT-X-ENDLIST\n'
    return playlist
  },

  getSegmentRange(index: number): SegmentRange {
    return {
      startTime: index * SEGMENT_DURATION,
      duration: SEGMENT_DURATION,
    }
  },
}

export default hlsManager
