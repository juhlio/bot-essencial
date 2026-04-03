const KVA_LABELS = {
  1: 'Até 50 kVA',
  2: 'De 50 a 100 kVA',
  3: 'De 100 a 200 kVA',
  4: 'De 200 a 300 kVA',
  5: 'Acima de 300 kVA',
  6: 'Não sei / Preciso de dimensionamento',
};

const CONTRACT_LABELS = {
  1: 'Stand-by',
  2: 'Prime/Contínua',
  3: 'Longo Prazo',
  4: 'Outro/Sob Demanda',
};

function buildInterestLine(session) {
  const { segment, qualificationData } = session;

  if (segment === 'venda') {
    const kva = KVA_LABELS[qualificationData.kvaRange] || 'Não informado';
    return `🔹 *Interesse:* Compra de Gerador — ${kva}`;
  }

  if (segment === 'locacao') {
    const contract = CONTRACT_LABELS[qualificationData.contractType] || 'Não informado';
    return `🔹 *Interesse:* Locação de Gerador — ${contract}`;
  }

  if (segment === 'manutencao') {
    const brand = qualificationData.equipmentBrand || 'Não informado';
    const model = qualificationData.equipmentModel || 'Não informado';
    return `🔹 *Interesse:* Manutenção de Equipamento — ${brand} ${model}`;
  }

  return `🔹 *Interesse:* Não informado`;
}

const messages = {
  // ─── SAUDAÇÃO ───────────────────────────────────────────────────────────────
  greeting:
    'Olá! Bem-vindo(a) à *Essencial Energia*. ⚡ Somos especialistas em geradores de energia com atuação nacional desde 2006. Posso ajudá-lo(a) com informações sobre nossos serviços.\n\nPara começar, por favor me diga: *qual é o seu nome completo?*',

  // ─── IDENTIFICAÇÃO ──────────────────────────────────────────────────────────
  askDocument: (name) =>
    `Obrigado, *${name}*! Para que possamos atendê-lo(a) da melhor forma, precisamos de algumas informações.\n\nPor favor, informe o seu *CNPJ ou CPF*:`,

  documentFoundCNPJ: (company) =>
    `Perfeito! Localizei o CNPJ vinculado à empresa *${company}*. ✅\n\nAgora, por favor informe seu *e-mail corporativo*:`,

  documentOk:
    'Documento validado! ✅\n\nAgora, por favor informe seu *e-mail*:',

  askPhone:
    'E um *telefone para contato* (com DDD):',

  // ─── SEGMENTAÇÃO ────────────────────────────────────────────────────────────
  askSegment: (name) =>
    `Ótimo, *${name}*! 😊 Como podemos ajudá-lo(a) hoje?\n\n1️⃣ Compra de Gerador\n2️⃣ Locação de Gerador\n3️⃣ Manutenção de Equipamento\n\nDigite o *número* da opção desejada:`,

  // ─── VENDA ──────────────────────────────────────────────────────────────────
  askKva:
    'Qual a *faixa de potência* do gerador que você precisa?\n\n1️⃣ Até 50 kVA\n2️⃣ De 50 a 100 kVA\n3️⃣ De 100 a 200 kVA\n4️⃣ De 200 a 300 kVA\n5️⃣ Acima de 300 kVA\n6️⃣ Não sei / Preciso de dimensionamento\n\nDigite o *número* da opção desejada:',

  // ─── LOCAÇÃO ────────────────────────────────────────────────────────────────
  askContract:
    'Qual o *tipo de contrato* que melhor atende à sua necessidade?\n\n1️⃣ Stand-by (emergência/backup)\n2️⃣ Prime/Contínua (uso intensivo)\n3️⃣ Longo Prazo (contrato fixo)\n4️⃣ Outro/Sob Demanda\n\nDigite o *número* da opção desejada:',

  // ─── MANUTENÇÃO ─────────────────────────────────────────────────────────────
  askBrand:
    'Qual a *marca* do equipamento que precisa de manutenção?\n\n_(Ex: Cummins, Stemac, Weg, Caterpillar...)_',

  askModel:
    'E qual o *modelo* do equipamento? Se não souber, digite *"não sei"*.',

  // ─── FORA DO ICP ────────────────────────────────────────────────────────────
  outOfIcp: (name) =>
    `${name}, agradecemos o seu contato! 😊\n\nNo momento, a *Essencial Energia* atua com geradores a partir de *50 kVA*, voltados para aplicações industriais e comerciais de médio e grande porte.\n\nInfelizmente, não conseguiríamos atendê-lo(a) adequadamente nessa faixa.\n\nGostaria de receber nossos *conteúdos e novidades* por aqui?\n\n1️⃣ Sim, quero receber\n2️⃣ Não, obrigado(a)`,

  outOfIcpOptIn:
    'Ótimo! ✅ Seu contato foi cadastrado em nossa lista. Sempre que tivermos novidades relevantes, entraremos em contato.\n\nCaso precise de suporte urgente, nosso plantão está disponível 24h: *0800 779 9009*.\n\nTenha um excelente dia! ⚡',

  outOfIcpOptOut:
    'Sem problemas! Foi um prazer falar com você. 😊\n\nCaso precise de suporte ou mude de ideia, estamos à disposição. Plantão 24h: *0800 779 9009*.\n\nTenha um excelente dia! ⚡',

  // ─── ENCERRAMENTO ───────────────────────────────────────────────────────────
  closing: (session) => {
    const team = session.segment === 'manutencao' ? 'técnica' : 'comercial';
    const interestLine = buildInterestLine(session);
    const companyLine = session.companyName
      ? `\n✅ *Empresa:* ${session.companyName}`
      : '';

    return (
      `Perfeito! ✅ Suas informações foram registradas com sucesso.\n\n` +
      `*Resumo do atendimento:*\n` +
      `✅ *Nome:* ${session.name}` +
      companyLine +
      `\n✅ *E-mail:* ${session.email}` +
      `\n✅ *Telefone:* ${session.phone}` +
      `\n${interestLine}\n\n` +
      `Nossa equipe *${team}* entrará em contato em até *24 horas úteis*.\n\n` +
      `Plantão 24h: *0800 779 9009*\n\n` +
      `Obrigado por entrar em contato com a *Essencial Energia*! ⚡`
    );
  },

  // ─── ERROS ──────────────────────────────────────────────────────────────────
  invalidDocument:
    'Não consegui validar esse documento. Por favor, verifique e informe novamente seu *CPF* (11 dígitos) ou *CNPJ* (14 dígitos):',

  invalidEmail:
    'O e-mail informado não parece válido. Por favor, informe um *e-mail* no formato _usuario@dominio.com_:',

  invalidPhone:
    'O telefone informado não parece válido. Por favor, informe o número *com DDD* (10 ou 11 dígitos):',

  invalidOption:
    'Opção inválida. Por favor, digite o *número* correspondente a uma das opções listadas:',

  invalidName:
    'Não consegui identificar um nome válido. Por favor, informe seu *nome completo*:',

  reminder:
    'Ainda está aí? 😊 Pode continuar quando quiser — estou aqui para ajudá-lo(a).',

  timeout:
    'Parece que você se ausentou. Esta conversa foi encerrada por inatividade.\n\nQuando quiser retomar, é só enviar uma mensagem. Plantão 24h: *0800 779 9009*. ⚡',

  maxErrors:
    'Estou com dificuldade em processar as informações fornecidas. Por favor, entre em contato com nossa equipe diretamente:\n\n📞 *0800 779 9009* (24h)\n\nPedimos desculpas pelo transtorno.',

  restart:
    'Sem problemas! Vamos recomeçar do início. 😊',
};

module.exports = { messages, KVA_LABELS, CONTRACT_LABELS, buildInterestLine };
