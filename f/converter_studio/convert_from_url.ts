// Converter Studio (https://converter.studio): convert the file behind a link (a direct link, or
// a Google Drive, Dropbox or OneDrive share link) to another format. Converter Studio fetches the
// file itself; the conversion uses your account's credits. Privacy: https://converter.studio/privacy
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

/**
 * Converts the file at `url` with Converter Studio and waits until it is done.
 *
 * `to`: the format to convert to (jpg, pdf, mp4, mp3...; the "List formats" script shows them
 * all). `options`: conversion settings such as {"quality": "high"}. Above `max_credits`, the
 * conversion waits for "Confirm a quoted conversion". `result_as`: "link" (default) returns the
 * conversion with a download link valid for 6 hours, "s3" saves the result in the workspace
 * storage (at `output_key`, default converter_studio/<conversion id>/<name>), "base64" returns a
 * file to download. `idempotency_key`: the same key within 24 hours returns the first conversion.
 */
export async function main(
  converter_studio: ConverterStudio,
  url: string,
  to: string,
  options?: object,
  max_credits: number = 20,
  result_as: 'link' | 's3' | 'base64' = 'link',
  output_key?: string,
  idempotency_key?: string,
) {
  const api = client(converter_studio);
  let conversion = await api.createConversion({
    to,
    url,
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

  if (result_as === 'link') {
    const { raw: _raw, ...view } = conversion;
    return view;
  }
  const output = conversion.outputName ?? `${conversion.id}.${conversion.to ?? 'bin'}`;
  const result = await new Response(await api.downloadStream(conversion)).blob();
  if (result_as === 'base64')
    return {
      file: {
        content: Buffer.from(await result.arrayBuffer()).toString('base64'),
        filename: output,
      },
    };
  const key = output_key?.trim() || `converter_studio/${conversion.id}/${output}`;
  return await wmill.writeS3File({ s3: key }, result);
}
