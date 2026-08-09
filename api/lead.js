/**
 * POST /api/lead — recebe o formulário de diagnóstico do site da Conect+.
 *
 * Destino do lead: Supabase, configurado por variável de ambiente na Vercel.
 * Enquanto as variáveis não existirem, o endpoint responde 501 de propósito.
 * O front-end trata esse 501 abrindo o WhatsApp com os dados já preenchidos,
 * então nenhum lead se perde no período em que o banco ainda não está ligado.
 *
 * Para ligar o banco, defina na Vercel (marcar como Sensitive):
 *   SUPABASE_URL          https://<projeto>.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key (NUNCA expor no front-end)
 *   SUPABASE_TABELA       opcional, padrão "leads_site"
 *
 * Tabela esperada:
 *   create table leads_site (
 *     id          bigint generated always as identity primary key,
 *     criado_em   timestamptz not null default now(),
 *     nome        text not null,
 *     whatsapp    text not null,
 *     email       text not null,
 *     segmento    text,
 *     investe     text,
 *     origem      text,
 *     user_agent  text
 *   );
 */

const CAMPOS = ['nome', 'whatsapp', 'email', 'segmento', 'investe'];

/* ---------- Limite de requisição por IP ----------
 *
 * Endpoint público que grava no banco com a `service_role` (que ignora RLS).
 * Sem freio, um laço de `curl` enche a tabela de leads e queima a cota do
 * Supabase em minutos, e ninguém percebe até o relatório do mês.
 *
 * O contador vive na memória da instância. Isso NÃO é um limite global: a
 * Vercel pode ter várias instâncias vivas ao mesmo tempo, e uma instância fria
 * começa zerada. Ou seja, ele barra flood ingênuo, que é o caso real de um
 * formulário de site pequeno, e não um ataque distribuído.
 *
 * Se um dia virar alvo de verdade, o caminho é contador compartilhado (Upstash
 * Redis ou uma tabela no próprio Supabase com contagem por janela). Não fiz
 * agora de propósito: seria dependência nova para um problema que este site
 * ainda não tem.
 */
const JANELA_MS = 10 * 60 * 1000; // 10 minutos
const MAX_POR_JANELA = 5; // um humano não manda o formulário 5x em 10 min
const acessos = new Map();

function limitado(ip) {
  const agora = Date.now();

  // Faxina preguiçosa: sem isso o Map cresce para sempre numa instância que
  // fica viva por horas, e vira vazamento de memória lento.
  if (acessos.size > 5000) {
    for (const [chave, marcas] of acessos) {
      if (!marcas.some((t) => agora - t < JANELA_MS)) acessos.delete(chave);
    }
  }

  const recentes = (acessos.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  recentes.push(agora);
  acessos.set(ip, recentes);
  return recentes.length > MAX_POR_JANELA;
}

function ipDoPedido(req) {
  // Na Vercel o IP real vem no x-forwarded-for; o primeiro da lista é o cliente.
  const encaminhado = req.headers['x-forwarded-for'];
  if (typeof encaminhado === 'string' && encaminhado.length) {
    return encaminhado.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

function limpa(valor, max) {
  return String(valor == null ? '' : valor).trim().slice(0, max);
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  if (limitado(ipDoPedido(req))) {
    // 429 com Retry-After: o front trata como "tente de novo mais tarde" e o
    // visitante legítimo que clicou duas vezes não vê erro genérico.
    res.setHeader('Retry-After', String(Math.ceil(JANELA_MS / 1000)));
    return res.status(429).json({ erro: 'Muitos envios seguidos. Tente de novo em alguns minutos.' });
  }

  let corpo = req.body;
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo); } catch { corpo = null; }
  }
  if (!corpo || typeof corpo !== 'object') {
    return res.status(400).json({ erro: 'Corpo inválido' });
  }

  const lead = {
    nome: limpa(corpo.nome, 120),
    whatsapp: limpa(corpo.whatsapp, 20).replace(/\D/g, ''),
    email: limpa(corpo.email, 160).toLowerCase(),
    segmento: limpa(corpo.segmento, 60),
    investe: limpa(corpo.investe, 60)
  };

  const faltando = CAMPOS.filter((c) => !lead[c]);
  if (faltando.length) {
    return res.status(400).json({ erro: 'Campos obrigatórios ausentes', campos: faltando });
  }
  if (lead.whatsapp.length < 10 || lead.whatsapp.length > 11) {
    return res.status(400).json({ erro: 'WhatsApp inválido' });
  }
  if (!emailValido(lead.email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_KEY;
  const tabela = process.env.SUPABASE_TABELA || 'leads_site';

  // Ainda sem destino configurado: o front-end cai no WhatsApp com os dados.
  if (!url || !chave) {
    return res.status(501).json({ erro: 'Destino do lead ainda não configurado' });
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify([{
        ...lead,
        origem: limpa(req.headers.referer || 'site', 200),
        user_agent: limpa(req.headers['user-agent'], 300)
      }])
    });

    if (!r.ok) {
      const detalhe = await r.text();
      console.error('Supabase recusou o lead:', r.status, detalhe);
      return res.status(502).json({ erro: 'Não foi possível gravar o lead' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Falha ao gravar lead:', e);
    return res.status(502).json({ erro: 'Não foi possível gravar o lead' });
  }
}
