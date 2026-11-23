// Converter Studio (https://converter.studio): the formats it reads and what each converts to
// right now: photos, camera RAW, video, audio, documents, spreadsheets, e-books, fonts and more.
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
 * The formats Converter Studio converts, as a table: id, name, category, file extensions and the
 * format ids each converts to. `from` (heic, pdf, mov...) shows only that format. No key needed.
 */
export async function main(converter_studio?: ConverterStudio, from?: string) {
  const formats = await client(converter_studio ?? { apiKey: '' }).formats({ from });
  return formats.map(({ id, name, category, extensions, to }) => ({
    id,
    name,
    category,
    extensions: extensions.join(', '),
    to: to.join(', '),
  }));
}
