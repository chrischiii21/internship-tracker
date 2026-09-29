import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import fs from 'node:fs';

// https://astro.build/config
export default defineConfig({
  site: 'https://internship-tracker-self.vercel.app',
  output: 'server',
  // Astro 7 defaults to 'jsx', which drops whitespace between inline elements written on separate
  // lines; keep the HTML-aware compression the pages were written against.
  compressHTML: true,
  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
  }),
  integrations: [
    {
      name: 'capacitor-index-patch',
      hooks: {
        'astro:build:done': () => {
          if (!fs.existsSync('dist')) {
            fs.mkdirSync('dist', { recursive: true });
          }
          fs.writeFileSync(
            'dist/index.html',
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>InternFlow</title></head><body><div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><h2>InternFlow Loading...</h2></div></body></html>'
          );
          console.log('Successfully generated dist/index.html for Capacitor!');
        }
      }
    }
  ]
});
