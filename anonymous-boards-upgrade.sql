-- Run once in Supabase SQL Editor after enabling Anonymous Sign-Ins in Auth settings.
-- This makes saved boards private to each browser's anonymous session.

create or replace function public.get_puzzle_for_date(p_date date)
returns table (id uuid, puzzle_date date)
language plpgsql security definer set search_path = public
as $$
begin
  if p_date > current_date then raise exception 'Future puzzles are locked.'; end if;
  return query select p.id, p.puzzle_date from puzzles p where p.puzzle_date = p_date and p.published = true;
end;
$$;

create or replace function public.get_available_puzzles()
returns table (puzzle_date date)
language sql security definer set search_path = public
as $$
  select p.puzzle_date from puzzles p where p.published = true and p.puzzle_date <= current_date order by p.puzzle_date;
$$;

create or replace function public.get_player_game(p_puzzle_id uuid, p_player_id uuid)
returns table (state text, guess_count integer, rows jsonb, answer text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_player_id then raise exception 'Sign-in required.'; end if;
  return query select g.state, g.guess_count, g.guesses,
    case when g.state = 'playing' then null else p.answer end
  from game_sessions g join puzzles p on p.id = g.puzzle_id
  where g.puzzle_id = p_puzzle_id and g.player_id = p_player_id;
end;
$$;

create or replace function public.submit_guess(
  p_puzzle_id uuid, p_player_id uuid, p_player_name text, p_guess text
)
returns table (state text, guess_count integer, rows jsonb, answer text)
language plpgsql security definer set search_path = public
as $$
declare
  v_answer text; v_session game_sessions%rowtype;
  v_feedback text[] := array_fill('absent'::text, array[5]); v_remaining text[];
  v_position integer; v_rows jsonb; v_count integer; v_state text; i integer;
begin
  if auth.uid() is null or auth.uid() <> p_player_id then raise exception 'Sign-in required.'; end if;
  select p.answer into v_answer from puzzles p
  where p.id = p_puzzle_id and p.puzzle_date <= current_date and p.published = true;
  if v_answer is null then raise exception 'This puzzle is unavailable.'; end if;
  if p_guess !~ '^[a-z]{5}$' then raise exception 'Enter a five-letter word.'; end if;
  select * into v_session from game_sessions where puzzle_id = p_puzzle_id and player_id = p_player_id;
  if found and v_session.state <> 'playing' then return query select v_session.state, v_session.guess_count, v_session.guesses, v_answer; return; end if;
  v_remaining := regexp_split_to_array(v_answer, '');
  for i in 1..5 loop if substr(p_guess, i, 1) = substr(v_answer, i, 1) then v_feedback[i] := 'correct'; v_remaining[i] := null; end if; end loop;
  for i in 1..5 loop if v_feedback[i] <> 'correct' then v_position := array_position(v_remaining, substr(p_guess, i, 1)); if v_position is not null then v_feedback[i] := 'present'; v_remaining[v_position] := null; end if; end if; end loop;
  v_count := coalesce(v_session.guess_count, 0) + 1;
  v_state := case when p_guess = v_answer then 'won' when v_count >= 6 then 'lost' else 'playing' end;
  v_rows := coalesce(v_session.guesses, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('guess', p_guess, 'feedback', v_feedback));
  insert into game_sessions (puzzle_id, player_id, player_name, guesses, guess_count, state, completed_at)
  values (p_puzzle_id, p_player_id, trim(p_player_name), v_rows, v_count, v_state, case when v_state = 'playing' then null else now() end)
  on conflict (puzzle_id, player_id) do update set player_name = excluded.player_name, guesses = excluded.guesses, guess_count = excluded.guess_count, state = excluded.state, completed_at = excluded.completed_at;
  return query select v_state, v_count, v_rows, case when v_state = 'playing' then null else v_answer end;
end;
$$;

create or replace function public.get_completed_boards(p_puzzle_id uuid)
returns table (rows jsonb, guess_count integer, state text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign-in required.'; end if;
  if not exists (select 1 from game_sessions where puzzle_id = p_puzzle_id and player_id = auth.uid() and state <> 'playing') then
    raise exception 'Finish this puzzle first.';
  end if;
  return query
    select g.guesses, g.guess_count, g.state from game_sessions g
    where g.puzzle_id = p_puzzle_id and g.player_id <> auth.uid() and g.state <> 'playing'
    order by random();
end;
$$;

-- Preserves game records created before anonymous sign-in was enabled on this browser.
create or replace function public.claim_legacy_games(p_legacy_player_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign-in required.'; end if;
  update game_sessions old set player_id = auth.uid()
  where old.player_id = p_legacy_player_id
    and not exists (select 1 from game_sessions current where current.puzzle_id = old.puzzle_id and current.player_id = auth.uid());
end;
$$;

revoke execute on function public.get_today_puzzle() from public, anon;
revoke execute on function public.get_puzzle_for_date(date) from public, anon;
revoke execute on function public.get_available_puzzles() from public, anon;
revoke execute on function public.get_player_game(uuid, uuid) from public, anon;
revoke execute on function public.get_puzzle_stats(uuid) from public, anon;
revoke execute on function public.submit_guess(uuid, uuid, text, text) from public, anon;
revoke execute on function public.get_completed_boards(uuid) from public, anon;
revoke execute on function public.claim_legacy_games(uuid) from public, anon;

grant execute on function public.get_today_puzzle() to authenticated;
grant execute on function public.get_puzzle_for_date(date) to authenticated;
grant execute on function public.get_available_puzzles() to authenticated;
grant execute on function public.get_player_game(uuid, uuid) to authenticated;
grant execute on function public.get_puzzle_stats(uuid) to authenticated;
grant execute on function public.submit_guess(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_completed_boards(uuid) to authenticated;
grant execute on function public.claim_legacy_games(uuid) to authenticated;

alter function public.submit_guess(uuid, uuid, text, text) set timezone to 'America/Los_Angeles';
alter function public.get_puzzle_for_date(date) set timezone to 'America/Los_Angeles';
alter function public.get_available_puzzles() set timezone to 'America/Los_Angeles';
