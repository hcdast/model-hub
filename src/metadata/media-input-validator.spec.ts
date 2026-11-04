import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises';
import * as http from 'http';
import * as dns from 'dns/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaInputValidatorService, downloadMedia, isPublicMediaIPv4, probeMedia } from './media-input-validator.service';
import { validateParams } from '../common/utils/param-validator';
import { validateParamDefinitions } from '../common/utils/param-definition-validator';
import { legacyMediaConstraints } from '../common/utils/media-constraints';
import { prepareModel } from '../admin/utils/legacy-model-import';
import { mediaConstraintBackfill } from '../admin/utils/media-constraint-backfill';

function wave(seconds: number) {
  const data = Buffer.alloc(44 + seconds * 16000);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); return data;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

describe('Actual file media validation', () => {
  let folder: string;
  beforeAll(async () => { folder = await mkdtemp(join(tmpdir(), 'media-test-')); });
  afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
  it('reads PNG dimensions and WAV duration from actual bytes, independent of URL/header claims', async () => {
    await writeFile(join(folder, 'image'), png); await writeFile(join(folder, 'audio'), wave(2));
    expect(await probeMedia(join(folder, 'image'))).toMatchObject({ kind: 'image', mime: 'image/png', width: 1, height: 1, bytes: png.length });
    expect(await probeMedia(join(folder, 'audio'))).toMatchObject({ kind: 'audio', mime: 'audio/wav', duration: 2, bytes: 32044 });
  });
  it('rejects corrupt files instead of supplying missing metadata defaults', async () => {
    await writeFile(join(folder, 'fake'), '<html>not a video</html>');
    await expect(probeMedia(join(folder, 'fake'))).rejects.toThrow();
  });
  it('measures a real MP4 and rejects its duration and dimensions before accepting a request', async () => {
    const fixture = join(__dirname, 'fixtures/landscape.mp4');
    expect(await probeMedia(fixture)).toMatchObject({ kind: 'video', width: 1280, height: 720, duration: 6 });
    const validator: any = new MediaInputValidatorService();
    validator.download = async (_url: string, file: string) => copyFile(fixture, file);
    const definition: any = { video: { type: 'string', required: true, media: { kind: 'video', duration: { max: 5 } } } };
    await expect(validator.validate({ video: 'https://example.com/a.png' }, definition)).rejects.toThrow();
    definition.video.media.duration.max = 6;
    await validator.validate({ video: 'https://example.com/a.png' }, definition);
    definition.video.media.resolution = { min: 1080 };
    await expect(validator.validate({ video: 'https://example.com/a.png' }, definition)).rejects.toThrow();
  });
  function service(bytes = png) {
    const validator: any = new MediaInputValidatorService();
    validator.download = jest.fn(async (_url: string, file: string) => writeFile(file, bytes));
    return validator;
  }
  it.each([
    { kind: 'image', resolution: { min: 240 } },
    { kind: 'image', width: { min: 2 } },
    { kind: 'image', height: { min: 2 } },
    { kind: 'image', aspectRatio: { min: 2 } },
    { kind: 'image', maxBytes: 10 },
    { kind: 'image', accept: ['image/jpeg'] },
    { kind: 'video' },
  ])('rejects mismatched media constraints %j', async media => {
    await expect(service().validate({ images: ['https://example.com/fake.mp4'] }, { images: { type: 'array', required: true, media } })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('enforces per-file and aggregate duration, including exclusive boundaries and combined output duration', async () => {
    const validator = service(wave(2));
    const defs: any = { audios: { type: 'array', required: true, media: { kind: 'audio', duration: { min: 1, max: 3 }, totalDuration: { max: 3 } } } };
    await validator.validate({ audios: ['https://example.com/a'] }, defs);
    await expect(validator.validate({ audios: ['https://example.com/a', 'https://example.com/b'] }, defs)).rejects.toThrow('媒体校验失败');
    defs.audios.media.duration = { max: 2, exclusive: true };
    await expect(validator.validate({ audios: ['https://example.com/a'] }, defs)).rejects.toThrow();
    defs.audios.media.duration = { max: 3 }; defs.audios.media.maxInputOutputSeconds = 3;
    await expect(validator.validate({ audios: ['https://example.com/a'], duration: 2 }, defs)).rejects.toThrow();
  });
  it('validates nested media even when a field requests skipValidation', async () => {
    await expect(service().validate({ nested: { image: 'https://example.com/a' } }, {
      nested: { type: 'object', required: true, properties: { image: { type: 'string', required: true, skipValidation: true, media: { kind: 'image', width: { min: 2 } } } } },
    })).rejects.toThrow();
  });
  it('reports missing probe as infrastructure failure rather than accepting input', async () => {
    const previous = process.env.MEDIA_FFPROBE_PATH;
    try { process.env.MEDIA_FFPROBE_PATH = join(folder, 'missing-executable'); await expect(probeMedia(join(folder, 'image'))).rejects.toBeInstanceOf(ServiceUnavailableException); }
    finally { if (previous === undefined) delete process.env.MEDIA_FFPROBE_PATH; else process.env.MEDIA_FFPROBE_PATH = previous; }
  });
  it('blocks local/private/metadata endpoints before issuing HTTP', async () => {
    for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '224.0.0.1']) {
      expect(isPublicMediaIPv4(host)).toBe(false);
      await expect(downloadMedia(`http://${host}/asset`, join(folder, 'blocked'), 1024, 1000)).rejects.toThrow();
    }
    expect(isPublicMediaIPv4('8.8.8.8')).toBe(true);
  });
  it('enforces streamed size limits and checks redirect destinations', async () => {
    const originalRequest = http.request;
    const originalLookup = dns.lookup;
    const server = http.createServer((request, response) => {
      if (request.url === '/redirect') { response.writeHead(302, { Location: 'http://127.0.0.1/private' }); response.end(); }
      else { response.writeHead(200, { 'Content-Type': 'image/png' }); response.write(Buffer.alloc(512)); response.end(Buffer.alloc(512)); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as any;
    const requestSpy = jest.spyOn(http, 'request').mockImplementation(((url: URL, options: any, callback: any) => originalRequest(`http://127.0.0.1:${address.port}${url.pathname}`, { ...options, lookup: undefined }, callback)) as any);
    jest.spyOn(dns, 'lookup').mockImplementation(((host: string, options: any) => host === 'public.test' ? Promise.resolve([{ address: '8.8.8.8', family: 4 }]) : originalLookup(host, options)) as any);
    try {
      await expect(downloadMedia('http://public.test/bytes', join(folder, 'too-big'), 1000, 3000)).rejects.toThrow('字节');
      requestSpy.mockClear();
      await expect(downloadMedia('http://public.test/redirect', join(folder, 'redirected'), 1000, 3000)).rejects.toThrow('公网');
      expect(requestSpy).toHaveBeenCalledTimes(1);
    } finally { jest.restoreAllMocks(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('validates custom pixel geometry and media ranges on configuration write', () => {
    const defs: any = { resolution: { type: 'string', required: true, sizeRules: { minSide: 512, maxSide: 2048, maxTotalPixels: 2097152, sizeSeparator: '*' } } };
    expect(validateParams({ resolution: '1024*1024' }, defs).valid).toBe(true);
    expect(validateParams({ resolution: '2048*2048' }, defs).valid).toBe(false);
    expect(validateParams({ resolution: '0*1024' }, defs).valid).toBe(false);
    expect(validateParamDefinitions({ image: { type: 'string', required: true, media: { kind: 'image', duration: { min: 5, max: 2 } } } }).valid).toBe(false);
  });
  it('imports authoritative constraints and mixed-media count rules', () => {
    const raw: any = { model_id: 'fixture', model_name: 'fixture', model_type: 1506, unit_price_map: { default: { unit_credit: 1, sale_unit_price: 1, cost_unit_price: 1 } }, params: {
      images: { type: 'array', size: { max: 10 }, resolution: { min: 240, max: 4096 }, ratio: { min: 0.4, max: 2.5 }, format: ['jpg', 'png'] },
      videos: { type: 'array', duration: { min: 3, max: 15 }, totalDuration: { max: 20 } },
      duration: { type: 'integer', required: false, default: 5, maxInputOutputSeconds: 30 },
    }, media_input_schema: { slots: [{ paramMap: { image: 'images', video: 'videos' } }], maxTotalItems: 5, minTotalItems: 1 } };
    const { doc } = prepareModel(raw);
    expect(doc.params.images.media).toMatchObject({ maxBytes: 10485760, resolution: { min: 240, max: 4096 }, aspectRatio: { min: 0.4, max: 2.5 }, accept: ['image/jpeg', 'image/png'] });
    expect(doc.params.videos.media).toMatchObject({ duration: { min: 3, max: 15 }, totalDuration: { max: 20 }, maxInputOutputSeconds: 30 });
    expect(validateParams({}, doc.params, doc.params_rules).valid).toBe(false);
    expect(validateParams({ images: Array(6).fill('https://example.com/a') }, doc.params, doc.params_rules).valid).toBe(false);
    expect(legacyMediaConstraints('audio_url', { type: 'string', minDuration: 1, maxDuration: 5, maxSize: 15 })).toMatchObject({ kind: 'audio', duration: { min: 1, max: 5 } });
    const existing = { ...doc, disabled: true, revision: 7, params: { ...doc.params, images: { ...doc.params.images, media: { kind: 'image', accept: ['image/*'], maxBytes: 999 } } }, params_rules: [{ when: [], require: ['videos'] }] };
    const set = mediaConstraintBackfill(existing, doc);
    expect(set['params.images.media']).toMatchObject({ maxBytes: 999, accept: ['image/jpeg', 'image/png'], resolution: { min: 240, max: 4096 } });
    expect(set.params_rules).toContainEqual(existing.params_rules[0]);
    expect(Object.keys(set).every(k => k.startsWith('params.') || k === 'params_rules')).toBe(true);
    expect(existing.params.images.media).toEqual({ kind: 'image', accept: ['image/*'], maxBytes: 999 });
  });
});
