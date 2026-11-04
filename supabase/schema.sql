-- Run once in the SQL Editor of your Supabase project, then run seed.sql.
-- Only the five RPC functions below are exposed. Tokens never appear in room state.
begin;
create schema if not exists quiz_private;
revoke all on schema quiz_private from public, anon, authenticated;

create table if not exists quiz_private.questions (
  id integer primary key,
  text text not null,
  options jsonb not null,
  seconds integer not null check (seconds between 5 and 120),
  correct integer not null check (correct between 0 and 3)
);
create table if not exists quiz_private.rooms (
  code text primary key,
  host_token uuid not null unique,
  status text not null default 'lobby' check (status in ('lobby','question','reveal','finished','closed')),
  question_index integer not null default -1,
  started_at timestamptz,
  deadline timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists quiz_private.players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references quiz_private.rooms(code) on delete cascade,
  token uuid not null unique,
  name text not null,
  joined_at timestamptz not null default now()
);
create unique index if not exists quiz_unique_names on quiz_private.players(room_code, lower(name));
create table if not exists quiz_private.answers (
  player_id uuid not null references quiz_private.players(id) on delete cascade,
  question_index integer not null references quiz_private.questions(id),
  choice integer not null check (choice between 0 and 3),
  correct boolean not null,
  elapsed_ms integer not null,
  points integer not null,
  primary key(player_id, question_index)
);
alter table quiz_private.questions enable row level security;
alter table quiz_private.rooms enable row level security;
alter table quiz_private.players enable row level security;
alter table quiz_private.answers enable row level security;
revoke all on all tables in schema quiz_private from public, anon, authenticated;

create or replace function public.quiz_create(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; v_attempt integer;
begin
  if p_token is null then raise exception 'INVALID_SESSION'; end if;
  if (select count(*) from quiz_private.questions) <> 10 then raise exception 'Questions not installed. Run seed.sql.'; end if;
  select code into v_code from quiz_private.rooms where host_token=p_token;
  if found then return jsonb_build_object('code',v_code,'token',p_token); end if;
  -- Keep classroom results until the owner explicitly chooses to remove them.
  for v_attempt in 1..20 loop
    v_code := (100000 + floor(random()*900000))::integer::text;
    begin
      insert into quiz_private.rooms(code,host_token) values(v_code,p_token);
      return jsonb_build_object('code',v_code,'token',p_token);
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Unable to allocate room';
end;
$$;

create or replace function public.quiz_join(p_code text, p_name text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r quiz_private.rooms; v_id uuid; v_name text := btrim(regexp_replace(p_name,'\s+',' ','g'));
begin
  if p_token is null then raise exception 'INVALID_SESSION'; end if;
  select * into r from quiz_private.rooms where code=p_code and created_at > now()-interval '7 days' for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select id into v_id from quiz_private.players where room_code=p_code and token=p_token;
  if found then return jsonb_build_object('playerId',v_id,'token',p_token); end if;
  if r.status <> 'lobby' then raise exception 'ROOM_STARTED'; end if;
  if v_name is null or char_length(v_name) not between 1 and 24 or v_name ~ '[[:cntrl:]]' then raise exception 'INVALID_NAME'; end if;
  if (select count(*) from quiz_private.players where room_code=p_code) >= 100 then raise exception 'ROOM_FULL'; end if;
  begin
    insert into quiz_private.players(room_code,token,name) values(p_code,p_token,v_name) returning id into v_id;
  exception when unique_violation then raise exception 'NAME_TAKEN';
  end;
  return jsonb_build_object('playerId',v_id,'token',p_token);
end;
$$;

create or replace function public.quiz_state(p_code text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r quiz_private.rooms; v_player uuid; v_host boolean; v_players jsonb; v_answers jsonb := '[]';
  v_my jsonb; v_counts jsonb; v_total integer; v_now timestamptz;
begin
  select * into r from quiz_private.rooms where code=p_code and created_at > now()-interval '7 days' for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_host := coalesce(r.host_token=p_token,false);
  if not v_host then
    select id into v_player from quiz_private.players where room_code=p_code and token=p_token;
    if not found then raise exception 'INVALID_SESSION'; end if;
  end if;
  v_now := clock_timestamp();
  if r.status='question' and v_now>=r.deadline then
    update quiz_private.rooms set status='reveal' where code=p_code;
    r.status := 'reveal';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'score',p.score,'correct',p.correct) order by p.joined_at),'[]')
  into v_players from (
    select p.id,p.name,p.joined_at,coalesce(sum(a.points),0) as score,count(a.player_id) filter(where a.correct) as correct
    from quiz_private.players p left join quiz_private.answers a on a.player_id=p.id
      and (r.status<>'question' or a.question_index<r.question_index)
    where p.room_code=p_code group by p.id
  ) p;
  select count(*) into v_total from quiz_private.answers a join quiz_private.players p on p.id=a.player_id
    where p.room_code=p_code and a.question_index=r.question_index;
  select jsonb_build_object('choice',a.choice) || case when r.status='question' then '{}'::jsonb
    else jsonb_build_object('correct',a.correct,'points',a.points) end into v_my
    from quiz_private.answers a where a.player_id=v_player and a.question_index=r.question_index;
  if r.status in ('reveal','finished') then
    select jsonb_agg(n order by choice) into v_counts from (
      select choices.choice,count(a.player_id) as n from generate_series(0,3) choices(choice)
      left join (select a.* from quiz_private.answers a join quiz_private.players p on p.id=a.player_id where p.room_code=p_code and a.question_index=r.question_index) a
      on a.choice=choices.choice group by choices.choice
    ) c;
  end if;
  if r.status='finished' then
    select coalesce(jsonb_agg(jsonb_build_object('playerId',a.player_id,'question',a.question_index,'choice',a.choice,'correct',a.correct,'points',a.points,'elapsedMs',a.elapsed_ms)),'[]')
    into v_answers from quiz_private.answers a join quiz_private.players p on p.id=a.player_id where p.room_code=p_code;
  end if;
  return jsonb_build_object('code',r.code,'status',r.status,'index',r.question_index,
    'startedAt',extract(epoch from r.started_at)*1000,'deadline',extract(epoch from r.deadline)*1000,
    'serverNow',extract(epoch from v_now)*1000,'players',v_players,'answers',v_answers,
    'answerCount',v_total,'myAnswer',v_my,'counts',v_counts);
end;
$$;

create or replace function public.quiz_action(p_code text,p_token uuid,p_action text,p_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r quiz_private.rooms; v_seconds integer; v_next integer; v_now timestamptz;
begin
  select * into r from quiz_private.rooms where code=p_code and created_at > now()-interval '7 days' for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if p_token is null or r.host_token<>p_token then raise exception 'INVALID_SESSION'; end if;
  if p_action='close' then
    update quiz_private.rooms set status='closed' where code=p_code;
    return '{}'::jsonb;
  end if;
  if p_index is null or p_index<>r.question_index then raise exception 'INVALID_ACTION'; end if;
  if p_action='reveal' and r.status='question' then
    update quiz_private.rooms set status='reveal' where code=p_code;
  elsif p_action='next' and r.status in ('lobby','reveal') then
    if not exists(select 1 from quiz_private.players where room_code=p_code) then raise exception 'NO_PLAYERS'; end if;
    v_next := r.question_index+1;
    select seconds into v_seconds from quiz_private.questions where id=v_next;
    if not found then update quiz_private.rooms set status='finished' where code=p_code;
    else
      v_now := clock_timestamp();
      update quiz_private.rooms set question_index=v_next,status='question',started_at=v_now,deadline=v_now+v_seconds*interval '1 second' where code=p_code;
    end if;
  else raise exception 'INVALID_ACTION';
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public.quiz_answer(p_code text,p_token uuid,p_index integer,p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r quiz_private.rooms; q quiz_private.questions; v_player uuid; v_elapsed integer; v_points integer; v_correct boolean; v_now timestamptz;
begin
  select * into r from quiz_private.rooms where code=p_code and created_at > now()-interval '7 days' for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select id into v_player from quiz_private.players where room_code=p_code and token=p_token;
  if not found then raise exception 'INVALID_SESSION'; end if;
  -- A retry never changes or double-counts the first accepted answer.
  if exists(select 1 from quiz_private.answers where player_id=v_player and question_index=p_index) then return '{}'::jsonb; end if;
  if p_choice is null or p_choice not between 0 and 3 then raise exception 'INVALID_ACTION'; end if;
  v_now := clock_timestamp();
  if p_index is null or p_index<>r.question_index or r.status<>'question' or v_now>=r.deadline then raise exception 'TOO_LATE'; end if;
  select * into q from quiz_private.questions where id=p_index;
  v_elapsed := greatest(0,round(extract(epoch from (v_now-r.started_at))*1000)::integer);
  v_correct := p_choice=q.correct;
  v_points := case when v_correct then round(1000*(1-least(1,v_elapsed::numeric/(q.seconds*1000))/2))::integer else 0 end;
  insert into quiz_private.answers(player_id,question_index,choice,correct,elapsed_ms,points)
    values(v_player,p_index,p_choice,v_correct,v_elapsed,v_points);
  if (select count(*) from quiz_private.answers a join quiz_private.players p on p.id=a.player_id where p.room_code=p_code and a.question_index=p_index)
    = (select count(*) from quiz_private.players where room_code=p_code) then
    update quiz_private.rooms set status='reveal' where code=p_code;
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.quiz_create(uuid) from public,anon,authenticated;
revoke all on function public.quiz_join(text,text,uuid) from public,anon,authenticated;
revoke all on function public.quiz_state(text,uuid) from public,anon,authenticated;
revoke all on function public.quiz_action(text,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.quiz_answer(text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.quiz_create(uuid),public.quiz_join(text,text,uuid),public.quiz_state(text,uuid),
  public.quiz_action(text,uuid,text,integer),public.quiz_answer(text,uuid,integer,integer) to anon;
commit;
notify pgrst, 'reload schema';
