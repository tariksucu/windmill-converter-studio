// A small stand-in, on 127.0.0.1, for the Converter Studio API (under /api) and for the two
// Windmill routes the scripts use to read and write the workspace storage (under /wm/api).

export const KEY = 'cvs_live_test_key_0123456789';
export const WM_TOKEN = 'wm_test_token';

export interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: Uint8Array<ArrayBuffer>;
}

interface Job {
  id: string;
  to: string;
  name: string;
  size: number;
  url: string | null;
  status: string;
  credits: number;
  maxCredits: number;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function apiError(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

export class FakeServer {
  readonly requests: Recorded[] = [];
  /** The workspace storage: `storage/key` (the default storage has no name) to its bytes. */
  readonly s3 = new Map<string, Uint8Array<ArrayBuffer>>();
  readonly uploads = new Map<string, { name: string; data: Uint8Array<ArrayBuffer> }>();
  readonly jobs = new Map<string, Job>();
  readonly keys = new Map<string, string>();
  /** The price of every conversion, in credits. */
  credits = 1;
  private counter = 0;
  private server: ReturnType<typeof Bun.serve> | null = null;

  get base(): string {
    return `http://127.0.0.1:${this.server?.port ?? 0}`;
  }

  start(): void {
    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const recorded: Recorded = {
          method: request.method,
          url: new URL(request.url),
          headers: request.headers,
          body: new Uint8Array(await request.arrayBuffer()),
        };
        this.requests.push(recorded);
        return recorded.url.pathname.startsWith('/wm/')
          ? this.windmill(recorded)
          : this.api(recorded);
      },
    });
  }

  stop(): void {
    void this.server?.stop(true);
  }

  of(method: string, path: string): Recorded[] {
    return this.requests.filter((r) => r.method === method && r.url.pathname === path);
  }

  private nextId(): string {
    this.counter += 1;
    return `job${String(this.counter).padStart(8, '0')}`;
  }

  private windmill(request: Recorded): Response {
    if (request.headers.get('authorization') !== `Bearer ${WM_TOKEN}`)
      return new Response('unauthorized', { status: 401 });
    const query = request.url.searchParams;
    const key = `${query.get('storage') ?? ''}/${query.get('file_key') ?? ''}`;
    if (request.url.pathname === '/wm/api/w/test/job_helpers/download_s3_file') {
      const data = this.s3.get(key);
      return data ? new Response(data) : new Response('not found', { status: 404 });
    }
    if (
      request.method === 'POST' &&
      request.url.pathname === '/wm/api/w/test/job_helpers/upload_s3_file'
    ) {
      this.s3.set(key, request.body);
      return json(200, { file_key: query.get('file_key') });
    }
    return new Response('not found', { status: 404 });
  }

  view(job: Job): Record<string, unknown> {
    const done = job.status === 'done';
    const stem = job.name.replace(/\.[^.]*$/, '');
    return {
      id: job.id,
      status: job.status,
      from: job.name.split('.').pop()?.toLowerCase() ?? null,
      to: job.to,
      inputName: job.name,
      inputSize: job.size,
      credits: job.credits,
      maxCredits: job.maxCredits,
      progress: done ? 1 : null,
      outputName: `${stem}.${job.to}`,
      outputSize: done ? this.output(job).byteLength : null,
      downloadUrl: done ? `${this.base}/download/${job.id}?token=tok_${job.id}` : null,
      expiresAt: '2026-11-23T21:00:00.000Z',
      error:
        job.status === 'failed'
          ? { code: 'conversionFailed', message: "This file couldn't be converted." }
          : null,
      next: done ? 'Download the result.' : 'Check again.',
    };
  }

  /** The result: the source's bytes, reversed, behind the target format. */
  output(job: Job): Uint8Array<ArrayBuffer> {
    const source = this.uploads.get(job.id)?.data ?? new TextEncoder().encode(job.url ?? '');
    return new Uint8Array([...new TextEncoder().encode(`${job.to}:`), ...[...source].reverse()]);
  }

  private api(request: Recorded): Response {
    const path = request.url.pathname;
    const { method } = request;
    if (method === 'GET' && path === '/api/v1/formats') {
      const formats = [
        {
          id: 'heic',
          name: 'HEIC',
          category: 'image',
          extensions: ['heic', 'heif'],
          to: ['jpg', 'png'],
        },
        { id: 'mov', name: 'QuickTime', category: 'video', extensions: ['mov'], to: ['mp4'] },
      ];
      const from = request.url.searchParams.get('from');
      return json(200, { formats: formats.filter((f) => !from || f.id === from) });
    }
    if (method === 'PUT' && path.startsWith('/upload/')) {
      const upload = this.uploads.get(path.slice('/upload/'.length));
      if (!upload) return apiError(404, 'notFound', "We couldn't find that upload.");
      upload.data = request.body;
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && path.startsWith('/download/')) {
      const job = this.jobs.get(path.slice('/download/'.length));
      if (job?.status !== 'done')
        return apiError(404, 'notFound', "We couldn't find that conversion.");
      return new Response(this.output(job), {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    if (request.headers.get('authorization') !== `Bearer ${KEY}`)
      return apiError(
        401,
        'invalidApiKey',
        'This API key does not work. Create one on your account page.',
      );
    if (method === 'GET' && path === '/api/v1/account')
      return json(200, {
        email: 'dev@example.com',
        plan: 'pro',
        allApps: true,
        credits: 1099,
        allowance: { used: 1, limit: 1100, per: 'month' },
        packs: 0,
        renewsAt: '2026-12-22T01:16:48.716Z',
        maxFileBytes: 1073741824,
        maxMediaSeconds: 7200,
        wallet: null,
      });
    if (method === 'POST' && path === '/api/v1/uploads') {
      const body = JSON.parse(new TextDecoder().decode(request.body)) as { fileName: string };
      const id = this.nextId();
      this.uploads.set(id, { name: body.fileName, data: new Uint8Array() });
      return json(201, {
        id,
        uploadUrl: `${this.base}/upload/${id}`,
        method: 'PUT',
        maxBytes: 1073741824,
        partBytes: 95 * 1024 * 1024,
        expiresAt: '2026-11-23T16:00:00.000Z',
      });
    }
    if (method === 'POST' && path === '/api/v1/conversions') {
      const body = JSON.parse(new TextDecoder().decode(request.body)) as {
        to: string;
        url?: string;
        uploadId?: string;
        maxCredits?: number;
      };
      const key = request.headers.get('idempotency-key') ?? '';
      const fingerprint = JSON.stringify(body);
      const known = this.keys.get(key);
      if (known) {
        const [id, print] = JSON.parse(known) as [string, string];
        if (print !== fingerprint)
          return apiError(
            409,
            'idempotencyKeyReused',
            'This Idempotency-Key was used for another request.',
          );
        return Response.json(this.view(this.jobs.get(id)!), {
          status: 200,
          headers: { 'Idempotent-Replayed': 'true' },
        });
      }
      const upload = body.uploadId ? this.uploads.get(body.uploadId) : undefined;
      if (body.uploadId && !upload)
        return apiError(404, 'notFound', "We couldn't find that upload.");
      const id = body.uploadId ?? this.nextId();
      const name = upload?.name ?? body.url?.split('/').pop() ?? 'file';
      const maxCredits = body.maxCredits ?? 20;
      const job: Job = {
        id,
        to: body.to,
        name,
        size: upload?.data.byteLength ?? 0,
        url: body.url ?? null,
        status: this.credits > maxCredits ? 'quoted' : 'processing',
        credits: this.credits,
        maxCredits,
      };
      this.jobs.set(id, job);
      this.keys.set(key, JSON.stringify([id, fingerprint]));
      return json(201, this.view(job));
    }
    const match = /^\/api\/v1\/conversions\/([^/]+)(\/confirm)?$/.exec(path);
    const job = match?.[1] ? this.jobs.get(match[1]) : undefined;
    if (!job) return apiError(404, 'notFound', "We couldn't find that conversion.");
    if (method === 'POST' && match?.[2]) {
      if (job.status !== 'quoted')
        return apiError(409, 'invalidRequest', 'This conversion is not waiting.');
      job.status = 'processing';
      return json(200, this.view(job));
    }
    if (method === 'GET' && !match?.[2]) {
      // A conversion is done the second time it is looked at (a "broken" file fails instead).
      if (job.status === 'processing') job.status = job.name.includes('broken') ? 'failed' : 'done';
      return json(200, this.view(job));
    }
    return apiError(404, 'notFound', 'Not found.');
  }
}
