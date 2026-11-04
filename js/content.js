// Conteúdo padrão da página + definição dos campos editáveis no painel + regras de preço.
// O que estiver salvo no Supabase sobrescreve estes valores.
(function () {
  const DEFAULTS = {
    eyebrow: "Salas para atendimento · Vianelo, Jundiaí",
    hero_titulo: "Atenda seus pacientes numa casa feita para o *cuidado*.",
    hero_texto: "A Clínica Morada do Ser abre suas salas nos horários vagos para psicólogos, terapeutas e profissionais da saúde. Você aluga a hora que precisa e encontra um consultório pronto, discreto e acolhedor.",
    hero_foto: "",
    destaques: [
      { titulo: "+30 anos", texto: "de psicologia em Jundiaí" },
      { titulo: "Por hora", texto: "das 8h às 21h, e sábado até 15h" },
      { titulo: "Até 41%", texto: "de desconto no período de 4h" }
    ],
    publico_titulo: "Consultórios para quem atende com hora marcada",
    publico_texto: "As salas foram pensadas para sessões individuais, de casal ou família, avaliações e consultas. Ideal para quem está começando o consultório próprio ou precisa de um segundo endereço em Jundiaí.",
    publico_lista: ["Psicólogos", "Psiquiatras", "Neuropsicólogos", "Psicopedagogos", "Terapeutas de casal e família", "Fonoaudiólogos", "Nutricionistas", "Terapeutas ocupacionais"],
    salas_titulo: "Nossas salas",
    salas_texto: "Escolha a sala, veja os horários livres e faça sua pré-reserva.",
    estrutura_titulo: "Chegue, atenda e vá embora tranquilo",
    estrutura_texto: "Você divide a estrutura de uma clínica de psicologia em funcionamento, com o sigilo e o silêncio que o atendimento pede.",
    estrutura_itens: [
      { titulo: "Privacidade e sigilo", texto: "Salas adequadas para atendimentos de qualquer faixa etária, com a discrição que a sessão pede." },
      { titulo: "Recepção ampla", texto: "Seus pacientes aguardam num espaço confortável, com área de coworking." },
      { titulo: "Espaço do profissional", texto: "Área de descanso com câmera da sala de espera, Wi‑Fi, geladeira e micro-ondas." },
      { titulo: "Banheiro privativo", texto: "Banheiro exclusivo para os profissionais." },
      { titulo: "Térreo e piso superior", texto: "Salas nos dois andares, com opções no térreo para quem precisa de acessibilidade." }
    ],
    passos: [
      { titulo: "Escolha a sala", texto: "Veja as fotos e o que cada sala oferece." },
      { titulo: "Escolha o plano e os horários", texto: "Hora avulsa, horas antecipadas do mês ou período de 4h. Só aparecem os horários livres." },
      { titulo: "A clínica confirma", texto: "Sua pré-reserva segura o horário e a clínica confirma pelo WhatsApp em até 2 horas, no horário de funcionamento." },
      { titulo: "Atenda e acerte", texto: "Hora avulsa e período são pagos no dia; horas antecipadas, até o dia 05 do mês." }
    ],
    regras: [
      "A desmarcação precisa ser feita com 24 horas de antecedência. Do contrário, a sala é cobrada.",
      "Em caso de atraso do paciente ou do profissional, o horário agendado precisa ser respeitado.",
      "Material lúdico e materiais para o atendimento são de responsabilidade do profissional.",
      "Horas antecipadas: mínimo de 4 horas no mês, acertadas até o dia 05. Dá para marcar os horários na hora ou comprar as horas e marcar depois (banco de horas, em Minha conta). Horas não usadas não passam para o mês seguinte, e horários extras são cobrados como hora avulsa."
    ],
    // Horário de funcionamento: [abre, fecha] por dia; null = fechado
    horarios: { "Seg": [8, 21], "Ter": [8, 21], "Qua": [8, 21], "Qui": [8, 21], "Sex": [8, 21], "Sáb": [8, 15], "Dom": null },
    periodos: [{ nome: "Manhã", ini: 8, fim: 12 }, { nome: "Tarde", ini: 13, fim: 17 }, { nome: "Noite", ini: 17, fim: 21 }],
    // Preços (R$)
    preco_avulso: 38,          // por hora, pago no dia do atendimento
    preco_meia_hora: 19,       // meia hora avulsa (só no plano Hora avulsa); sem valor salvo, vale preco_avulso / 2
    preco_antecipada: 28,      // por hora, mínimo antecipadas_min horas no mesmo mês, acerto até o dia 05
    antecipadas_min: 4,
    preco_periodo_bloco: 90,   // por período (manhã, tarde ou noite)
    // Desconto progressivo por plano: % sobre o total da reserva, pela quantidade de horários
    // (no período, quantidade de períodos) na MESMA pré-reserva.
    descontos: {
      avulso:  { ativo: false, faixas: [{ qtd: 3, pct: 5 }, { qtd: 6, pct: 10 }] },
      pacote:  { ativo: false, faixas: [{ qtd: 3, pct: 5 }, { qtd: 6, pct: 10 }] },
      periodo: { ativo: true,  faixas: [{ qtd: 3, pct: 5 }, { qtd: 6, pct: 10 }] }
    },
    pix_chave: "08174363000155",
    pix_nome: "Clinica Morada do Ser",
    pix_cidade: "Jundiaí",
    pagamento_texto: "Pague por Pix (CNPJ 08.174.363/0001-55, Clínica de Psicologia Morada do Ser Ltda) ou combine pelo WhatsApp. Depois de pagar, envie o comprovante com o código da reserva.",
    whatsapp: "5511953063868",
    telefone: "(11) 95306-3868",
    email: "clinica.moradadoser@gmail.com",
    email_avisos: "",
    endereco: "Rua Adolfo Torricelli, 284",
    bairro_cidade: "Vianelo, Jundiaí · SP",
    rodape: "Clínica Morada do Ser · Há mais de 30 anos, psicologia voltada para o desenvolvimento do humano."
  };

  const SAMPLE_ROOMS = [
    { id: "exemplo-1", name: "Sala 1", description: "Exemplo: descreva aqui a sala pelo painel.", features: ["Poltronas", "Ar-condicionado"], photos: [] },
    { id: "exemplo-2", name: "Sala 2", description: "Exemplo: descreva aqui a sala pelo painel.", features: ["Divã", "Mesa de apoio"], photos: [] }
  ];

  // Campos da aba "Textos" do painel.
  // tipos: text, textarea, image, list, pairs, number, money, hours, periods
  const FIELDS = [
    { group: "Topo da página", fields: [
      { key: "eyebrow", label: "Frase pequena acima do título", type: "text" },
      { key: "hero_titulo", label: "Título principal", type: "text", hint: "Coloque uma palavra entre *asteriscos* para ela aparecer em itálico rosé." },
      { key: "hero_texto", label: "Texto de apresentação", type: "textarea" },
      { key: "hero_foto", label: "Foto do topo", type: "image" },
      { key: "destaques", label: "Destaques (até 3)", type: "pairs", max: 3 }
    ]},
    { group: "Planos e preços", fields: [
      { key: "preco_avulso", label: "Hora avulsa (R$ por hora, paga no dia)", type: "money" },
      { key: "preco_meia_hora", label: "Meia hora avulsa (R$ por 30 min, paga no dia)", type: "money", hint: "Só a hora avulsa aceita meia hora. Numa faixa contínua, cada hora cheia sai pelo valor da hora e a meia hora que sobrar, por este valor." },
      { key: "preco_antecipada", label: "Horas antecipadas (R$ por hora)", type: "money" },
      { key: "antecipadas_min", label: "Horas antecipadas: mínimo de horas no mês", type: "number", min: 1, max: 100 },
      { key: "preco_periodo_bloco", label: "Período de 4h (R$ por período)", type: "money" },
      { key: "descontos", label: "Desconto progressivo por quantidade de horários", type: "descontos", hint: "Desconto sobre o total da reserva, pela quantidade de horários (no período, de períodos) na mesma pré-reserva." },
      { key: "regras", label: "Regras de uso (uma por linha)", type: "list" }
    ]},
    { group: "Pagamento", fields: [
      { key: "pix_chave", label: "Chave Pix", type: "text", hint: "Gera o QR Code com o valor já preenchido. Celular no formato +5511999999999; CPF/CNPJ só números; ou e-mail ou chave aleatória." },
      { key: "pix_nome", label: "Nome do recebedor do Pix (até 25 letras)", type: "text" },
      { key: "pix_cidade", label: "Cidade do recebedor", type: "text" },
      { key: "pagamento_texto", label: "Instruções de pagamento", type: "textarea" }
    ]},
    { group: "Horário de funcionamento", fields: [
      { key: "horarios", label: "Dias e horários", type: "hours" },
      { key: "periodos", label: "Períodos (um por linha, ex.: Manhã 8-12)", type: "periods" }
    ]},
    { group: "Para quem é", fields: [
      { key: "publico_titulo", label: "Título", type: "text" },
      { key: "publico_texto", label: "Texto", type: "textarea" },
      { key: "publico_lista", label: "Profissões (uma por linha)", type: "list" }
    ]},
    { group: "Salas", fields: [
      { key: "salas_titulo", label: "Título da seção de salas", type: "text" },
      { key: "salas_texto", label: "Texto da seção de salas", type: "textarea" }
    ]},
    { group: "Estrutura da clínica", fields: [
      { key: "estrutura_titulo", label: "Título", type: "text" },
      { key: "estrutura_texto", label: "Texto", type: "textarea" },
      { key: "estrutura_itens", label: "Itens", type: "pairs" }
    ]},
    { group: "Como funciona", fields: [
      { key: "passos", label: "Passos (na ordem)", type: "pairs" }
    ]},
    { group: "Contato", fields: [
      { key: "whatsapp", label: "WhatsApp (só números, com 55 e DDD)", type: "text" },
      { key: "telefone", label: "Telefone como aparece na página", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "email_avisos", label: "E-mail que recebe o aviso de cada nova pré-reserva", type: "text", hint: "Se ficar vazio, o aviso vai para o e-mail acima." },
      { key: "endereco", label: "Endereço", type: "text" },
      { key: "bairro_cidade", label: "Bairro e cidade", type: "text" },
      { key: "rodape", label: "Texto do rodapé", type: "text" }
    ]}
  ];

  const ALL_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const DOW_NAME = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]; // índice = Date.getDay()
  const DOW_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  // ---------- preços e planos ----------
  const money = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const pct = (rate, base) => base > 0 ? Math.round((1 - rate / base) * 100) : 0;
  const semanalRate = (C, h) => C.preco_avulso; // planos fixos saíram; mantido por compatibilidade

  // Meia hora avulsa: preco_meia_hora, ou metade da hora se não houver valor válido
  function precoMeia(C) {
    const v = C.preco_meia_hora;
    return v !== null && v !== undefined && v !== "" && isFinite(Number(v)) ? Number(v) : Number(C.preco_avulso || 0) / 2;
  }
  // Valor da hora avulsa por faixa contínua: horas cheias × hora + (sobrou meia hora ? meia hora : 0)
  // faixas: [[10, 11.5], [14, 14.5]] (use ranges() para juntar as meias horas)
  function avulsoDetalhe(C, faixas) {
    let cheias = 0, meias = 0;
    faixas.forEach(([a, b]) => { const d = Number(b) - Number(a), h = Math.floor(d + 1e-9); cheias += h; if (d - h > 1e-9) meias++; });
    return { cheias, meias, total: cheias * Number(C.preco_avulso || 0) + meias * precoMeia(C) };
  }

  function plans(C) {
    const per = (C.periodos || []).map(p => `${p.nome} ${p.ini}h–${p.fim}h`).join(" · ");
    const perHora = C.preco_periodo_bloco / 4;
    return [
      { id: "avulso", nome: "Hora avulsa", preco: `${money(C.preco_avulso)}/h`, desc: `De 30 em 30 minutos (meia hora sai ${money(precoMeia(C))}), sem compromisso. Pago no dia do atendimento.`, off: 0, desconto: descontoBadge(C, "avulso") },
      { id: "pacote", nome: "Horas antecipadas", preco: `${money(C.preco_antecipada)}/h`, desc: `Mínimo de ${C.antecipadas_min} horas no mês: escolha os horários agora ou compre as horas e marque depois. Acerto até o dia 05; horas não usadas não acumulam.`, off: pct(C.preco_antecipada, C.preco_avulso), desconto: descontoBadge(C, "pacote") },
      { id: "periodo", nome: "Período de 4h", preco: money(C.preco_periodo_bloco), desc: `Um turno inteiro (sai a ${money(perHora)}/h): ${per}. Pago no dia.`, off: pct(perHora, C.preco_avulso), desconto: descontoBadge(C, "periodo") }
    ];
  }

  // ---------- desconto progressivo ----------
  // faixas ativas do plano, ordenadas pela quantidade
  function descontoFaixas(C, plano) {
    const d = (C.descontos || {})[plano];
    return d && d.ativo ? (d.faixas || []).slice().sort((a, b) => a.qtd - b.qtd) : [];
  }
  // % da maior faixa atingida com qtd horários (0 se o desconto estiver desativado)
  function descontoPct(C, plano, qtd) {
    let p = 0;
    descontoFaixas(C, plano).forEach(f => { if (qtd >= f.qtd && f.pct > p) p = f.pct; });
    return p;
  }
  // próxima faixa ainda não alcançada: { falta, pct } ou null
  function descontoProx(C, plano, qtd) {
    const atual = descontoPct(C, plano, qtd);
    const prox = descontoFaixas(C, plano).find(f => f.qtd > qtd && f.pct > atual);
    return prox ? { falta: prox.qtd - qtd, pct: prox.pct } : null;
  }
  // selo para a vitrine de planos, ex.: "Leve 3, ganhe 5% · 6+ 10%"
  function descontoBadge(C, plano) {
    const faixas = descontoFaixas(C, plano);
    if (!faixas.length) return "";
    return faixas.map((f, i) => i === 0 ? `Leve ${f.qtd}, ganhe ${f.pct}%` : `${f.qtd}+ ${f.pct}%`).join(" · ");
  }

  // Vencimento das horas antecipadas: dia 05 do mês (ou o dia da compra, se o banco de horas for comprado depois do dia 05)
  function vencimento(r) {
    if (r.plano !== "pacote" || r.usa_banco_de) return null;
    const ref = r.mes_referencia || (r.reservation_slots || r.slots || []).map(s => s.data).sort()[0];
    if (!ref) return null;
    const [y, m] = ref.split("-").map(Number);
    let due = new Date(y, m - 1, 5, 23, 59);
    if (r.horas_compradas && r.created_at) {
      const c = new Date(r.created_at), fim = new Date(c.getFullYear(), c.getMonth(), c.getDate(), 23, 59);
      if (fim > due) due = fim;
    }
    return due;
  }
  // Quando pagar cada plano
  function dueText(r) {
    if (r.plano === "pacote") {
      if (r.usa_banco_de) return "já pago no banco de horas";
      const due = vencimento(r);
      if (!due) return "até o dia 05 do mês";
      const dd = `${pad(due.getDate())}/${pad(due.getMonth() + 1)}`;
      return due < new Date() ? `o quanto antes (venceu ${dd})` : `até ${dd}`;
    }
    return "no dia do atendimento";
  }
  const MESES_N = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  // "2026-11-01" -> "novembro de 2026"
  const mesNome = iso => { const [y, m] = String(iso).split("-").map(Number); return `${MESES_N[m - 1]} de ${y}`; };
  // compra de banco de horas (sem horários) e horário marcado com o saldo
  const isCompraBanco = r => r.plano === "pacote" && r.horas_compradas != null;
  const isUsoBanco = r => !!r.usa_banco_de;
  const paidOf = r => (r.payments || []).reduce((s, p) => s + Number(p.valor || 0), 0);
  const dueOf = r => Math.max(0, Math.round((Number(r.total || 0) - paidOf(r)) * 100) / 100);

  // ---------- datas (sempre no horário local) ----------
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
  const br = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

  // ---------- Supabase ----------
  const cfg = window.MORADA_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const client = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  function photoUrl(path) {
    if (!path) return "";
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    if (!client) return "";
    return client.storage.from(cfg.BUCKET || "fotos").getPublicUrl(path).data.publicUrl;
  }

  async function loadContent() {
    const content = structuredClone(DEFAULTS);
    if (!client) return content;
    const { data, error } = await client.from("site_content").select("key,value");
    if (error) throw error;
    (data || []).forEach(r => { content[r.key] = r.value; });
    // sem preço da meia hora salvo: metade da hora avulsa salva
    if (!(data || []).some(r => r.key === "preco_meia_hora")) content.preco_meia_hora = Number(content.preco_avulso || 0) / 2;
    return content;
  }

  async function loadRooms({ includeInactive = false } = {}) {
    if (!client) return structuredClone(SAMPLE_ROOMS);
    let q = client.from("rooms").select("id,name,description,features,sort,active,room_photos(id,path,sort)").order("sort").order("created_at");
    if (!includeInactive) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => ({ ...r, photos: (r.room_photos || []).sort((a, b) => a.sort - b.sort) }));
  }

  // Horas ocupadas: { "2026-11-10": Set([14,15]) }
  async function loadOccupied(roomId, from, to) {
    const map = {};
    if (!client) return map;
    const { data, error } = await client.rpc("occupied_slots2", { p_room: roomId, p_from: iso(from), p_to: iso(to) });
    if (error) throw error;
    (data || []).forEach(o => { const s = (map[o.data] ||= new Set()); for (let h = Number(o.hora_ini); h < Number(o.hora_fim); h += 0.5) s.add(h); });
    return map;
  }

  // Junta meias horas seguidas em faixas: [14,14.5,17] -> [[14,15],[17,17.5]]
  function ranges(hours) {
    const hs = [...hours].map(Number).sort((a, b) => a - b), out = [];
    hs.forEach(h => { const last = out[out.length - 1]; if (last && last[1] === h) last[1] = h + 0.5; else out.push([h, h + 0.5]); });
    return out;
  }
  // 14 -> "14h", 14.5 -> "14h30"
  const hh = h => { h = Number(h); const H = Math.floor(h), m = Math.round((h - H) * 60); return m ? `${H}h${pad(m)}` : `${H}h`; };
  // duração: 1.5 -> "1h30", 0.5 -> "30 min"
  const dur = h => { h = Number(h); const H = Math.floor(h), m = Math.round((h - H) * 60); return H ? (m ? `${H}h${pad(m)}` : `${H}h`) : `${m} min`; };

  // ---------- CPF ----------
  const onlyDigits = v => String(v || "").replace(/\D/g, "");
  function cpfValid(v) {
    const d = onlyDigits(v);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const calc = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === +d[9] && calc(10) === +d[10];
  }
  const cpfFormat = v => onlyDigits(v).slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  const fullName = v => String(v || "").trim().split(/\s+/).length >= 2;
  const emailValid = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim());
  // máscara automática em qualquer input[data-cpf]
  document.addEventListener("input", e => { if (e.target.matches?.("input[data-cpf]")) e.target.value = cpfFormat(e.target.value); });

  // ---------- Pix (BR Code estático com valor) ----------
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }
  function pixPayload({ chave, nome, cidade, valor, txid }) {
    const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").toUpperCase().trim();
    const f = (id, v) => id + String(v.length).padStart(2, "0") + v;
    let k = String(chave || "").trim();
    if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(k)) k = "+55" + onlyDigits(k);
    const p = f("00", "01") + f("26", f("00", "br.gov.bcb.pix") + f("01", k)) + f("52", "0000") + f("53", "986")
      + (valor > 0 ? f("54", Number(valor).toFixed(2)) : "") + f("58", "BR")
      + f("59", norm(nome).slice(0, 25) || "RECEBEDOR") + f("60", norm(cidade).slice(0, 15) || "JUNDIAI")
      + f("62", f("05", String(txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***")) + "6304";
    return p + crc16(p);
  }

  // ---------- contas ----------
  async function getUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.user || null;
  }
  async function getProfile() {
    const u = await getUser(); if (!u) return null;
    const { data } = await client.from("profiles").select("*").eq("id", u.id).maybeSingle();
    return { ...(data || {}), id: u.id, email: u.email };
  }
  const STATUS_CLIENTE = { pendente: "Aguardando confirmação", confirmada: "Confirmada", recusada: "Recusada", cancelada: "Cancelada", expirada: "Expirada" };
  // a pré-reserva segura o horário até a clínica confirmar ou recusar (não expira sozinha)
  function statusOf(r) { return r.status; }
  const expiresAt = (r, C) => new Date(new Date(r.created_at).getTime() + Number(C?.prazo_pagamento_horas || 24) * 3600e3);
  const fmtDateTime = d => d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  // Link "Entrar / Minha conta" no topo das páginas públicas
  async function paintAccountLinks(session) {
    const els = document.querySelectorAll("[data-account]"); if (!els.length) return;
    const u = session !== undefined ? session?.user : await getUser().catch(() => null);
    els.forEach(a => { a.href = "conta.html"; a.textContent = u ? "Minha conta" : "Entrar"; });
  }
  // Importante: nunca chamar o Supabase direto dentro do onAuthStateChange (trava todas as consultas).
  if (client) client.auth.onAuthStateChange((_e, session) => setTimeout(() => paintAccountLinks(session || null), 0));
  document.addEventListener("DOMContentLoaded", () => paintAccountLinks());

  window.Morada = {
    DEFAULTS, FIELDS, ALL_DAYS, DOW_NAME, DOW_LONG, client, configured, cfg,
    photoUrl, loadContent, loadRooms, loadOccupied,
    money, pct, plans, precoMeia, avulsoDetalhe, semanalRate, dueText, vencimento, mesNome, isCompraBanco, isUsoBanco, MESES: MESES_N, paidOf, dueOf, ranges, hh, dur, iso, parse, addDays, monday, br, pad,
    descontoFaixas, descontoPct, descontoProx, descontoBadge,
    pixPayload, cpfValid, cpfFormat, fullName, emailValid, onlyDigits,
    getUser, getProfile, statusOf, expiresAt, fmtDateTime, STATUS_CLIENTE, paintAccountLinks
  };
})();
