/**
 * POST /api/lead — recebe o formulário de diagnóstico do site da Conect+.
 *
 * Destinos do lead, cada um ligado por variável de ambiente na Vercel:
 *   1. E-mail (Resend): aviso na caixa de entrada a cada envio.
 *   2. Banco (Supabase): histórico consultável.
 * Pode ligar um, outro ou os dois. Com os dois, basta um dar certo pra o
 * envio contar como gravado. Sem nenhum, o endpoint responde 501 de propósito
 * e o front-end cai no WhatsApp com os dados já preenchidos.
 *
 * Para ligar o e-mail, defina na Vercel:
 *   RESEND_API_KEY   chave da conta Resend (marcar como Sensitive)
 *   LEAD_EMAIL_PARA  quem recebe o aviso. Sem domínio verificado no Resend,
 *                    só entrega no e-mail DONO da conta Resend.
 *   LEAD_EMAIL_DE    opcional. Padrão "Site Conect+ <onboarding@resend.dev>";
 *                    com o conectpluss.com verificado no Resend, trocar por
 *                    algo como "Site Conect+ <site@conectpluss.com>".
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
 *     investe     text,  -- legado: o site nao envia mais, coluna aceita null
 *     origem      text,
 *     user_agent  text
 *   );
 */

const CAMPOS = ['nome', 'whatsapp', 'email', 'segmento'];

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

// O e-mail é HTML montado com texto que o visitante digitou: sem escapar, um
// nome como "<a href=...>" viraria link clicável dentro da caixa de entrada.
function esc(valor) {
  return String(valor).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function avisaPorEmail(lead, origem) {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const zap = `https://wa.me/55${lead.whatsapp}`;
  const fone = lead.whatsapp.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  const linha = (rotulo, valor) =>
    `<tr><td style="padding:8px 16px 8px 0;color:#5b6479;white-space:nowrap">${rotulo}</td><td style="padding:8px 0;color:#021950;font-weight:600">${valor}</td></tr>`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#021950">
  <p style="margin:0 0 4px;font-size:13px;color:#0043DF;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Novo pedido de orçamento</p>
  <h1 style="margin:0 0 20px;font-size:22px">${esc(lead.nome)}</h1>
  <table style="border-collapse:collapse;font-size:15px">
    ${linha('WhatsApp', `<a href="${zap}" style="color:#0043DF">${esc(fone)}</a>`)}
    ${linha('E-mail', `<a href="mailto:${esc(lead.email)}" style="color:#0043DF">${esc(lead.email)}</a>`)}
    ${linha('Segmento', esc(lead.segmento))}
    ${linha('Recebido', esc(quando))}
    ${linha('Página', esc(origem))}
  </table>
  <p style="margin:24px 0 0"><a href="${zap}" style="display:inline-block;background:#0043DF;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Chamar no WhatsApp</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#8a92a6">Enviado pelo formulário do conectpluss.com. Responder este e-mail responde direto pro lead.</p>
</div>`;

  const texto = `Novo pedido de orçamento\n\nNome: ${lead.nome}\nWhatsApp: ${fone} (${zap})\nE-mail: ${lead.email}\nSegmento: ${lead.segmento}\nRecebido: ${quando}\nPágina: ${origem}`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: process.env.LEAD_EMAIL_DE || 'Site Conect+ <onboarding@resend.dev>',
      to: process.env.LEAD_EMAIL_PARA.split(',').map((s) => s.trim()).filter(Boolean),
      reply_to: lead.email,
      subject: `Novo lead no site: ${lead.nome} (${lead.segmento})`,
      html,
      text: texto
    })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function gravaNoBanco(lead, origem, userAgent) {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_KEY;
  const tabela = process.env.SUPABASE_TABELA || 'leads_site';
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify([{ ...lead, origem, user_agent: userAgent }])
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
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
    segmento: limpa(corpo.segmento, 60)
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

  const temEmail = Boolean(process.env.RESEND_API_KEY && process.env.LEAD_EMAIL_PARA);
  const temBanco = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

  // Ainda sem destino configurado: o front-end cai no WhatsApp com os dados.
  if (!temEmail && !temBanco) {
    return res.status(501).json({ erro: 'Destino do lead ainda não configurado' });
  }

  const origem = limpa(req.headers.referer || 'site', 200);
  const tarefas = [];
  if (temEmail) tarefas.push(avisaPorEmail(lead, origem));
  if (temBanco) tarefas.push(gravaNoBanco(lead, origem, limpa(req.headers['user-agent'], 300)));

  // Os destinos rodam juntos e um não derruba o outro. Se TODOS falharem, 502:
  // o front-end abre o WhatsApp com os dados e o lead não se perde.
  const resultados = await Promise.allSettled(tarefas);
  resultados.filter((r) => r.status === 'rejected').forEach((r) => console.error('Destino do lead falhou:', r.reason));
  if (!resultados.some((r) => r.status === 'fulfilled')) {
    return res.status(502).json({ erro: 'Não foi possível gravar o lead' });
  }
  return res.status(200).json({ ok: true });
}
