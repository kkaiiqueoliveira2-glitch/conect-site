// Mesma suite, servidor diferente.
//
// O playwright.config.js sobe o preview.js, que serve os arquivos crus e nao
// le o vercel.json. Isso e otimo pra testar a pagina, e inutil pra testar
// header: pro navegador, ali nao existe CSP nenhuma.
//
// Este config sobe `vercel dev`, que aplica o vercel.json igual a producao, e
// e o unico jeito de `tests/headers.spec.js` ver os headers de verdade.
//
// Porta separada de proposito: da pra deixar o preview.js rodando em 4321
// enquanto isso sobe em 4322, sem uma coisa derrubar a outra.
const base = require('./playwright.config.js');

const PORTA = 4322;

module.exports = {
  ...base,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORTA}` },
  webServer: {
    command: `vercel dev --listen ${PORTA} --yes`,
    // O primeiro `vercel dev` da maquina baixa runtime e consulta o projeto,
    // entao demora bem mais que o preview.js.
    url: `http://127.0.0.1:${PORTA}/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
};
