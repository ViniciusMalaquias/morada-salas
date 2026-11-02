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
      { titulo: "Até 29%", texto: "de desconto nos planos fixos" }
    ],
    publico_titulo: "Consultórios para quem atende com hora marcada",
    publico_texto: "As salas foram pensadas para sessões individuais, de casal ou família, avaliações e consultas. Ideal para quem está começando o consultório próprio ou precisa de um segundo endereço em Jundiaí.",
    publico_lista: ["Psicólogos", "Psiquiatras", "Neuropsicólogos", "Psicopedagogos", "Terapeutas de casal e família", "Fonoaudiólogos", "Nutricionistas", "Terapeutas ocupacionais"],
    salas_titulo: "Nossas salas",
    salas_texto: "Escolha a sala, veja os horários livres e faça sua pré-reserva.",
    estrutura_titulo: "Chegue, atenda e vá embora tranquilo",
    estrutura_texto: "Você divide a estrutura de uma clínica de psicologia em funcionamento, com o sigilo e o silêncio que o atendimento pede.",
    estrutura_itens: [
      { titulo: "Sala de espera", texto: "Seu paciente aguarda num espaço confortável até a hora da sessão." },
      { titulo: "Privacidade", texto: "Ambiente reservado para conversas que precisam ficar dentro da sala." },
      { titulo: "Wi‑Fi", texto: "Internet para prontuário eletrônico, agenda e atendimentos online." },
      { titulo: "Limpeza inclusa", texto: "Salas organizadas e higienizadas entre os atendimentos." }
    ],
    passos: [
      { titulo: "Escolha a sala", texto: "Veja as fotos e o que cada sala oferece." },
      { titulo: "Escolha o plano e os horários", texto: "Hora avulsa, período ou horário fixo. Só aparecem os horários livres." },
      { titulo: "A clínica confirma", texto: "Sua pré-reserva segura o horário e a clínica confirma pelo WhatsApp." },
      { titulo: "Comece a atender", texto: "Com a reserva confirmada, a sala é sua no horário combinado." }
    ],
    regras: [
      "Cancelamento sem custo com até 24 horas de antecedência. Depois disso, a hora é cobrada.",
      "Quem tem horário fixo pode remarcar uma hora por mês.",
      "Planos mensais são pagos antecipadamente, até o dia 5."
    ],
    // Horário de funcionamento: [abre, fecha] por dia; null = fechado
    horarios: { "Seg": [8, 21], "Ter": [8, 21], "Qua": [8, 21], "Qui": [8, 21], "Sex": [8, 21], "Sáb": [8, 15], "Dom": null },
    periodos: [{ nome: "Manhã", ini: 8, fim: 12 }, { nome: "Tarde", ini: 14, fim: 18 }, { nome: "Noite", ini: 18, fim: 21 }],
    // Preços (R$)
    preco_avulso: 45,
    pacote_horas: 10,
    pacote_preco: 400,
    pacote_validade: 60,
    preco_periodo: 37.5,
    preco_quinzenal: 40,
    semanal_1: 38,
    semanal_4: 35,
    semanal_8: 32,
    whatsapp: "5511953063868",
    telefone: "(11) 95306-3868",
    email: "clinica.moradadoser@gmail.com",
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
      { key: "preco_avulso", label: "Hora avulsa (R$ por hora)", type: "money" },
      { key: "pacote_horas", label: "Pacote: quantidade de horas", type: "number", min: 1, max: 100 },
      { key: "pacote_preco", label: "Pacote: preço total (R$)", type: "money" },
      { key: "pacote_validade", label: "Pacote: prazo para usar (dias)", type: "number", min: 1, max: 365 },
      { key: "preco_periodo", label: "Período (R$ por hora)", type: "money" },
      { key: "preco_quinzenal", label: "Fixo quinzenal (R$ por hora)", type: "money" },
      { key: "semanal_1", label: "Fixo semanal, 1 a 3h por semana (R$ por hora)", type: "money" },
      { key: "semanal_4", label: "Fixo semanal, 4 a 7h por semana (R$ por hora)", type: "money" },
      { key: "semanal_8", label: "Fixo semanal, 8h ou mais por semana (R$ por hora)", type: "money" },
      { key: "regras", label: "Regras de uso (uma por linha)", type: "list" }
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
  const semanalRate = (C, h) => h >= 8 ? C.semanal_8 : h >= 4 ? C.semanal_4 : C.semanal_1;

  function plans(C) {
    const per = (C.periodos || []).map(p => `${p.nome} ${p.ini}h–${p.fim}h`).join(" · ");
    const pacoteHora = C.pacote_preco / C.pacote_horas;
    return [
      { id: "avulso", nome: "Hora avulsa", preco: `${money(C.preco_avulso)}/h`, desc: "Para quando precisar, sem compromisso.", off: 0 },
      { id: "pacote", nome: `Pacote ${C.pacote_horas}h`, preco: money(C.pacote_preco), desc: `Sai a ${money(pacoteHora)}/h. Horas pagas antes, para usar em até ${C.pacote_validade} dias.`, off: pct(pacoteHora, C.preco_avulso) },
      { id: "periodo", nome: "Período", preco: `${money(C.preco_periodo)}/h`, desc: `Um turno inteiro: ${per}.`, off: pct(C.preco_periodo, C.preco_avulso) },
      { id: "quinzenal", nome: "Fixo quinzenal", preco: `${money(C.preco_quinzenal)}/h`, desc: "O mesmo horário a cada 15 dias, cobrado por mês.", off: pct(C.preco_quinzenal, C.preco_avulso) },
      { id: "semanal", nome: "Fixo semanal", preco: `a partir de ${money(C.semanal_8)}/h`, desc: `O mesmo horário toda semana, cobrado por mês. 1 a 3h por semana: ${money(C.semanal_1)}/h · 4 a 7h: ${money(C.semanal_4)}/h · 8h ou mais: ${money(C.semanal_8)}/h.`, off: pct(C.semanal_8, C.preco_avulso) }
    ];
  }

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
    const { data, error } = await client.rpc("occupied_slots", { p_room: roomId, p_from: iso(from), p_to: iso(to) });
    if (error) throw error;
    (data || []).forEach(o => { const s = (map[o.data] ||= new Set()); for (let h = o.hora_ini; h < o.hora_fim; h++) s.add(h); });
    return map;
  }

  // Junta horas seguidas em faixas: [14,15,17] -> [[14,16],[17,18]]
  function ranges(hours) {
    const hs = [...hours].map(Number).sort((a, b) => a - b), out = [];
    hs.forEach(h => { const last = out[out.length - 1]; if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]); });
    return out;
  }

  window.Morada = {
    DEFAULTS, FIELDS, ALL_DAYS, DOW_NAME, DOW_LONG, client, configured, cfg,
    photoUrl, loadContent, loadRooms, loadOccupied,
    money, pct, plans, semanalRate, ranges, iso, parse, addDays, monday, br, pad
  };
})();
