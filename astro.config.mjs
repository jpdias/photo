import { defineConfig } from 'astro/config';
import { createLogger } from 'vite';
import react from '@astrojs/react';

const logger = createLogger();
const loggerWarn = logger.warn;
logger.warn = (msg, options) => {
  if (msg.includes('esbuild') || msg.includes('rolldown')) return;
  loggerWarn(msg, options);
};

export default defineConfig({
  integrations: [react()],
  site: 'https://example.github.io',
  base: '/portfolio',
  output: 'static',
  image: {
    domains: ['localhost'],
  },
  vite: {
    customLogger: logger,
  },
});
