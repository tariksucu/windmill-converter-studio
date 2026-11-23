// Converter Studio (https://converter.studio): convert a file from the workspace storage (S3) or
// an uploaded file to another format. The file is sent to converter.studio and the conversion
// uses your account's credits. Privacy: https://converter.studio/privacy
import * as wmill from 'windmill-client';
import {
  ConfirmationRequiredError,
  ConverterStudio as Client,
  type ConversionOptions,
} from 'converter-studio@1.0.0';

/** The converter_studio resource: an API key from https://converter.studio/account#api-keys */
type ConverterStudio = {
  apiKey: string;
  baseUrl?: string;
};

const CLIENT = 'windmill/1.0.0';

function client(resource: ConverterStudio): Client {
  return new Client({
    apiKey: resource.apiKey,
    baseUrl: resource.baseUrl || undefined,
    // Names these scripts to the API (X-Converter-Studio-Client).
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('X-Converter-Studio-Client', CLIENT);
      return fetch(input, { ...init, headers });
    },
  });
}

/** An S3 object as a record: `{ s3: key, storage? }` (from `s3://storage/key` too). */
function s3Record(file: wmill.S3Object): { s3: string; storage?: string | undefined } {
  if (typeof file !== 'string') return { s3: file.s3, storage: file.storage || undefined };
  const match = /^s3:\/\/([^/]*)\/(.+)$/.exec(file);
  if (!match?.[2]) throw new Error(`Not an S3 object: ${file}`);
  return { s3: match[2], storage: match[1] || undefined };
}

/**
 * Converts a file with Converter Studio: give `file` (the workspace storage) or `file_base64`
 * with `file_name`.
 *
 * `to`: the format to convert to (jpg, png, webp, avif, pdf, docx, mp4, mp3...; the "List formats"
 * script shows them all). `options`: conversion settings such as {"quality": "high"} or
 * {"ocr": true}. Above `max_credits`, the conversion waits for "Confirm a quoted conversion".
 * `result_as`: "s3" saves the result in the workspace storage (at `output_key`, default
 * converter_studio/<conversion id>/<name>), "base64" returns a file to download, "link" returns
 * the conversion with a download link valid for 6 hours; by default, like the input.
 * `idempotency_key`: the same key within 24 hours returns the first conversion, not a second one.
 */
export async function main(
  converter_studio: ConverterStudio,
  to: string,
  file?: wmill.S3Object,
  file_base64?: wmill.Base64,
  file_name?: string,
  options?: object,
  max_credits: number = 20,
  result_as?: 's3' | 'base64' | 'link',
  output_key?: string,
  idempotency_key?: string,
) {
  if (!file === !file_base64) throw new Error('Give either file (S3) or file_base64.');
  const api = client(converter_studio);
  let source: Blob;
  let name = file_name?.trim();
  let storage: string | undefined;
  if (file) {
    const record = s3Record(file);
    storage = record.storage;
    name ||= record.s3.split('/').pop();
    const blob = await wmill.loadS3FileStream(record);
    if (!blob) throw new Error(`The workspace storage has no file ${record.s3}.`);
    source = blob;
  } else {
    if (!name) throw new Error('file_name (with its extension, such as photo.heic) is needed.');
    source = new Blob([Buffer.from(file_base64 ?? '', 'base64')]);
  }

  const upload = await api.upload(source, { fileName: name });
  let conversion = await api.createConversion({
    to,
    uploadId: upload.id,
    options: options as ConversionOptions | undefined,
    maxCredits: max_credits,
    idempotencyKey: idempotency_key || undefined,
  });
  try {
    conversion = await api.wait(conversion);
  } catch (error) {
    if (!(error instanceof ConfirmationRequiredError)) throw error;
    throw new Error(
      `${error.message} Conversion id: ${conversion.id} (see "Confirm a quoted Converter Studio conversion").`,
    );
  }
  console.log(`${conversion.inputName} to ${conversion.outputName}: ${conversion.credits} credits`);

  const as = result_as ?? (file ? 's3' : 'base64');
  if (as === 'link') {
    const { raw: _raw, ...view } = conversion;
    return view;
  }
  const output = conversion.outputName ?? `${conversion.id}.${conversion.to ?? 'bin'}`;
  const result = await new Response(await api.downloadStream(conversion)).blob();
  if (as === 'base64')
    return {
      file: {
        content: Buffer.from(await result.arrayBuffer()).toString('base64'),
        filename: output,
      },
    };
  const key = output_key?.trim() || `converter_studio/${conversion.id}/${output}`;
  return await wmill.writeS3File({ s3: key, storage }, result);
}
