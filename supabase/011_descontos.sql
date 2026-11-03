-- Morada do Ser · Desconto progressivo por plano (rode depois do 010)
--  · desconto sobre o total da reserva, pela quantidade de horários (no período, de períodos)
--    na mesma pré-reserva, configurável pelo painel (site_content, key "descontos")
alter table public.reservations add column if not exists desconto_pct numeric(5,2) not null default 0;

create or replace function public.desconto_pct(p_plano text, p_qtd int) returns numeric
language sql stable security definer set search_path = public as $$
  with d as (
    select public.conf_json('descontos',
      '{"avulso":{"ativo":false,"faixas":[{"qtd":3,"pct":5},{"qtd":6,"pct":10}]},
        "pacote":{"ativo":false,"faixas":[{"qtd":3,"pct":5},{"qtd":6,"pct":10}]},
        "periodo":{"ativo":true,"faixas":[{"qtd":3,"pct":5},{"qtd":6,"pct":10}]}}'::jsonb
    ) -> p_plano as cfg
  )
  select coalesce((
    select max((f->>'pct')::numeric)
    from d, jsonb_array_elements(coalesce(d.cfg->'faixas', '[]'::jsonb)) f
    where coalesce((d.cfg->>'ativo')::boolean, false) and p_qtd >= (f->>'qtd')::int
  ), 0)
$$;

-- Mesma request_reservation do 010_meia_hora.sql, com o desconto aplicado sobre v_total
create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0; hrs numeric := 0; v_total numeric; v_desc numeric; v_mes date;
  v_room  uuid := (p->>'room_id')::uuid;
  v_uid   uuid := auth.uid();
  v_plano text := coalesce(p->>'plano', '');
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_max   date := (now() at time zone 'America/Sao_Paulo')::date + 92;   -- até ~13 semanas à frente
  v_cpf   text := regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g');
  v_tel   text := regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g');
  v_d date; v_ini numeric; v_fim numeric; v_freq text; v_email text; v_pcpf text; v_h int[];
  v_forma text := coalesce(nullif(p->>'forma', ''), 'pix');
begin
  if not exists (select 1 from public.rooms where id = v_room and active) then
    raise exception 'Esta sala não está disponível para reserva.';
  end if;
  if array_length(regexp_split_to_array(trim(coalesce(p->>'nome', '')), '\s+'), 1) < 2 then
    raise exception 'Informe seu nome completo.';
  end if;
  if length(v_tel) not between 10 and 13 then
    raise exception 'Informe um telefone de contato com DDD.';
  end if;
  if v_plano not in ('avulso','pacote','periodo') then
    raise exception 'Plano inválido.';
  end if;
  if v_forma not in ('pix','link') then
    raise exception 'Escolha como vai pagar: Pix ou link de pagamento.';
  end if;
  if coalesce(p->>'aceite', '') <> 'true' then
    raise exception 'Para reservar, é preciso aceitar as regras de uso.';
  end if;

  v_email := left(coalesce(p->>'email', ''), 120);
  if v_uid is not null then
    select u.email, coalesce(pr.cpf, '') into v_email, v_pcpf
    from auth.users u left join public.profiles pr on pr.id = u.id where u.id = v_uid;
    if v_pcpf <> '' then v_cpf := v_pcpf; end if;   -- cliente logado usa sempre o CPF da conta
  end if;
  if not public.cpf_valido(v_cpf) then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  if coalesce(v_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;

  -- Limites contra abuso
  if (select count(*) from public.reservations r
      where r.status = 'pendente' and r.plano <> 'bloqueio'
        and r.created_at > now() - interval '30 days'
        and (r.cpf = v_cpf
             or right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = right(v_tel, 8)
             or (v_uid is not null and r.user_id = v_uid))) >= 3 then
    raise exception 'Você já tem 3 pré-reservas aguardando a confirmação da clínica. Aguarde a confirmação ou cancele uma delas antes de fazer outra, ou fale com a clínica pelo WhatsApp.';
  end if;
  if (select count(*) from public.reservations r
      where r.aceite_em is not null and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Recebemos muitas reservas agora. Tente de novo daqui a pouco ou fale com a clínica pelo WhatsApp.';
  end if;

  -- Uma reserva por vez em cada sala (evita duas pessoas pegarem o mesmo horário juntas)
  perform pg_advisory_xact_lock(hashtext('sala:' || v_room::text));

  insert into public.reservations (room_id, user_id, plano, nome, telefone, email, cpf, profissao, registro, obs, total, resumo, aceite_em, forma_escolhida)
  values (v_room, v_uid, v_plano, left(trim(p->>'nome'), 120), left(p->>'telefone', 30), coalesce(v_email, ''), v_cpf,
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          null, left(coalesce(p->>'resumo', ''), 3000), now(), v_forma)
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    n := n + 1;
    if n > 60 then raise exception 'Horários demais numa reserva só.'; end if;
    begin
      v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::numeric; v_fim := (s->>'hora_fim')::numeric; v_freq := s->>'freq';
    exception when others then raise exception 'Horário inválido.';
    end;
    if v_d is null or v_ini is null or v_fim is null or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
    if v_ini * 2 <> trunc(v_ini * 2) or v_fim * 2 <> trunc(v_fim * 2) then raise exception 'Os horários são de 30 em 30 minutos.'; end if;
    if v_freq is distinct from (case v_plano when 'semanal' then 'semanal' when 'quinzenal' then 'quinzenal' else 'unica' end) then
      raise exception 'Horário inválido para este plano.';
    end if;
    if v_d < v_today or (v_d = v_today and v_ini <= extract(hour from v_now) + extract(minute from v_now) / 60.0) then
      raise exception 'Não dá para reservar um horário que já passou.';
    end if;
    if v_d > v_max then raise exception 'Dá para reservar com até 3 meses de antecedência.'; end if;
    v_h := public.horario_do_dia(v_d);
    if v_h is null or v_ini < v_h[1] or v_fim > v_h[2] then
      raise exception 'Um dos horários está fora do horário de funcionamento da clínica.';
    end if;
    if v_plano = 'periodo' and not public.periodo_valido(v_ini, v_fim) then
      raise exception 'Escolha um dos períodos da clínica.';
    end if;
    if v_plano = 'pacote' then
      if v_mes is null then v_mes := date_trunc('month', v_d)::date;
      elsif date_trunc('month', v_d)::date <> v_mes then
        raise exception 'As horas antecipadas precisam ser todas no mesmo mês.';
      end if;
    end if;
    if public.has_conflict(v_room, v_freq, v_d, v_ini, v_fim, null) then
      raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize a página e escolha outro.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, v_freq, v_d, v_ini, v_fim);
    hrs := hrs + (v_fim - v_ini);
  end loop;

  -- Preço calculado aqui, com os valores do painel
  if n = 0 then raise exception 'Escolha pelo menos um horário.'; end if;
  if v_plano = 'pacote' and hrs < public.conf_num('antecipadas_min', 4) then
    raise exception 'As horas antecipadas são de no mínimo % horas no mês.', public.conf_num('antecipadas_min', 4);
  end if;
  v_total := case v_plano
    when 'avulso'  then hrs * public.conf_num('preco_avulso', 38)
    when 'pacote'  then hrs * public.conf_num('preco_antecipada', 28)
    when 'periodo' then n * public.conf_num('preco_periodo_bloco', 90)
  end;
  -- Desconto progressivo pela quantidade de horários (n), configurado no painel
  v_desc := public.desconto_pct(v_plano, n);
  if v_desc > 0 then v_total := v_total * (1 - v_desc / 100); end if;
  v_total := round(v_total, 2);
  update public.reservations set total = v_total, desconto_pct = v_desc where id = rid;

  -- completa o perfil do cliente logado com o que ele digitou
  if v_uid is not null then
    update public.profiles set
      nome = case when nome = '' then left(trim(p->>'nome'), 120) else nome end,
      telefone = case when telefone = '' then left(p->>'telefone', 30) else telefone end,
      profissao = case when profissao = '' then left(coalesce(p->>'profissao', ''), 80) else profissao end,
      registro = case when registro = '' then left(coalesce(p->>'registro', ''), 40) else registro end,
      cpf = case when cpf = '' and not exists (select 1 from public.profiles x where x.cpf = v_cpf) then v_cpf else cpf end,
      updated_at = now()
    where id = v_uid;
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod, 'total', v_total, 'desconto_pct', v_desc);
end $$;

revoke all on function public.desconto_pct(text, int) from public, anon, authenticated;
revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
