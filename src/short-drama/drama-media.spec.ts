import { dramaMediaMime } from './drama-media';
describe('Short drama owned media containers', () => {
  it('uses actual WAV and MP4 signatures rather than the requested media suffix', () => {
    expect(dramaMediaMime(Buffer.from('RIFF0000WAVEfmt '), 'audio')).toBe('audio/wav');
    expect(dramaMediaMime(Buffer.from('0000ftypisom'), 'video')).toBe('video/mp4');
    expect(dramaMediaMime(Buffer.from([26, 69, 223, 163, 0]), 'video')).toBe('video/webm');
    expect(() => dramaMediaMime(Buffer.from('<html>expired</html>'), 'video')).toThrow('素材内容');
    expect(() => dramaMediaMime(Buffer.from('RIFF0000WEBP'), 'audio')).toThrow('素材内容');
  });
});
