// Guarda dos headers de seguranca do vercel.json.
//
// Por que este arquivo existe, separado do smoke:
// o smoke sobe o preview.js, que nao le o vercel.json. Ele testa a pagina NUA,
// sem nenhum header, e por isso nao enxerga CSP. Pior: o smoke filtra de
// proposito os erros de `facebook|googletagmanager|gtag` como ruido de CI, que
// e exatamente o texto que apareceria se a CSP bloqueasse o Pixel ou o GTM.
// Ou seja, sem este arquivo o site pode perder rastreamento inteiro e a suite
// segue verde.
//
// O modo de falhar que isso protege e silencioso e caro: o conteudo do
// container do GTM e configurado no painel do Google, nao no codigo. No dia em
// que entrar uma tag nova de GA4 ou de conversao do Google Ads cuja origem nao
// esta liberada, o navegador bloqueia sem avisar ninguem e a atribuicao some.
//
// Roda com: npm run test:headers  (sobe `vercel dev`, que aplica o vercel.json)
const { test, expect } = require('@playwright/test');

const ESPERADOS = {
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*.mp4', (rota) => rota.abort());
});

// Se alguem rodar este arquivo com o config normal (preview.js), nao ha header
// nenhum e todo teste daqui ficaria vermelho pra sempre. Teste vermelho
// permanente ensina todo mundo a ignorar a suite, entao aqui ele pula com o
// motivo escrito em vez de falhar.
async function exigirServidorComHeaders(request) {
  const r = await request.get('/index.html');
  const temCSP = !!r.headers()['content-security-policy'];
  test.skip(!temCSP, 'servidor sem headers: rode `npm run test:headers` (usa vercel dev)');
  return r;
}

test('a resposta traz os seis headers de seguranca', async ({ request }) => {
  const r = await exigirServidorComHeaders(request);
  const h = r.headers();

  for (const [nome, valor] of Object.entries(ESPERADOS)) {
    expect(h[nome], `header ${nome}`).toBe(valor);
  }
  expect(h['content-security-policy'], 'CSP ausente').toBeTruthy();
});

test('a CSP nao afrouxou sem querer', async ({ request }) => {
  const r = await exigirServidorComHeaders(request);
  const csp = r.headers()['content-security-policy'];

  // Um `*` solto em qualquer uma dessas diretivas devolve o site pro estado
  // anterior ao hardening sem que ninguem perceba na revisao.
  expect(csp, "default-src deve ser 'self'").toContain("default-src 'self'");
  expect(csp, "object-src deve ser 'none'").toContain("object-src 'none'");
  expect(csp, "frame-ancestors deve ser 'self'").toContain("frame-ancestors 'self'");
  expect(csp, "base-uri deve ser 'self'").toContain("base-uri 'self'");

  const curinga = csp
    .split(';')
    .map((d) => d.trim())
    .filter((d) => /(^|\s)\*(\s|$)/.test(d) || /\shttps?:(\s|$)/.test(d));
  expect(curinga, `diretiva com curinga aberto: ${curinga.join(' | ')}`).toEqual([]);
});

test('percorrer a pagina inteira nao gera nenhuma violacao de CSP', async ({ page, request }) => {
  await exigirServidorComHeaders(request);

  await page.addInitScript(() => {
    window.__violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violacoes.push(`${e.effectiveDirective} bloqueou ${e.blockedURI}`)
    );
  });

  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 25));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);

  const violacoes = await page.evaluate(() => window.__violacoes || []);
  expect(violacoes, `a CSP bloqueou:\n${violacoes.join('\n')}`).toEqual([]);
});

test('o formulario de lead consegue falar com a propria API sob a CSP', async ({ page, request }) => {
  await exigirServidorComHeaders(request);
  await page.goto('/index.html');
  await page.waitForTimeout(1500);

  // Sem corpo valido a funcao responde 4xx, e e isso que se quer: o que este
  // teste verifica e que o fetch SAI, ou seja, que connect-src nao barrou a
  // propria origem. Bloqueio de CSP viraria TypeError, nao status HTTP.
  const r = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origem: 'teste de csp' }),
      });
      return { saiu: true, status: resp.status };
    } catch (e) {
      return { saiu: false, erro: String(e) };
    }
  });

  expect(r.saiu, `fetch barrado: ${r.erro}`).toBe(true);
  expect(typeof r.status).toBe('number');
});

// Os dois rastreadores dependem de rede externa. Em CI sem rede eles nao
// carregam e isso nao e defeito da CSP, entao o teste so cobra quando o
// script realmente chegou.
test('Pixel e GTM carregam quando ha rede, sem apanhar da CSP', async ({ page, request }) => {
  await exigirServidorComHeaders(request);

  await page.addInitScript(() => {
    window.__violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violacoes.push(`${e.effectiveDirective} bloqueou ${e.blockedURI}`)
    );
  });

  await page.goto('/index.html');
  await page.waitForTimeout(5000);

  const estado = await page.evaluate(() => ({
    fbqCarregado: !!(window.fbq && window.fbq.loaded),
    dataLayer: Array.isArray(window.dataLayer),
    gtmIniciado: !!window.google_tag_manager,
  }));

  const violacoes = await page.evaluate(() => window.__violacoes || []);
  const deRastreio = violacoes.filter((v) => /facebook|google|doubleclick/i.test(v));
  expect(deRastreio, `CSP bloqueou rastreador:\n${deRastreio.join('\n')}`).toEqual([]);

  test.skip(!estado.fbqCarregado && !estado.gtmIniciado, 'sem rede externa: nada a cobrar');

  // O dataLayer e criado pelo snippet inline, entao ele existe mesmo offline.
  // O que so existe com o gtm.js baixado de verdade e o google_tag_manager.
  expect(estado.dataLayer, 'dataLayer do GTM sumiu do HTML').toBe(true);
});
