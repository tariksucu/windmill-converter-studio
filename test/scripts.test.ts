// Each script's main, run in Bun against a local stand-in for the API and Windmill's storage.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as wmill from 'windmill-client';

import { main as confirmConversion } from '../f/converter_studio/confirm_conversion.ts';
import { main as convertFile } from '../f/converter_studio/convert_file.ts';
import { main as convertFromUrl } from '../f/converter_studio/convert_from_url.ts';
import { main as getAccount } from '../f/converter_studio/get_account.ts';
import { main as getConversion } from '../f/converter_studio/get_conversion.ts';
import { main as listFormats } from '../f/converter_studio/list_formats.ts';
import packageJson from '../package.json';
import { FakeServer, KEY, WM_TOKEN } from './fake-server.ts';

const fake = new FakeServer();
let resource: { apiKey: string; baseUrl: string };
const client = `windmill/${packageJson.version}`;

beforeAll(() => {
  fake.start();
  resource = { apiKey: KEY, baseUrl: `${fake.base}/api` };
  process.env['WM_WORKSPACE'] = 'test';
  wmill.setClient(WM_TOKEN, `${fake.base}/wm`);
});

afterAll(() => {
  fake.stop();
});

beforeEach(() => {
  fake.credits = 1;
});

function text(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

describe('list_formats', () => {
  test('lists the formats as table rows, without a key', async () => {
    const rows = await listFormats({ apiKey: '', baseUrl: `${fake.base}/api` });
    expect(rows).toContainEqual({
      id: 'heic',
      name: 'HEIC',
      category: 'image',
      extensions: 'heic, heif',
      to: 'jpg, png',
    });
    const request = fake.of('GET', '/api/v1/formats').at(-1);
    expect(request?.headers.get('authorization')).toBeNull();
    expect(request?.headers.get('x-converter-studio-client')).toBe(client);
  });

  test('shows one format with from', async () => {
    const rows = await listFormats(resource, 'mov');
    expect(rows.map((row) => row.id)).toEqual(['mov']);
  });
});

describe('get_account', () => {
  test('returns the account and names the scripts in a header', async () => {
    const account = await getAccount(resource);
    expect(account).toMatchObject({ plan: 'pro', credits: 1099 });
    expect(account).not.toHaveProperty('raw');
    const request = fake.of('GET', '/api/v1/account').at(-1);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(request?.headers.get('x-converter-studio-client')).toBe(client);
  });

  test("shows the API's message for a wrong key", async () => {
    await expect(getAccount({ ...resource, apiKey: 'cvs_live_wrong' })).rejects.toThrow(
      'This API key does not work',
    );
  });
});

describe('convert_file', () => {
  test('converts a file from the workspace storage and saves the result there', async () => {
    fake.s3.set('/inbox/IMG_1.HEIC', new TextEncoder().encode('heic-bytes'));
    const result = await convertFile(resource, 'jpg', { s3: 'inbox/IMG_1.HEIC' });
    const created = fake.of('POST', '/api/v1/conversions').at(-1);
    const id = (JSON.parse(text(created?.body)) as { uploadId: string }).uploadId;
    expect(result).toEqual({ s3: `converter_studio/${id}/IMG_1.jpg` });
    expect(text(fake.s3.get(`/converter_studio/${id}/IMG_1.jpg`))).toBe('jpg:setyb-cieh');
    expect(fake.uploads.get(id)?.name).toBe('IMG_1.HEIC');
    expect(created?.headers.get('x-converter-studio-client')).toBe(client);
    expect(created?.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(text(created?.body))).toEqual({ to: 'jpg', uploadId: id, maxCredits: 20 });
  });

  test('reads and writes a secondary storage, at the key given', async () => {
    fake.s3.set('archive/scans/a.pdf', new TextEncoder().encode('pdf'));
    const result = await convertFile(
      resource,
      'docx',
      's3://archive/scans/a.pdf',
      undefined,
      undefined,
      { ocr: true },
      20,
      undefined,
      'out/a.docx',
    );
    expect(result).toEqual({ s3: 'out/a.docx', storage: 'archive' });
    expect(text(fake.s3.get('archive/out/a.docx'))).toBe('docx:fdp');
    const created = fake.of('POST', '/api/v1/conversions').at(-1);
    expect(JSON.parse(text(created?.body))).toMatchObject({ options: { ocr: true } });
  });

  test('converts an uploaded file and returns a file to download', async () => {
    const content = Buffer.from('photo').toString('base64');
    const result = await convertFile(resource, 'png', undefined, content, 'cat.heic');
    expect(result).toEqual({
      file: { content: Buffer.from('png:otohp').toString('base64'), filename: 'cat.png' },
    });
  });

  test('returns the conversion with its link when asked', async () => {
    const content = Buffer.from('photo').toString('base64');
    const result = await convertFile(
      resource,
      'png',
      undefined,
      content,
      'cat.heic',
      undefined,
      20,
      'link',
    );
    expect(result).toMatchObject({ status: 'done', outputName: 'cat.png', credits: 1 });
    expect((result as { downloadUrl: string }).downloadUrl).toContain('/download/');
    expect(result).not.toHaveProperty('raw');
  });

  test('passes an idempotency key on, and a repeat returns the same conversion', async () => {
    fake.s3.set('/again.heic', new TextEncoder().encode('x'));
    const args = [undefined, undefined, undefined, 20, 'link', undefined, 'run-42'] as const;
    const first = await convertFile(resource, 'jpg', { s3: 'again.heic' }, ...args);
    const created = fake.of('POST', '/api/v1/conversions').at(-1);
    expect(created?.headers.get('idempotency-key')).toBe('run-42');
    expect(first).toMatchObject({ status: 'done' });
  });

  test('needs exactly one file, and a name for an uploaded one', async () => {
    await expect(convertFile(resource, 'jpg')).rejects.toThrow(
      'Give either file (S3) or file_base64.',
    );
    await expect(convertFile(resource, 'jpg', { s3: 'a.heic' }, 'eA==')).rejects.toThrow(
      'Give either file (S3) or file_base64.',
    );
    await expect(convertFile(resource, 'jpg', undefined, 'eA==')).rejects.toThrow('file_name');
  });

  test("says when the workspace storage doesn't have the file", async () => {
    await expect(convertFile(resource, 'jpg', { s3: 'missing.heic' })).rejects.toThrow(
      'Failed to load S3 file: 404',
    );
  });

  test("shows the API's message when the conversion fails", async () => {
    const content = Buffer.from('x').toString('base64');
    await expect(convertFile(resource, 'pdf', undefined, content, 'broken.docx')).rejects.toThrow(
      "This file couldn't be converted.",
    );
  });

  test('stops at a price above max_credits and names the conversion', async () => {
    fake.credits = 5;
    const content = Buffer.from('video').toString('base64');
    const error = await convertFile(resource, 'mp4', undefined, content, 'talk.mov', undefined, 2)
      .then(() => null)
      .catch((caught: unknown) => caught as Error);
    expect(error?.message).toMatch(
      /costs 5 credits, more than the 2 .* Conversion id: job\d+ \(see "Confirm a quoted/,
    );
  });
});

describe('convert_from_url', () => {
  test('converts a link and returns the conversion with its download link', async () => {
    const result = await convertFromUrl(resource, 'https://example.com/report.docx', 'pdf');
    expect(result).toMatchObject({ status: 'done', to: 'pdf', outputName: 'report.pdf' });
    const created = fake.of('POST', '/api/v1/conversions').at(-1);
    expect(JSON.parse(text(created?.body))).toEqual({
      to: 'pdf',
      url: 'https://example.com/report.docx',
      maxCredits: 20,
    });
    expect(created?.headers.get('x-converter-studio-client')).toBe(client);
  });

  test('saves the result in the workspace storage', async () => {
    const result = await convertFromUrl(
      resource,
      'https://example.com/clip.mov',
      'mp4',
      { height: '720' },
      20,
      's3',
    );
    expect((result as { s3: string }).s3).toMatch(/^converter_studio\/job\d+\/clip\.mp4$/);
  });
});

describe('get_conversion and confirm_conversion', () => {
  test('confirms a quoted conversion and waits for it', async () => {
    fake.credits = 30;
    const error = await convertFromUrl(resource, 'https://example.com/long.mov', 'mp4')
      .then(() => null)
      .catch((caught: unknown) => caught as Error);
    const id = error?.message.match(/Conversion id: (job\d+)/)?.[1];
    expect(id).toBeTruthy();
    expect(await getConversion(resource, id ?? '')).toMatchObject({
      status: 'quoted',
      credits: 30,
    });
    const done = await confirmConversion(resource, ` ${id} `);
    expect(done).toMatchObject({ id, status: 'done' });
    expect(fake.of('POST', `/api/v1/conversions/${id}/confirm`)).toHaveLength(1);
  });

  test('get_conversion asks the API to wait with wait_seconds', async () => {
    const created = await convertFromUrl(resource, 'https://example.com/a.heic', 'jpg');
    await getConversion(resource, (created as { id: string }).id, 5);
    const request = fake.requests.at(-1);
    expect(request?.url.searchParams.get('wait')).toBe('5');
  });

  test("shows the API's message for an unknown id", async () => {
    await expect(getConversion(resource, 'nope')).rejects.toThrow(
      "We couldn't find that conversion.",
    );
  });
});
