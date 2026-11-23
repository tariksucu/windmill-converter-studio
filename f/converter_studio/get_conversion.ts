// Converter Studio (https://converter.studio): look up a conversion by its id: its status, price
// in credits and, once it is done, a download link valid for 6 hours.
import { ConverterStudio as Client } from 'converter-studio@1.0.0';

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
 * A Converter Studio conversion as it stands. With `wait_seconds` (1 to 60), the answer waits up
 * to that long for the conversion to be done, fail or ask for a go-ahead.
 */
export async function main(
  converter_studio: ConverterStudio,
  id: string,
  wait_seconds: number = 0,
) {
  const conversion = await client(converter_studio).getConversion(id.trim(), {
    waitSeconds: wait_seconds,
  });
  const { raw: _raw, ...view } = conversion;
  return view;
}
