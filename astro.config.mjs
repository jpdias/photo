import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  site: 'https://example.github.io',
  base: '/portfolio',
  output: 'static',
  image: {
    domains: ['localhost'],
  },
});
