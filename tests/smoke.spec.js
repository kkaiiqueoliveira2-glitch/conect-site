// Cada teste aqui nasceu de um erro real que já apareceu no site. A regra pra
// entrar neste arquivo é essa: não é teste de "e se um dia", é teste de coisa
// que já quebrou uma vez e não pode quebrar de novo sem alguém ficar sabendo.
const { test, expect } = require('@playwright/test');

// A página é dirigida por rolagem: reveal, esteiras, muro de depoimentos e o
// hero só ligam quando o scroll passa por eles. Metade dos defeitos só aparece
// depois de percorrer tudo, então quase todo teste começa por aqui.
async function percorrerPagina(page) {
  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 25));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
}

// O vídeo do hero tem 1,3 MB e é baixado inteiro a cada `goto`. Nenhum teste
// daqui verifica o vídeo em si, só o comportamento em volta dele, e carregar
// isso dez vezes seguidas estourava o tempo limite no CI. Com o vídeo fora, o
// hero cai no poster, que é exatamente o que acontece em conexão ruim.
test.beforeEach(async ({ page }) => {
  await page.route('**/*.mp4', (rota) => rota.abort());
});

function coletarErros(page) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // A URL vai junto de propósito. O texto do console para recurso que falhou
    // é sempre o mesmo ("Failed to load resource"), sem dizer qual: filtrar só
    // por ele esconderia falha de verdade junto com o vídeo que eu bloqueei.
    if (m.type() === 'error') erros.push(`console: ${m.text()} @ ${m.location()?.url || 'sem url'}`);
  });
  return erros;
}

test('a página inteira carrega sem erro de JavaScript', async ({ page }) => {
  const erros = coletarErros(page);
  await percorrerPagina(page);
  // O Pixel da Meta e o gtag são bloqueados no CI (sem rede externa) e geram
  // ruído de console que não é defeito nosso.
  const nossos = erros.filter(
    (e) =>
      // rastreadores externos: bloqueados no CI, não é defeito nosso
      !/facebook|fbq|googletagmanager|gtag|ERR_(BLOCKED|NAME|INTERNET|CONNECTION)/i.test(e) &&
      // o vídeo do hero, que este próprio arquivo aborta no beforeEach
      !/\.mp4\b/i.test(e)
  );
  expect(nossos, `erros na página:\n${nossos.join('\n')}`).toEqual([]);
});

test('nenhuma imagem quebrada', async ({ page }) => {
  await percorrerPagina(page);
  const quebradas = await page.evaluate(() =>
    [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.getAttribute('src'))
  );
  expect(quebradas, `imagens que não carregaram: ${quebradas.join(', ')}`).toEqual([]);
});

test('nenhum link interno aponta para seção que não existe', async ({ page }) => {
  // Este teste existe porque remover uma seção e esquecer o link da nav
  // apontando pra ela já aconteceu: o menu vira clique morto e ninguém percebe.
  await percorrerPagina(page);
  const mortos = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && h !== '#' && !document.querySelector(h))
  );
  expect(mortos, `âncoras sem destino: ${mortos.join(', ')}`).toEqual([]);
});

test('as seções essenciais estão na página, na ordem', async ({ page }) => {
  await percorrerPagina(page);
  const ids = await page.evaluate(() =>
    [...document.body.children].filter((e) => e.id).map((e) => e.id)
  );
  for (const esperado of ['heroWrapper', 'work', 'services', 'sites', 'depoimentos', 'contact']) {
    expect(ids, `faltou a seção #${esperado}`).toContain(esperado);
  }
  expect(ids.indexOf('work')).toBeLessThan(ids.indexOf('sites'));
  expect(ids.indexOf('sites')).toBeLessThan(ids.indexOf('contact'));
});

test('as metatags de busca e compartilhamento estão preenchidas', async ({ page }) => {
  // Já saiu deploy com a description falando de serviço que a página não vende.
  // É o texto que aparece no Google e no WhatsApp: erra aqui, erra na vitrine.
  await page.goto('/index.html');
  const meta = await page.evaluate(() => {
    const c = (sel) => document.querySelector(sel)?.getAttribute('content') || '';
    return {
      titulo: document.title,
      description: c('meta[name="description"]'),
      ogTitulo: c('meta[property="og:title"]'),
      ogImagem: c('meta[property="og:image"]'),
    };
  });
  expect(meta.titulo.length).toBeGreaterThan(15);
  expect(meta.titulo.length).toBeLessThan(70);
  expect(meta.description.length).toBeGreaterThan(50);
  expect(meta.description.length).toBeLessThan(200);
  expect(meta.ogTitulo).not.toBe('');
  expect(meta.ogImagem).toMatch(/^https?:\/\//);
});

test('a esteira de marcas carrega todas as logos', async ({ page }) => {
  await percorrerPagina(page);
  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.marcas img')];
    return {
      total: imgs.length,
      quebradas: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    };
  });
  expect(r.total).toBeGreaterThan(0);
  expect(r.quebradas).toBe(0);
});

test.describe('hero dirigido por rolagem', () => {
  // No celular o hero é estático de propósito (modoLeve no JS): não há escada
  // de letras pra testar lá.
  test.skip(({ isMobile }) => isMobile, 'o hero só é dirigido por rolagem no desktop');

  test('os títulos são quebrados em letras e animam ao rolar', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(2000);

    const letras = await page.locator('#introTitle .char').count();
    expect(letras, 'o título de abertura não foi dividido em letras').toBeGreaterThan(20);

    const medir = () =>
      page.evaluate(() => {
        const c = document.querySelector('#introTitle .char');
        return { opacidade: getComputedStyle(c).opacity, transform: getComputedStyle(c).transform };
      });

    const wrapper = await page.evaluate(() => {
      const h = document.getElementById('heroWrapper');
      return { topo: h.offsetTop, rolavel: h.offsetHeight - window.innerHeight };
    });
    expect(wrapper.rolavel, 'o hero não tem curso de rolagem').toBeGreaterThan(200);

    await page.evaluate((y) => window.scrollTo(0, y), wrapper.topo + wrapper.rolavel * 0.2);
    await page.waitForTimeout(500);
    const a = await medir();
    await page.evaluate((y) => window.scrollTo(0, y), wrapper.topo + wrapper.rolavel * 0.45);
    await page.waitForTimeout(500);
    const b = await medir();

    expect(
      a.opacidade !== b.opacidade || a.transform !== b.transform,
      'as letras não mudaram entre dois pontos da rolagem: a escada parou de funcionar'
    ).toBe(true);
  });
});

test.describe('muro de depoimentos', () => {
  test.skip(({ isMobile }) => isMobile, 'no celular o muro vira coluna única');

  test('tem três colunas e o mouse pausa só a coluna de baixo do cursor', async ({ page }) => {
    // Este teste existe porque a primeira versão pausava as três colunas de uma
    // vez: parar a tela inteira pra ler um card faz o bloco parecer travado.
    await percorrerPagina(page);
    await page.evaluate(() =>
      document.querySelector('.muro').scrollIntoView({ block: 'center' })
    );
    await page.waitForTimeout(600);

    const colunas = page.locator('.muro-col');
    await expect(colunas).toHaveCount(3);

    const estado = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.muro-pista')].map(
          (x) => getComputedStyle(x).animationPlayState
        )
      );

    expect(await estado()).toEqual(['running', 'running', 'running']);

    for (const n of [1, 2, 3]) {
      const ponto = await page.evaluate((i) => {
        const c = document
          .querySelector(`.muro-col:nth-child(${i})`)
          .getBoundingClientRect();
        return {
          x: Math.round(c.left + c.width / 2),
          y: Math.round(Math.min(Math.max(c.top + 30, 60), window.innerHeight - 60)),
        };
      }, n);
      await page.mouse.move(ponto.x, ponto.y);
      await page.waitForTimeout(300);
      const esperado = ['running', 'running', 'running'];
      esperado[n - 1] = 'paused';
      expect(await estado(), `mouse na coluna ${n} deveria pausar só ela`).toEqual(esperado);
    }
  });

  test('a mesma fala não aparece em duas colunas ao mesmo tempo', async ({ page }) => {
    await percorrerPagina(page);
    await page.evaluate(() =>
      document.querySelector('.muro').scrollIntoView({ block: 'center' })
    );
    await page.waitForTimeout(600);

    const repetidas = await page.evaluate(() => {
      const muro = document.querySelector('.muro');
      const área = muro.getBoundingClientRect();
      const porColuna = [...muro.querySelectorAll('.muro-col')].map((col) =>
        [...col.querySelectorAll('.muro-card')]
          .filter((c) => {
            const b = c.getBoundingClientRect();
            return b.bottom > área.top + 40 && b.top < área.bottom - 40;
          })
          .map((c) => c.querySelector('.muro-nome').textContent.trim())
      );
      const todos = [...new Set(porColuna.flat())];
      return todos.filter((n) => porColuna.filter((c) => c.includes(n)).length > 1);
    });
    expect(repetidas, `fala repetida entre colunas: ${repetidas.join(', ')}`).toEqual([]);
  });
});

test('o formulário de lead tem os campos que a API exige', async ({ page }) => {
  // A API rejeita com 400 se faltar campo. Se o form e a função saírem de
  // sincronia, todo envio vira erro e o lead se perde.
  await percorrerPagina(page);
  const nomes = await page.evaluate(() =>
    [...document.querySelectorAll('#contact input, #contact select, #contact textarea')]
      .map((e) => e.name || e.id)
      .filter(Boolean)
  );
  for (const campo of ['nome', 'whatsapp', 'email']) {
    expect(nomes.join(' ').toLowerCase(), `o formulário não tem o campo ${campo}`).toContain(campo);
  }
});
