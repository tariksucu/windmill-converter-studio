// Converter Studio (https://converter.studio): go ahead with a conversion that costs more than its
// max_credits and waits for a go-ahead (status "quoted"). Nothing is charged before this.
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
 * Confirms a quoted Converter Studio conversion and, unless `wait` is off, waits until it is done
 * (the result's download link is valid for 6 hours).
 */
export async function main(converter_studio: ConverterStudio, id: string, wait: boolean = true) {
  const api = client(converter_studio);
  let conversion = await api.confirm(id.trim());
  if (wait) conversion = await api.wait(conversion);
  const { raw: _raw, ...view } = conversion;
  return view;
}
