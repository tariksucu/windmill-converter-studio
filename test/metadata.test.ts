// The scripts as Windmill reads them (its own TypeScript parser), against their metadata files and
// the resource type.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, parse_deno, parse_ts_imports } from 'windmill-parser-wasm-ts';

import packageJson from '../package.json';

const require = createRequire(import.meta.url);
initSync({
  module: readFileSync(require.resolve('windmill-parser-wasm-ts/windmill_parser_wasm_bg.wasm')),
});

interface Arg {
  name: string;
  typ: unknown;
  has_default: boolean;
  default: unknown;
}

interface Metadata {
  summary: string;
  description: string;
  kind: string;
  schema: {
    order: string[];
    required: string[];
    properties: Record<string, { format?: string; default?: unknown; description?: string }>;
  };
}

const folder = new URL('../f/converter_studio/', import.meta.url);
const scripts = readdirSync(folder)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.replace(/\.ts$/, ''));

function read(name: string): string {
  return readFileSync(new URL(name, folder), 'utf8');
}

test('there are six scripts', () => {
  expect(scripts.sort()).toEqual([
    'confirm_conversion',
    'convert_file',
    'convert_from_url',
    'get_account',
    'get_conversion',
    'list_formats',
  ]);
});

describe.each(scripts)('%s', (name) => {
  const code = read(`${name}.ts`);
  const args = (JSON.parse(parse_deno(code)) as { args: Arg[] }).args;
  const metadata = Bun.YAML.parse(read(`${name}.script.yaml`)) as Metadata;

  test("takes the converter_studio resource first, as Windmill's parser reads it", () => {
    expect(args[0]?.name).toBe('converter_studio');
    expect(args[0]?.typ).toMatchObject({ object: { name: 'converter_studio' } });
    expect(metadata.schema.properties['converter_studio']?.format).toBe(
      'resource-converter_studio',
    );
  });

  test('its metadata lists the same arguments, required ones and defaults', () => {
    expect(metadata.schema.order).toEqual(args.map((arg) => arg.name));
    expect(Object.keys(metadata.schema.properties).sort()).toEqual(
      args.map((arg) => arg.name).sort(),
    );
    expect(metadata.schema.required.sort()).toEqual(
      args
        .filter((arg) => !arg.has_default)
        .map((arg) => arg.name)
        .sort(),
    );
    for (const arg of args.filter((a) => a.default !== null))
      expect(metadata.schema.properties[arg.name]?.default).toEqual(arg.default);
  });

  test('imports the pinned client and names itself with the package version', () => {
    const imports = (JSON.parse(parse_ts_imports(code)) as { imports: string[] }).imports;
    expect(imports).toContain(
      `converter-studio@${packageJson.devDependencies['converter-studio']}`,
    );
    expect(code).toContain(`const CLIENT = 'windmill/${packageJson.version}';`);
  });

  test('its summary and description name Converter Studio and its address', () => {
    expect(metadata.kind).toBe('script');
    expect(metadata.summary).toContain('Converter Studio');
    expect(metadata.description).toContain('Converter Studio (https://converter.studio)');
    expect(code).toContain('https://converter.studio');
  });
});

test('the resource type keeps the API key secret and points at converter.studio', () => {
  const type = Bun.YAML.parse(
    readFileSync(new URL('../converter_studio.resource-type.yaml', import.meta.url), 'utf8'),
  ) as {
    description: string;
    schema: {
      required: string[];
      order: string[];
      properties: Record<string, { type: string; password?: boolean; default?: string }>;
    };
  };
  expect(type.description).toContain('https://converter.studio');
  expect(type.schema.required).toEqual(['apiKey']);
  expect(type.schema.order).toEqual(['apiKey', 'baseUrl']);
  expect(type.schema.properties['apiKey']).toMatchObject({ type: 'string', password: true });
  expect(type.schema.properties['baseUrl']?.default).toBe('https://converter.studio/api');
});
