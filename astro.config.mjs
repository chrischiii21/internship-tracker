import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import fs from 'node:fs';

// https://astro.build/config
export default defineConfig({
  output: 'server',
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
