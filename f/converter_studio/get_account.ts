// Converter Studio (https://converter.studio): the API key's account: plan, credits left and
// limits. Plans and credits: https://converter.studio/pricing
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

/** The Converter Studio account of the resource's API key: plan, credits left, file limits. */
export async function main(converter_studio: ConverterStudio) {
  const { raw: _raw, ...account } = await client(converter_studio).account();
  return account;
}
