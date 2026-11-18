# WrapPrep

Drag and drop an AI image, choose a vehicle, trailer or window size, and download a print-ready PDF or TIFF with bleed.

- Runs in the browser; images are not uploaded unless you click "Enlarge with AI".
- Quality check shows effective dots per inch at full size.
- PDFs over 200 inches are saved at 1:10 scale with a UserUnit of 10 (true size in compliant RIPs).
- TIFFs keep native pixels and set the resolution tag so they open at true physical size.

## Run locally
    npm install
    npm run dev

## Hosting (Vercel)
Import the repo in Vercel. For AI enlargement, set `REPLICATE_API_TOKEN` (and optionally `REPLICATE_MODEL_VERSION`) in the project's environment variables.
