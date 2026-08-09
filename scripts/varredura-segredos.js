#!/usr/bin/env node
/**
 * Varredura de segredo antes do merge.
 *
 * O risco aqui é concreto e não hipotético: a função `api/lead.js` usa a
 * `service_role` do Supabase, que ignora RLS e dá acesso total ao banco. Ela
 * vive em variável de ambiente na Vercel, como deve ser. Este script existe
 * para o dia em que alguém colar o valor "só pra testar" e esquecer.
 *
 * Confere também o `index.html`, que é servido cru: qualquer chave escrita lá
 * dentro está pública no instante do deploy.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

const IGNORAR = new Set(['node_modules', '.git', '.vercel', 'test-results', 'playwright-report']);
const EXTENSOES = new Set(['.html', '.js', '.json', '.mjs', '.cjs', '.md', '.txt', '.yml', '.yaml']);

const PADROES = [
  { nome: 'JWT do Supabase (anon/service_role)', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { nome: 'chave de API do Google', re: /AIza[0-9A-Za-z_-]{35}/ },
  { nome: 'token da Meta/Facebook', re: /EAA[A-Za-z0-9]{60,}/ },
  { nome: 'chave da OpenAI', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { nome: 'chave da Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: 'token da Vercel', re: /\bvercel_[A-Za-z0-9]{20,}/ },
  { nome: 'chave privada', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { nome: 'senha em string de conexão', re: /(postgres|postgresql|mysql|mongodb):\/\/[^\s:@]+:[^\s:@]+@/ },
  // Atribuição direta de segredo, e não a LEITURA de process.env, que é o certo
  { nome: 'segredo atribuído no código', re: /(SERVICE_KEY|SECRET|PASSWORD|SENHA|TOKEN)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/ },
];

function listar(dir) {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const cheio = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...listar(cheio));
    else if (EXTENSOES.has(path.extname(item.name).toLowerCase())) saida.push(cheio);
  }
  return saida;
}

const achados = [];
for (const arquivo of listar(RAIZ)) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const linhas = texto.split('\n');
  for (const { nome, re } of PADROES) {
    linhas.forEach((linha, i) => {
      if (re.test(linha)) {
        achados.push({
          arquivo: path.relative(RAIZ, arquivo),
          linha: i + 1,
          tipo: nome,
          trecho: linha.trim().slice(0, 90),
        });
      }
    });
  }
}

console.log('\nVARREDURA DE SEGREDOS\n');
if (!achados.length) {
  console.log('  Nenhum segredo encontrado no código.\n');
  process.exit(0);
}

for (const a of achados) {
  console.error(`  ${a.arquivo}:${a.linha}  ${a.tipo}`);
  console.error(`     ${a.trecho}\n`);
}
console.error(
  `${achados.length} possível(is) segredo(s) no código.\n` +
    'Se for falso positivo, ajuste o padrão em scripts/varredura-segredos.js.\n' +
    'Se for real: REVOGUE a chave antes de qualquer outra coisa. Tirar do\n' +
    'commit não basta, o histórico do Git guarda.\n'
);
process.exit(1);
