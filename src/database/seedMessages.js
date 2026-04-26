require('dotenv').config();
const logger = require('../utils/logger');

// -----------------------------------------------------------------------------
// Seed data — espelha os textos de src/utils/messages.js
// A mensagem "closing" é desmembrada em closing_header + closing_footer;
// o resumo dinâmico intermediário continua sendo montado em código.
// -----------------------------------------------------------------------------
const SEED_MESSAGES = [
  // ─── SAUDAÇÃO ─────────────────────────────────────────────
  {
    key: 'greeting',
    category: 'saudacao',
    label: 'Boas-vindas',
    content: 'Olá! Bem-vindo(a) à *Essencial Energia*. ⚡ Somos especialistas em geradores de energia com atuação nacional desde 2006. Posso ajudá-lo(a) com informações sobre nossos serviços.\n\nPara começar, por favor me diga: *qual é o seu nome completo?*',
    variables: [],
    is_dynamic: false,
    description: 'Primeira mensagem enviada ao lead quando inicia uma conversa.',
  },

  // ─── IDENTIFICAÇÃO ────────────────────────────────────────
  {
    key: 'askDocument',
    category: 'identificacao',
    label: 'Solicitar CPF/CNPJ',
    content: 'Obrigado, *{{name}}*! Para que possamos atendê-lo(a) da melhor forma, precisamos de algumas informações.\n\nPor favor, informe o seu *CNPJ ou CPF*:',
    variables: ['name'],
    is_dynamic: true,
    description: 'Enviada após o lead informar o nome. Variável {{name}} é substituída pelo nome do lead.',
  },
  {
    key: 'documentFoundCNPJ',
    category: 'identificacao',
    label: 'CNPJ encontrado',
    content: 'Perfeito! Localizei o CNPJ vinculado à empresa *{{company}}*. ✅\n\nAgora, por favor informe seu *e-mail corporativo*:',
    variables: ['company'],
    is_dynamic: true,
    description: 'Enviada quando o CNPJ é validado com sucesso na BrasilAPI.',
  },
  {
    key: 'documentOk',
    category: 'identificacao',
    label: 'Documento validado',
    content: 'Documento validado! ✅\n\nAgora, por favor informe seu *e-mail*:',
    variables: [],
    is_dynamic: false,
    description: 'Enviada quando CPF é validado ou CNPJ não é encontrado na BrasilAPI.',
  },
  {
    key: 'askPhone',
    category: 'identificacao',
    label: 'Solicitar telefone',
    content: 'E um *telefone para contato* (com DDD):',
    variables: [],
    is_dynamic: false,
    description: 'Solicita número de telefone com DDD.',
  },

  // ─── SEGMENTAÇÃO ──────────────────────────────────────────
  {
    key: 'askSegment',
    category: 'segmentacao',
    label: 'Escolha de segmento',
    content: 'Ótimo, *{{name}}*! Como podemos ajudá-lo(a) hoje?\n\n*1.* Compra de Gerador\n*2.* Locação de Gerador\n*3.* Manutenção de Equipamento\n\nDigite o *número* da opção desejada:',
    variables: ['name'],
    is_dynamic: true,
    description: 'Menu principal de segmentação. Variável {{name}} é o nome do lead.',
  },

  // ─── LOCALIZAÇÃO ─────────────────────────────────────────
  {
    key: 'askLocationVenda',
    category: 'localizacao',
    label: 'Localização para Venda',
    content: 'Ótimo! Para qual cidade/estado será o projeto?',
    variables: ['name'],
    is_dynamic: true,
    description: 'Pergunta localização quando lead escolhe segmento Venda.',
  },
  {
    key: 'askLocationLocacao',
    category: 'localizacao',
    label: 'Localização para Locação',
    content: 'Perfeito! Para qual cidade/estado você precisa do gerador?',
    variables: ['name'],
    is_dynamic: true,
    description: 'Pergunta localização quando lead escolhe segmento Locação.',
  },
  {
    key: 'askLocationManutencao',
    category: 'localizacao',
    label: 'Localização para Manutenção',
    content: 'Certo! Em qual cidade/estado está o equipamento?',
    variables: ['name'],
    is_dynamic: true,
    description: 'Pergunta localização quando lead escolhe segmento Manutenção.',
  },

  // ─── QUALIFICAÇÃO: VENDA ──────────────────────────────────
  {
    key: 'askKva',
    category: 'qualificacao_venda',
    label: 'Faixa de kVA',
    content: 'Para direcioná-lo(a) ao consultor mais adequado, qual a *faixa de potência* desejada?\n\n*1.* Até 50 kVA\n*2.* De 50 a 100 kVA\n*3.* De 100 a 200 kVA\n*4.* De 200 a 300 kVA\n*5.* Acima de 300 kVA\n*6.* Não sei / Preciso de dimensionamento\n\nDigite o *número* da opção:',
    variables: [],
    is_dynamic: false,
    description: 'Seleção de faixa de potência para compra de gerador.',
  },

  // ─── QUALIFICAÇÃO: LOCAÇÃO ────────────────────────────────
  {
    key: 'askContract',
    category: 'qualificacao_locacao',
    label: 'Tipo de contrato',
    content: 'Que tipo de *contrato de locação* você procura?\n\n*1.* Stand-by\n*2.* Prime / Contínua\n*3.* Longo Prazo\n*4.* Outro / Sob Demanda\n\nDigite o *número* da opção:',
    variables: [],
    is_dynamic: false,
    description: 'Seleção do tipo de contrato de locação.',
  },

  // ─── QUALIFICAÇÃO: MANUTENÇÃO ─────────────────────────────
  {
    key: 'askBrand',
    category: 'qualificacao_manutencao',
    label: 'Marca do equipamento',
    content: 'Para agilizar o atendimento técnico, informe a *marca* do seu gerador:',
    variables: [],
    is_dynamic: false,
    description: 'Solicita marca do equipamento para manutenção.',
  },
  {
    key: 'askModel',
    category: 'qualificacao_manutencao',
    label: 'Modelo do equipamento',
    content: 'E o *modelo* do equipamento:',
    variables: [],
    is_dynamic: false,
    description: 'Solicita modelo do equipamento para manutenção.',
  },

  // ─── FORA DO ICP ──────────────────────────────────────────
  {
    key: 'outOfIcp',
    category: 'fora_icp',
    label: 'Lead fora do perfil',
    content: '{{name}}, agradecemos seu interesse! 😊\n\nAtualmente, a Essencial Energia atua com geradores a partir de *50 kVA*. Para demandas menores, recomendamos consultar revendedores locais.\n\nGostaria de receber *novidades e conteúdos* sobre energia e geradores?\n\n*1.* Sim, quero me cadastrar\n*2.* Não, obrigado(a)',
    variables: ['name'],
    is_dynamic: true,
    description: 'Enviada quando o lead seleciona gerador < 50 kVA (fora do ICP).',
  },
  {
    key: 'outOfIcpOptIn',
    category: 'fora_icp',
    label: 'Opt-in newsletter confirmado',
    content: 'Pronto! Você foi cadastrado(a) em nossa lista de novidades. 📩\n\nObrigado pelo interesse na *Essencial Energia*! Plantão 24h: *0800 779 9009*. ⚡',
    variables: [],
    is_dynamic: false,
    description: 'Confirmação de cadastro na newsletter.',
  },
  {
    key: 'outOfIcpOptOut',
    category: 'fora_icp',
    label: 'Opt-out newsletter',
    content: 'Sem problemas! Foi um prazer falar com você. 😊\n\nCaso precise de suporte ou mude de ideia, estamos à disposição. Plantão 24h: *0800 779 9009*.\n\nTenha um excelente dia! ⚡',
    variables: [],
    is_dynamic: false,
    description: 'Lead opta por não receber newsletter.',
  },

  // ─── ENCERRAMENTO ─────────────────────────────────────────
  {
    key: 'closing_header',
    category: 'encerramento',
    label: 'Cabeçalho de encerramento',
    content: 'Perfeito! ✅ Suas informações foram registradas com sucesso.\n\n*Resumo do atendimento:*',
    variables: [],
    is_dynamic: false,
    description: 'Parte fixa do início da mensagem de encerramento (antes do resumo dinâmico).',
  },
  {
    key: 'closing_footer',
    category: 'encerramento',
    label: 'Rodapé de encerramento',
    content: 'Nossa equipe *{{team}}* entrará em contato em até *24 horas úteis*.\n\nPlantão 24h: *0800 779 9009*\n\nObrigado por entrar em contato com a *Essencial Energia*! ⚡',
    variables: ['team'],
    is_dynamic: true,
    description: 'Parte fixa do final da mensagem de encerramento. {{team}} = "comercial" ou "técnica".',
  },

  // ─── ERROS ────────────────────────────────────────────────
  {
    key: 'invalidDocument',
    category: 'erros',
    label: 'Documento inválido',
    content: 'Não consegui validar esse documento. Por favor, verifique e informe novamente seu *CPF* (11 dígitos) ou *CNPJ* (14 dígitos):',
    variables: [],
    is_dynamic: false,
    description: 'Exibida quando CPF ou CNPJ falha na validação.',
  },
  {
    key: 'invalidEmail',
    category: 'erros',
    label: 'E-mail inválido',
    content: 'O e-mail informado não parece válido. Por favor, informe um *e-mail* no formato _usuario@dominio.com_:',
    variables: [],
    is_dynamic: false,
    description: 'Exibida quando formato de e-mail é inválido.',
  },
  {
    key: 'invalidPhone',
    category: 'erros',
    label: 'Telefone inválido',
    content: 'O telefone informado não parece válido. Por favor, informe o número *com DDD* (10 ou 11 dígitos):',
    variables: [],
    is_dynamic: false,
    description: 'Exibida quando formato de telefone é inválido.',
  },
  {
    key: 'invalidOption',
    category: 'erros',
    label: 'Opção inválida',
    content: 'Opção inválida. Por favor, digite o *número* correspondente a uma das opções listadas:',
    variables: [],
    is_dynamic: false,
    description: 'Exibida quando o lead digita opção fora do range numérico.',
  },
  {
    key: 'invalidName',
    category: 'erros',
    label: 'Nome inválido',
    content: 'Não consegui identificar um nome válido. Por favor, informe seu *nome completo*:',
    variables: [],
    is_dynamic: false,
    description: 'Exibida quando nome tem menos de 3 caracteres.',
  },

  // ─── SISTEMA ──────────────────────────────────────────────
  {
    key: 'reminder',
    category: 'sistema',
    label: 'Lembrete de inatividade',
    content: 'Ainda está aí? 😊 Pode continuar quando quiser — estou aqui para ajudá-lo(a).',
    variables: [],
    is_dynamic: false,
    description: 'Enviada após BOT_REMINDER_TIMEOUT_MIN minutos de inatividade.',
  },
  {
    key: 'timeout',
    category: 'sistema',
    label: 'Encerramento por inatividade',
    content: 'Parece que você se ausentou. Esta conversa foi encerrada por inatividade.\n\nQuando quiser retomar, é só enviar uma mensagem. Plantão 24h: *0800 779 9009*. ⚡',
    variables: [],
    is_dynamic: false,
    description: 'Enviada após BOT_CLOSE_TIMEOUT_MIN minutos de inatividade total.',
  },
  {
    key: 'maxErrors',
    category: 'sistema',
    label: 'Limite de erros atingido',
    content: 'Estou com dificuldade em processar as informações fornecidas. Por favor, entre em contato com nossa equipe diretamente:\n\n📞 *0800 779 9009* (24h)\n\nPedimos desculpas pelo transtorno.',
    variables: [],
    is_dynamic: false,
    description: 'Enviada após 3 erros consecutivos no mesmo step.',
  },
  {
    key: 'restart',
    category: 'sistema',
    label: 'Reinício de conversa',
    content: 'Sem problemas! Vamos recomeçar do início. 😊',
    variables: [],
    is_dynamic: false,
    description: 'Enviada quando lead digita "reiniciar", "menu" ou similar.',
  },
];

// -----------------------------------------------------------------------------
// runSeed
// -----------------------------------------------------------------------------
async function runSeed() {
  if (!process.env.DATABASE_URL) {
    logger.warn('seedMessages: DATABASE_URL não definida — seed ignorado');
    return;
  }

  const { query, close } = require('../services/database');

  logger.info(`seedMessages: inserindo ${SEED_MESSAGES.length} templates...`);

  const text = `
    INSERT INTO message_templates
      (key, category, label, content, variables, is_dynamic, description)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (key) DO NOTHING
  `;

  let inserted = 0;
  let skipped = 0;

  for (const msg of SEED_MESSAGES) {
    const result = await query(text, [
      msg.key,
      msg.category,
      msg.label,
      msg.content,
      msg.variables,
      msg.is_dynamic,
      msg.description || null,
    ]);
    if (result.rowCount > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  logger.info(`seedMessages: ${inserted} inseridos, ${skipped} já existiam`);
  await close();
}

if (require.main === module) {
  runSeed().catch(err => {
    console.error('seedMessages error:', err.message);
    process.exit(1);
  });
}

module.exports = { runSeed, SEED_MESSAGES };
