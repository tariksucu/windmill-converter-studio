# Converter Studio for Windmill

A resource type and six scripts that convert files with [Converter Studio](https://converter.studio)
from [Windmill](https://www.windmill.dev) scripts, flows and apps: iPhone photos (HEIC), camera RAW
photos, videos, audio, PDF and Office documents, spreadsheets, presentations, e-books, subtitles
and more. The conversion runs on Converter Studio's servers, so the worker needs nothing installed:
no ImageMagick, no FFmpeg, no LibreOffice.

| Script                                                                           | What it does                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Convert a file to another format](f/converter_studio/convert_file.ts)           | A file from the workspace storage (S3) or an uploaded file to another format. Returns the result in the storage, as a file to download or a link. |
| [Convert a file from a URL](f/converter_studio/convert_from_url.ts)              | The file behind a link (direct, Google Drive, Dropbox or OneDrive). Converter Studio fetches it itself.                                           |
| [Get a conversion](f/converter_studio/get_conversion.ts)                         | A conversion's status, price and download link, by its id.                                                                                        |
| [Confirm a quoted conversion](f/converter_studio/confirm_conversion.ts)          | Goes ahead with a conversion that costs more than its `max_credits`.                                                                              |
| [List the formats Converter Studio converts](f/converter_studio/list_formats.ts) | Every format it reads and what each converts to, as a table. No key needed.                                                                       |
| [Get account credits](f/converter_studio/get_account.ts)                         | The key's plan, credits left and file limits.                                                                                                     |

The scripts are TypeScript for Windmill's Bun runtime and use the official JavaScript client,
[`converter-studio`](https://www.npmjs.com/package/converter-studio) (pinned to 1.0.0 in the
import), which uploads large files in parts, waits with long polling and retries safely.

## Set up

1. Create an API key on your Converter Studio account page:
   [converter.studio/account#api-keys](https://converter.studio/account#api-keys). Keys start with
   `cvs_live_` and are shown once. Free accounts get 25 credits a day; most files cost 1 credit,
   audio and video are priced by their length. See [pricing](https://converter.studio/pricing).
2. In Windmill, open **Resources**, add a resource of type `converter_studio` and paste the key in
   `apiKey` (Windmill keeps it as a secret). Leave `baseUrl` at `https://converter.studio/api`.
3. Add the scripts to your workspace, from the [Windmill Hub](https://hub.windmill.dev) once they are
   listed there, or from this repository with the
   [Windmill CLI](https://www.windmill.dev/docs/advanced/cli) (after `wmill workspace add`):

   ```bash
   wmill resource-type push converter_studio.resource-type.yaml converter_studio
   for f in f/converter_studio/*.ts; do wmill script push "$f"; done
   ```

   You can also paste a script into a new Bun script in the editor. If your workspace has no
   `converter_studio` resource type yet, push it as shown (its schema is in
   [`converter_studio.resource-type.yaml`](converter_studio.resource-type.yaml)).

## Use

**Convert a file** takes either `file`, a file in the
[workspace storage](https://www.windmill.dev/docs/core_concepts/object_storage_in_windmill) (S3), or
`file_base64`, an uploaded file, with `file_name` (the name with its extension, such as
`IMG_1234.HEIC`). `to` is the format to convert to: `jpg`, `png`, `webp`, `avif`, `pdf`, `docx`,
`mp4`, `mp3`... (**List the formats** shows every one). The script waits until the result is ready
(10 minutes at most) and returns, according to `result_as`:

- `s3` (the default for a file from S3): the result saved in the workspace storage, at
  `converter_studio/<conversion id>/<result name>` or at `output_key`, in the same storage as the
  source. Windmill shows it with a download button, and the next flow step gets `{ "s3": "..." }`.
- `base64` (the default for an uploaded file): `{ "file": { "content", "filename" } }`, which
  Windmill shows as a file to download.
- `link`: the conversion itself (`id`, `status`, `credits`, `outputName`, `downloadUrl`...). The
  download link works for 6 hours, and the result never passes through your worker.

**Convert a file from a URL** does the same for a link and returns `link` by default.

`options` takes the conversion's settings, the same as on the website: `{"quality": "high"}`,
`{"height": "720"}` for a video, `{"ocr": true}` for a scanned PDF to Word, `{"compression":
"strong"}` for a smaller PDF... The list is on the [API page](https://converter.studio/developers).

**Prices and approval.** A conversion starts on its own when it costs up to `max_credits` (20 by
default). A dearer one, such as a long video, waits and costs nothing: the script stops with an
error that gives the price and the conversion's id. Run **Confirm a quoted conversion** with that id
to go ahead (for example after an approval step in a flow), or leave it.

**Retries.** The client retries network errors on its own without starting a second conversion. If
a flow step itself is retried, pass the same `idempotency_key` (such as the flow's job id and the
step) and a repeat within 24 hours returns the first conversion instead of a new one.

Errors show Converter Studio's own message: a wrong key, too few credits, a file that cannot be
converted (no credits are charged for a failed conversion).

## Limits

- The largest file and the longest audio or video depend on the plan (see **Get account
  credits**: `maxFileBytes`, `maxMediaSeconds`).
- With `s3` and `base64`, the file and the result pass through the worker's memory, and a `base64`
  result is stored in Windmill's database with the job: for large files prefer `link` or `s3`.
- One file in, one file out. Results are kept for 6 hours.

## Privacy

The scripts send the file (with its name) to Converter Studio, at converter.studio, and nothing
else about your workspace. Converter Studio deletes each upload once it is converted and each result
after 6 hours. The API key stays in your Windmill resource; the scripts never print or return it.
Each request says which client sent it (`X-Converter-Studio-Client: windmill/<version>`), for
usage statistics only. See the [privacy policy](https://converter.studio/privacy) and the
[terms](https://converter.studio/terms).

## Development

```bash
npm ci
npm run lint    # Prettier and TypeScript
npm test        # Bun: the scripts against a local stand-in for the API and the storage
```

The tests also read each script with Windmill's own parser (`windmill-parser-wasm-ts`) and check
the arguments against the `.script.yaml` metadata.

## Links

- Converter Studio: <https://converter.studio>
- API documentation: <https://converter.studio/developers>
- Source code and issues: <https://github.com/tariksucu/windmill-converter-studio>
- Support: <support@converter.studio>

MIT licensed. © Converter Studio.
