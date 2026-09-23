-- Execute no SQL Editor do Supabase antes de publicar o app.js atualizado.
-- Libera erros anteriores sem excluir respostas ou alterar pontos já ganhos.
-- completed_count continua contando desafios respondidos, não tentativas.
begin;

CREATE OR REPLACE FUNCTION public.get_challenge_by_code(entered_code text, player_uuid uuid)
RETURNS TABLE(challenge_id uuid, location_name text, question text, options jsonb, points integer, already_answered boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select c.id, c.location_name, c.question, c.options, c.points,
    exists(select 1 from answers a where a.player_id = player_uuid
      and a.challenge_id = c.id and a.is_correct = true)
  from challenges c
  where upper(c.code) = upper(trim(entered_code)) and c.active = true
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.submit_answer(player_uuid uuid, challenge_uuid uuid, selected_index integer)
RETURNS TABLE(is_correct boolean, points_earned integer, explanation text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  c challenges%rowtype;
  previous_answer answers%rowtype;
  has_previous boolean;
  correct boolean;
  earned integer;
  new_score integer;
  available_place smallint;
begin
  select * into c from challenges where id = challenge_uuid and active = true;
  if not found then raise exception 'Desafio inválido'; end if;
  if selected_index is null or selected_index < 0
    or selected_index >= jsonb_array_length(c.options) then
    raise exception 'Alternativa inválida';
  end if;

  -- Serializa envios do mesmo jogador para impedir pontos duplicados.
  perform 1 from players where id = player_uuid for update;
  if not found then raise exception 'Jogador inválido'; end if;
  select * into previous_answer from answers a
    where a.player_id = player_uuid and a.challenge_id = challenge_uuid for update;
  has_previous := found;
  if has_previous and previous_answer.is_correct then
    raise exception 'Desafio já respondido corretamente';
  end if;

  correct := selected_index = c.correct_index;
  earned := case when correct then c.points else 0 end;
  if has_previous then
    update answers a set selected_index = submit_answer.selected_index,
      is_correct = correct, points_earned = earned
    where a.player_id = player_uuid and a.challenge_id = challenge_uuid;
  else
    insert into answers(player_id, challenge_id, selected_index, is_correct, points_earned)
    values(player_uuid, challenge_uuid, selected_index, correct, earned);
  end if;
  update players set
    score = score + earned - case when has_previous then coalesce(previous_answer.points_earned, 0) else 0 end,
    completed_count = completed_count + case when has_previous then 0 else 1 end
  where id = player_uuid returning score into new_score;

  if new_score >= 1000 and (select prize_place from players where id = player_uuid) is null then
    perform pg_advisory_xact_lock(2026, 3);
    select place into available_place from generate_series(1, 3) as place
    where not exists (select 1 from players where prize_place = place)
    order by place limit 1;
    if available_place is not null then
      update players set prize_place = available_place, prize_awarded_at = now() where id = player_uuid;
    end if;
  end if;
  return query select correct, earned, c.explanation;
end;
$function$;

commit;
