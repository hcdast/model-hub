/** Determine supported containers from file signatures, never a signed URL suffix. */
export function dramaMediaMime(data: Buffer, media: 'image' | 'video' | 'audio'): string {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('ascii');
  if (media === 'image') {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216) return 'image/jpeg';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 3) === 'GIF') return 'image/gif';
  } else {
    if (ascii(4, 8) === 'ftyp') return media === 'audio' ? 'audio/mp4' : 'video/mp4';
    if (data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return `${media}/webm`;
    if (media === 'audio') {
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
      if (ascii(0, 4) === 'OggS') return 'audio/ogg';
      if (ascii(0, 3) === 'ID3' || (data[0] === 255 && (data[1] & 224) === 224)) return 'audio/mpeg';
    }
  }
  throw new Error('素材内容不是支持的媒体文件，请重新上传或检查供应商结果');
}
