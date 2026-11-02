// Conteúdo padrão da página + definição dos campos editáveis no painel.
// O que estiver salvo no Supabase sobrescreve estes valores.
(function () {
  const DEFAULTS = {
    eyebrow: "Salas para atendimento · Vianelo, Jundiaí",
    hero_titulo: "Atenda seus pacientes numa casa feita para o *cuidado*.",
    hero_texto: "A Clínica Morada do Ser abre suas salas nos horários vagos para psicólogos, terapeutas e profissionais da saúde. Você aluga a hora que precisa e encontra um consultório pronto, discreto e acolhedor.",
    hero_foto: "",
    destaques: [
      { titulo: "+30 anos", texto: "de psicologia em Jundiaí" },
      { titulo: "Por hora", texto: "das 8h às 18h" },
      { titulo: "Sob medida", texto: "valores conforme suas horas" }
    ],
    publico_titulo: "Consultórios para quem atende com hora marcada",
    publico_texto: "As salas foram pensadas para sessões individuais, de casal ou família, avaliações e consultas. Ideal para quem está começando o consultório próprio ou precisa de um segundo endereço em Jundiaí.",
    publico_lista: ["Psicólogos", "Psiquiatras", "Neuropsicólogos", "Psicopedagogos", "Terapeutas de casal e família", "Fonoaudiólogos", "Nutricionistas", "Terapeutas ocupacionais"],
    salas_titulo: "Nossas salas",
    salas_texto: "Escolha o espaço que combina com o seu atendimento.",
    estrutura_titulo: "Chegue, atenda e vá embora tranquilo",
    estrutura_texto: "Você divide a estrutura de uma clínica de psicologia em funcionamento, com o sigilo e o silêncio que o atendimento pede.",
    estrutura_itens: [
      { titulo: "Sala de espera", texto: "Seu paciente aguarda num espaço confortável até a hora da sessão." },
      { titulo: "Privacidade", texto: "Ambiente reservado para conversas que precisam ficar dentro da sala." },
      { titulo: "Wi‑Fi", texto: "Internet para prontuário eletrônico, agenda e atendimentos online." },
      { titulo: "Limpeza inclusa", texto: "Salas organizadas e higienizadas entre os atendimentos." }
    ],
    passos: [
      { titulo: "Escolha os horários", texto: "Marque abaixo a sala, os dias e as horas em que você quer atender." },
      { titulo: "Receba os valores", texto: "Respondemos pelo WhatsApp com a disponibilidade e as condições." },
      { titulo: "Visite a sala", texto: "Agende uma visita para conhecer o espaço antes de fechar." },
      { titulo: "Comece a atender", texto: "Combinado o horário, a sala fica reservada para você toda semana." }
    ],
    hora_inicio: 8,
    hora_fim: 18,
    dias: ["Seg", "Ter", "Qua", "Qui", "Sex"],
    whatsapp: "5511953063868",
    telefone: "(11) 95306-3868",
    email: "clinica.moradadoser@gmail.com",
    endereco: "Rua Adolfo Torricelli, 284",
    bairro_cidade: "Vianelo, Jundiaí · SP",
    rodape: "Clínica Morada do Ser · Há mais de 30 anos, psicologia voltada para o desenvolvimento do humano."
  };

  // Salas de exemplo, usadas só enquanto o Supabase não estiver configurado.
  const SAMPLE_ROOMS = [
    { id: "exemplo-1", name: "Sala 1", description: "Exemplo: descreva aqui a sala pelo painel.", features: ["Poltronas", "Ar-condicionado"], photos: [] },
    { id: "exemplo-2", name: "Sala 2", description: "Exemplo: descreva aqui a sala pelo painel.", features: ["Divã", "Mesa de apoio"], photos: [] }
  ];

  // Campos mostrados na aba "Textos" do painel, em grupos.
  // tipos: text, textarea, image, list (um por linha), pairs (título + texto), number, days
  const FIELDS = [
    { group: "Topo da página", fields: [
      { key: "eyebrow", label: "Frase pequena acima do título", type: "text" },
      { key: "hero_titulo", label: "Título principal", type: "text", hint: "Coloque uma palavra entre *asteriscos* para ela aparecer em itálico rosé." },
      { key: "hero_texto", label: "Texto de apresentação", type: "textarea" },
      { key: "hero_foto", label: "Foto do topo", type: "image" },
      { key: "destaques", label: "Destaques (até 3)", type: "pairs", max: 3 }
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
    { group: "Horários", fields: [
      { key: "hora_inicio", label: "Primeiro horário (hora)", type: "number", min: 0, max: 23 },
      { key: "hora_fim", label: "Fim do último horário (hora)", type: "number", min: 1, max: 24 },
      { key: "dias", label: "Dias de funcionamento", type: "days" }
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

  window.Morada = { DEFAULTS, FIELDS, ALL_DAYS, client, configured, photoUrl, loadContent, loadRooms, cfg };
})();
