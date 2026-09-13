-- Execute no Supabase antes de publicar o modo extra.
-- Reutiliza get_challenge_by_code para excluir as perguntas já respondidas.
begin;
create table if not exists public.bonus_rounds (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  question text not null,
  options jsonb not null,
  correct_index integer not null,
  points integer not null,
  explanation text,
  expires_at timestamptz not null,
  answered_at timestamptz,
  result jsonb
);
create index if not exists bonus_rounds_player on public.bonus_rounds(player_id, challenge_id);
create unique index if not exists bonus_rounds_one_open on public.bonus_rounds(player_id) where answered_at is null;
alter table public.bonus_rounds enable row level security;
revoke all on public.bonus_rounds from public, anon, authenticated;

create or replace function public.start_bonus_round(player_uuid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_player public.players%rowtype;
  v_round public.bonus_rounds%rowtype;
  v_candidate record;
  v_question jsonb;
  v_eligible uuid[] := '{}';
begin
  select * into v_player from public.players where id = player_uuid for update;
  if not found or v_player.score < 1000 then
    raise exception 'O modo extra é liberado aos 1.000 pontos';
  end if;
  select * into v_round from public.bonus_rounds where player_id = player_uuid and answered_at is null;
  if v_round.id is not null then
    select to_jsonb(q) into v_question
      from public.challenges c
      cross join lateral public.get_challenge_by_code(c.code, player_uuid) q
      where c.id = v_round.challenge_id limit 1;
  end if;
  -- Descarta também rodadas antigas que reutilizavam perguntas da missão.
  if v_round.id is not null and (v_round.expires_at <= clock_timestamp()
    or coalesce((v_question->>'already_answered')::boolean, true)) then
    update public.bonus_rounds set answered_at = clock_timestamp(),
      result = jsonb_build_object('is_correct', false, 'points_earned', 0, 'timed_out', true)
      where id = v_round.id;
    v_round.id := null;
  end if;
  if v_round.id is null then
    for v_candidate in
      select c.id, c.code from public.challenges c
      where not exists (select 1 from public.bonus_rounds r
        where r.player_id = player_uuid and r.challenge_id = c.id)
    loop
      select to_jsonb(q) into v_question
        from public.get_challenge_by_code(v_candidate.code, player_uuid) q limit 1;
      if v_question is not null and (v_question->>'already_answered')::boolean = false then
        v_eligible := array_append(v_eligible, v_candidate.id);
      end if;
    end loop;
    if cardinality(v_eligible) = 0 then return null; end if;
    insert into public.bonus_rounds(player_id, challenge_id, question, options, correct_index, points, explanation, expires_at)
      select player_uuid, c.id, c.question, c.options, c.correct_index, c.points,
        to_jsonb(c)->>'explanation', clock_timestamp() + interval '15 seconds'
      from public.challenges c where c.id = any(v_eligible)
      order by random()
      limit 1 returning * into v_round;
  end if;
  return jsonb_build_object('round_id', v_round.id, 'challenge_id', v_round.challenge_id,
    'location_name', 'Modo extra · Pergunta sorteada', 'question', v_round.question,
    'options', v_round.options, 'points', v_round.points,
    'expires_at', v_round.expires_at, 'server_now', clock_timestamp());
end;
$$;

create or replace function public.submit_bonus_answer(player_uuid uuid, round_uuid uuid, selected_index integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round public.bonus_rounds%rowtype;
  v_player public.players%rowtype;
  v_correct boolean;
  v_expired boolean;
  v_points integer;
  v_result jsonb;
begin
  -- Mesma ordem de locks do sorteio; serializa envios e novas rodadas.
  select * into v_player from public.players where id = player_uuid for update;
  if not found or v_player.score < 1000 then raise exception 'Participação não habilitada'; end if;
  select * into v_round from public.bonus_rounds where id = round_uuid and player_id = player_uuid for update;
  if not found then raise exception 'Rodada não encontrada'; end if;
  if v_round.answered_at is not null then
    return v_round.result || jsonb_build_object('player', to_jsonb(v_player));
  end if;
  v_expired := clock_timestamp() >= v_round.expires_at;
  if not v_expired and selected_index is not null and
    (selected_index < 0 or selected_index >= jsonb_array_length(v_round.options)) then
    raise exception 'Alternativa inválida';
  end if;
  v_correct := not v_expired and coalesce(selected_index = v_round.correct_index, false);
  v_points := case when v_correct then v_round.points else 0 end;
  update public.players set score = score + v_points where id = player_uuid returning * into v_player;
  v_result := jsonb_build_object('is_correct', v_correct, 'points_earned', v_points,
    'timed_out', v_expired or selected_index is null, 'explanation', v_round.explanation);
  update public.bonus_rounds set answered_at = clock_timestamp(), result = v_result where id = v_round.id;
  return v_result || jsonb_build_object('player', to_jsonb(v_player));
end;
$$;
revoke all on function public.start_bonus_round(uuid) from public;
revoke all on function public.submit_bonus_answer(uuid,uuid,integer) from public;
grant execute on function public.start_bonus_round(uuid) to anon, authenticated;
grant execute on function public.submit_bonus_answer(uuid,uuid,integer) to anon, authenticated;
commit;
