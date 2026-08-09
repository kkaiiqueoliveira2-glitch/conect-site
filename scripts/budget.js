#!/usr/bin/env node
/**
 * Orçamento de peso. O site é uma página só, servida direto: cada quilobyte
 * aqui é quilobyte que o visitante baixa antes de ver qualquer coisa. Sem um
 * teto declarado, o arquivo cresce sozinho a cada seção nova e ninguém percebe
 * até o celular no 4G demorar cinco segundos.
 *
 * Os limites não são aspiracionais: estão logo acima do tamanho de hoje, para
 * travar o crescimento sem quebrar o build do nada. Quando um deles apertar de
 * verdade, a conversa é "otimizar ou subir o teto de propósito", que é
 * exatamente a decisão que um orçamento existe para forçar.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

const LIMITES = [
  { arquivo: 'index.html', maxKB: 300, nota: 'HTML+CSS+JS inline, o que bloqueia a primeira pintura' },
  { arquivo: 'teia-conect.mp4', maxKB: 1600, nota: 'vídeo do hero no desktop' },
  { arquivo: 'teia-conect-mobile.mp4', maxKB: 400, nota: 'vídeo do hero no celular' },
  { arquivo: 'og-image-v2.jpg', maxKB: 120, nota: 'imagem de compartilhamento' },
];

// Teto do que o visitante pode baixar na primeira visita do desktop, somando o
// HTML e tudo que a página puxa sozinha. Imagem com loading="lazy" fica fora.
const TETO_PRIMEIRA_VISITA_KB = 1900;

const kb = (p) => Math.round(fs.statSync(p).size / 1024);

let falhou = false;
const linhas = [];

for (const { arquivo, maxKB, nota } of LIMITES) {
  const alvo = path.join(RAIZ, arquivo);
  if (!fs.existsSync(alvo)) {
    linhas.push(`  ?  ${arquivo.padEnd(28)} não encontrado (limite ${maxKB} KB)`);
    continue;
  }
  const tamanho = kb(alvo);
  const ok = tamanho <= maxKB;
  if (!ok) falhou = true;
  const folga = maxKB - tamanho;
  linhas.push(
    `  ${ok ? 'ok' : 'XX'} ${arquivo.padEnd(28)} ${String(tamanho).padStart(5)} KB / ${String(maxKB).padStart(5)} KB` +
      `  ${ok ? `(folga ${folga} KB)` : `ESTOUROU ${-folga} KB`}   ${nota}`
  );
}

const primeiraVisita =
  kb(path.join(RAIZ, 'index.html')) + kb(path.join(RAIZ, 'teia-conect.mp4'));
const okTotal = primeiraVisita <= TETO_PRIMEIRA_VISITA_KB;
if (!okTotal) falhou = true;

console.log('\nORÇAMENTO DE PESO\n');
console.log(linhas.join('\n'));
console.log(
  `\n  ${okTotal ? 'ok' : 'XX'} primeira visita (desktop)   ${String(primeiraVisita).padStart(5)} KB / ${TETO_PRIMEIRA_VISITA_KB} KB\n`
);

if (falhou) {
  console.error(
    'Orçamento estourado. Ou otimize o arquivo, ou suba o limite em scripts/budget.js\n' +
      'de propósito, explicando no commit por que o site passou a pesar mais.\n'
  );
  process.exit(1);
}
console.log('Dentro do orçamento.\n');
