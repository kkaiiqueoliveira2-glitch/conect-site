// O site é um arquivo estático servido pelo preview.js. O Playwright sobe esse
// mesmo servidor antes de rodar, para o teste bater no que o navegador realmente
// entrega (com content-type, com caminho relativo) e não em `file://`, que se
// comporta diferente em CSP, fetch e vídeo.
const { defineConfig, devices } = require('@playwright/test');

const PORTA = 4321;

module.exports = defineConfig({
  testDir: './tests',
  // A página é dirigida por rolagem e por animação de CSS. Passo de tempo curto
  // demais gera teste instável, então o timeout é folgado de propósito.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // No CI, teste que só passa na segunda tentativa é teste que esconde bug.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'node preview.js',
    url: `http://127.0.0.1:${PORTA}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
