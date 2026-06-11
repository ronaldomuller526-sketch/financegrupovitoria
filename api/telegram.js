const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_CONTAS_PAGAR = 'eb3d81d0-87ba-42ec-84fa-dbbfad4f64bf';

const pendingConfirm = {};

function sendTelegram(chatId, text, extra = {}) {
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(opts);
  req.write(body);
  req.end();
}

function answerCallback(callbackQueryId, text = '') {
  const body = JSON.stringify({ callback_query_id: callbackQueryId, text });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(opts);
  req.write(body);
  req.end();
}

function notionPost(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'api.notion.com',
      path: `/v1/${path}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function criarBoleto(dados, conta) {
  const [empresa, descricao, valor, vencimento, categoria] = dados;
  const valorNum = parseFloat(valor.replace(',', '.'));
  const [dia, mes, ano] = vencimento.split('/');
  const dataISO = `${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;

  await notionPost(`pages`, {
    parent: { database_id: DB_CONTAS_PAGAR },
    properties: {
      'Descrição': { title: [{ text: { content: descricao.trim() } }] },
      'Empresa': { select: { name: empresa.trim() } },
      'Valor': { number: valorNum },
      'Vencimento': { date: { start: dataISO } },
      'Status': { select: { name: 'Pendente' } },
      'Tipo': { select: { name: 'Boleto' } },
      'Categoria': { select: { name: categoria.trim() } },
      'Conta Pagamento': { select: { name: conta } }
    }
  });
}

module.exports = async (req, res) => {
  res.status(200).end();

  const update = req.body;
  if (!update) return;

  // Callback query (botão inline)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;
    answerCallback(cb.id);

    if (data === 'cancelar') {
      delete pendingConfirm[chatId];
      return sendTelegram(chatId, '❌ Lançamento cancelado.');
    }

    if (data === 'confirmar') {
      const pending = pendingConfirm[chatId];
      if (!pending) return sendTelegram(chatId, '⚠️ Nenhum boleto pendente.');
      pendingConfirm[chatId] = { ...pending, aguardandoConta: true };
      return sendTelegram(chatId, '💳 Qual conta de pagamento?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Muller's Ton", callback_data: 'conta:Muller\'s Ton' }],
            [{ text: "Muller's Cora", callback_data: 'conta:Muller\'s Cora' }],
            [{ text: 'Vitória Ton', callback_data: 'conta:Vitória Ton' }]
          ]
        }
      });
    }

    if (data.startsWith('conta:')) {
      const conta = data.replace('conta:', '');
      const pending = pendingConfirm[chatId];
      if (!pending) return sendTelegram(chatId, '⚠️ Nenhum boleto pendente.');
      try {
        await criarBoleto(pending.dados, conta);
        delete pendingConfirm[chatId];
        sendTelegram(chatId, `✅ Boleto lançado com sucesso!\n\n📋 <b>${pending.dados[1]}</b>\n💰 R$ ${pending.dados[2]}\n📅 ${pending.dados[3]}\n🏦 ${conta}`);
      } catch (e) {
        sendTelegram(chatId, `❌ Erro ao lançar: ${e.message}`);
      }
      return;
    }
    return;
  }

  // Mensagem de texto
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text === '/start') {
    return sendTelegram(chatId, `👋 <b>Bot Grupo Vitória</b>\n\nPara lançar um boleto, envie:\n<code>empresa | descrição | valor | vencimento | categoria</code>\n\nExemplo:\n<code>Vitória Atacadista | Fatura Shopee | 1500,00 | 20/06/2025 | Outros</code>\n\n<b>Empresas:</b> Muller's Importados / Vitória Atacadista\n<b>Categorias:</b> Fornecedor, Aluguel, Imposto, Folha, ADS, Frete, Assinatura, Outros...`);
  }

  if (text.includes('|')) {
    const partes = text.split('|').map(p => p.trim());
    if (partes.length < 5) {
      return sendTelegram(chatId, '⚠️ Formato inválido. Use:\n<code>empresa | descrição | valor | vencimento | categoria</code>');
    }
    const [empresa, descricao, valor, vencimento, categoria] = partes;
    pendingConfirm[chatId] = { dados: partes };

    return sendTelegram(chatId,
      `📋 Confirmar lançamento?\n\n🏢 <b>Empresa:</b> ${empresa}\n📝 <b>Descrição:</b> ${descricao}\n💰 <b>Valor:</b> R$ ${valor}\n📅 <b>Vencimento:</b> ${vencimento}\n🏷️ <b>Categoria:</b> ${categoria}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirmar', callback_data: 'confirmar' },
            { text: '❌ Cancelar', callback_data: 'cancelar' }
          ]]
        }
      }
    );
  }

  sendTelegram(chatId, '💡 Envie /start para ver as instruções.');
};
