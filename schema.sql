-- =====================================================================
-- Classmate — قاعدة البيانات
-- شغّل الملف ده مرة واحدة في Supabase: SQL Editor > New query > Run
-- قبل التشغيل: غيّر الإيميل والاسم في آخر الملف (حساب المسؤول الأول)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------

-- إعدادات عامة: دومين إيميل الجامعة (فاضي = أي دومين)
create table public.settings (
  id int primary key default 1 check (id = 1),
  domain text not null default ''
);
insert into public.settings default values;

-- المحاضرين والمعيدين والمسؤولين
create table public.staff (
  email text primary key check (email = lower(email)),
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('admin','lecturer','ta')),
  status text not null default 'invited' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  owner_email text not null references public.staff(email),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.course_tas (
  course_id uuid not null references public.courses(id) on delete cascade,
  email text not null references public.staff(email) on delete cascade,
  primary key (course_id, email)
);

-- طلبة كل مادة (من شيت الإكسيل). grp = المجموعة ('' = من غير مجموعة)
-- pin = رمز تفعيل اختياري (مثلا آخر 4 أرقام من الرقم القومي)
create table public.enrollments (
  course_id uuid not null references public.courses(id) on delete cascade,
  student_code text not null,
  name text not null,
  grp text not null default '',
  pin text,
  primary key (course_id, student_code)
);

-- حسابات الطلبة: كلمة السر متشفرة، والجهاز المربوط
create table public.students (
  student_code text primary key,
  pass_hash text not null,
  device_id text,
  created_at timestamptz not null default now()
);

create table public.student_tokens (
  token_hash text primary key,
  student_code text not null references public.students(student_code) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.login_failures (
  id bigserial primary key,
  student_code text not null,
  at timestamptz not null default now()
);

-- المحاضرات. grp = null يعني الدفعة كلها
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  n int not null,
  grp text,
  allow_makeup boolean not null default false,
  radius int not null default 80,
  lat double precision,
  lng double precision,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz,
  ended boolean not null default false,
  started_by text not null
);
create unique index sessions_one_running on public.sessions(course_id) where not ended;

-- السر اللي بيتولد منه الكود المتغير. محدش يقدر يقراه غير دوال السيرفر
create table public.session_secrets (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  secret bytea not null
);

create table public.attendance (
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_code text not null,
  status text not null check (status in ('present','manual','pending')),
  makeup boolean not null default false,
  reason text not null default '',
  dist int,
  acc int,
  device_id text,
  at timestamptz not null default now(),
  primary key (session_id, student_code)
);

-- كل محاولة مرفوضة. counts_as_try = بتتحسب من الـ 5 محاولات
create table public.attempts (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_code text not null,
  reason text not null,
  counts_as_try boolean not null default false,
  at timestamptz not null default now()
);

-- سجل التعديلات: مين عمل إيه وإمتى
create table public.audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  course_id uuid references public.courses(id) on delete set null,
  action text not null
);

create index attendance_code on public.attendance(student_code);
create index attempts_session on public.attempts(session_id, student_code);
create index audit_course on public.audit(course_id, at desc);
create index sessions_course on public.sessions(course_id, n);
create index enroll_code on public.enrollments(student_code);

-- ---------------------------------------------------------------------
-- دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------

create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- دور المستخدم الحالي لو هو staff مفعّل وعلى دومين الجامعة، وإلا null
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select s.role from staff s, settings st
  where s.email = my_email() and s.email <> '' and s.status <> 'suspended'
    and (st.domain = '' or s.email like '%@' || st.domain)
$$;

-- دوره في مادة معينة: owner / ta / viewer (مسؤول على مادة غيره) / null
create or replace function public.course_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.owner_email = my_email() then 'owner'
    when exists (select 1 from course_tas t where t.course_id = c.id and t.email = my_email()) then 'ta'
    when staff_role() = 'admin' then 'viewer'
  end
  from courses c where c.id = cid and staff_role() is not null
$$;

create or replace function public.session_course(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from sessions where id = sid
$$;

create or replace function public.log_audit(cid uuid, act text) returns void
language sql security definer set search_path = public as $$
  insert into audit(actor, course_id, action) values (my_email(), cid, act)
$$;

create or replace function public.staff_name(e text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from staff where email = e), e)
$$;

-- الكود المتغير: 6 أرقام من HMAC للسر مع رقم الفترة (كل 3 دقايق)
create or replace function public.totp_code(p_secret bytea, p_step bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select lpad(((('x' || lpad(substr(encode(hmac(p_step::text::bytea, p_secret, 'sha256'), 'hex'), 1, 8), 16, '0'))::bit(64)::bigint) % 1000000)::text, 6, '0')
$$;

-- طول فترة الكود بالثواني (3 دقايق)، وبعد ما الكود يتغير القديم بيفضل مقبول 30 ثانية سماح
create or replace function public.code_step_seconds() returns int
language sql immutable as $$ select 180 $$;

create or replace function public.current_step() returns bigint
language sql stable as $$ select floor(extract(epoch from now()) / code_step_seconds())::bigint $$;

-- الثواني اللي عدت من أول الفترة الحالية
create or replace function public.code_step_age() returns double precision
language sql stable as $$ select extract(epoch from now()) - current_step() * code_step_seconds() $$;

-- عدد الغياب: محاضرات مجموعته اللي التسجيل فيها اتقفل (أو خلصت) وماحضرهاش، ناقص الحضور التعويضي
create or replace function public.course_absences(cid uuid, code text) returns int
language sql stable security definer set search_path = public as $$
  with e as (select grp from enrollments where course_id = cid and student_code = code)
  select greatest(0,
    (select count(*) from sessions s, e
      where s.course_id = cid and (s.ended or s.closed_at is not null or now() >= s.ends_at) and (s.grp is null or s.grp = e.grp)
        and not exists (select 1 from attendance a where a.session_id = s.id and a.student_code = code and a.status <> 'pending'))
    -
    (select count(*) from sessions s, e
      where s.course_id = cid and s.grp is not null and s.grp <> e.grp
        and exists (select 1 from attendance a where a.session_id = s.id and a.student_code = code and a.status <> 'pending'))
  )::int
$$;

-- ---------------------------------------------------------------------
-- صلاحيات القراءة (Row Level Security)
-- كل الكتابة بتحصل من خلال دوال السيرفر تحت بس
-- ---------------------------------------------------------------------

alter table public.settings enable row level security;
alter table public.staff enable row level security;
alter table public.courses enable row level security;
alter table public.course_tas enable row level security;
alter table public.enrollments enable row level security;
alter table public.students enable row level security;
alter table public.student_tokens enable row level security;
alter table public.login_failures enable row level security;
alter table public.sessions enable row level security;
alter table public.session_secrets enable row level security;
alter table public.attendance enable row level security;
alter table public.attempts enable row level security;
alter table public.audit enable row level security;

create policy settings_read on public.settings for select to authenticated using (true);
create policy staff_read on public.staff for select to authenticated using (staff_role() is not null);
create policy courses_read on public.courses for select to authenticated using (course_role(id) is not null);
create policy tas_read on public.course_tas for select to authenticated using (course_role(course_id) is not null);
create policy enroll_read on public.enrollments for select to authenticated using (course_role(course_id) is not null);
create policy sessions_read on public.sessions for select to authenticated using (course_role(course_id) is not null);
create policy attendance_read on public.attendance for select to authenticated using (course_role(session_course(session_id)) is not null);
create policy attempts_read on public.attempts for select to authenticated using (course_role(session_course(session_id)) is not null);
create policy audit_read on public.audit for select to authenticated
  using (staff_role() = 'admin' or (course_id is not null and course_role(course_id) is not null));
-- students / student_tokens / login_failures / session_secrets: من غير أي policy = مقفولين تماما

revoke all on all tables in schema public from anon, authenticated;
grant select on public.settings, public.staff, public.courses, public.course_tas, public.enrollments,
  public.sessions, public.attendance, public.attempts, public.audit to authenticated;

-- ---------------------------------------------------------------------
-- دوال المحاضرين والمسؤول
-- ---------------------------------------------------------------------

create or replace function public.staff_me() returns json
language plpgsql security definer set search_path = public as $$
declare r staff;
begin
  if staff_role() is null then return null; end if;
  select * into r from staff where email = my_email();
  if r.status = 'invited' then
    update staff set status = 'active' where email = r.email;
    perform log_audit(null, r.name || ' فعّل حسابه');
    r.status := 'active';
  end if;
  return json_build_object('email', r.email, 'name', r.name, 'role', r.role, 'status', r.status);
end $$;

-- قبل ما نبعت كود الدخول: هل الإيميل ده مسموح له؟ (عشان مانبعتش إيميلات لأي حد)
create or replace function public.staff_can_login(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s, settings st
    where s.email = lower(trim(p_email)) and s.status <> 'suspended'
      and (st.domain = '' or s.email like '%@' || st.domain))
$$;

create or replace function public.admin_save_staff(p_email text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email)); d text; existed boolean;
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  if p_role not in ('admin','lecturer','ta') then raise exception 'bad_role'; end if;
  select domain into d from settings;
  if d <> '' and e not like '%@' || d then raise exception 'wrong_domain'; end if;
  if e = my_email() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  select exists(select 1 from staff where email = e) into existed;
  insert into staff(email, name, role) values (e, trim(p_name), p_role)
    on conflict (email) do update set name = excluded.name, role = excluded.role;
  perform log_audit(null, case when existed then 'عدّل بيانات ' else 'أضاف ' end || trim(p_name) || ' بصفة ' ||
    case p_role when 'admin' then 'مسؤول' when 'lecturer' then 'محاضر' else 'معيد' end);
end $$;

create or replace function public.admin_set_status(p_email text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  if p_status not in ('active','suspended') then raise exception 'bad_status'; end if;
  if lower(p_email) = my_email() then raise exception 'cannot_change_self'; end if;
  update staff set status = p_status where email = lower(p_email);
  if not found then raise exception 'not_found'; end if;
  perform log_audit(null, case when p_status = 'suspended' then 'أوقف حساب ' else 'فعّل حساب ' end || staff_name(lower(p_email)));
end $$;

create or replace function public.admin_set_domain(p_domain text) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(trim(both '@ ' from coalesce(p_domain, '')));
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  if d <> '' and my_email() not like '%@' || d then raise exception 'domain_locks_you_out'; end if;
  update settings set domain = d;
  perform log_audit(null, 'غيّر نطاق بريد الجامعة إلى ' || case when d = '' then '(أي نطاق)' else d end);
end $$;

create or replace function public.create_course(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if coalesce(staff_role(), '') not in ('admin','lecturer') then raise exception 'not_allowed'; end if;
  insert into courses(name, owner_email) values (trim(p_name), my_email()) returning id into cid;
  perform log_audit(cid, 'أنشأ المادة');
  return cid;
end $$;

create or replace function public.rename_course(cid uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  update courses set name = trim(p_name) where id = cid;
  perform log_audit(cid, 'غيّر اسم المادة إلى ' || trim(p_name));
end $$;

create or replace function public.set_course_archived(cid uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  update courses set archived = p_archived where id = cid;
  perform log_audit(cid, case when p_archived then 'أرشف المادة' else 'أعاد المادة من الأرشيف' end);
end $$;

create or replace function public.add_ta(cid uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if not exists (select 1 from staff where email = lower(p_email) and status <> 'suspended') then raise exception 'not_found'; end if;
  insert into course_tas(course_id, email) values (cid, lower(p_email)) on conflict do nothing;
  perform log_audit(cid, 'أضاف ' || staff_name(lower(p_email)) || ' بصفة معيد في المادة');
end $$;

create or replace function public.remove_ta(cid uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  delete from course_tas where course_id = cid and email = lower(p_email);
  perform log_audit(cid, 'أزال ' || staff_name(lower(p_email)) || ' من فريق المادة');
end $$;

-- rows: [{"code":"...","name":"...","grp":"أ","pin":"1234"}, ...]
create or replace function public.replace_roster(cid uuid, rows jsonb, p_file text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then raise exception 'empty_roster'; end if;
  create temp table _r on commit drop as
    select distinct on (trim(x->>'code')) trim(x->>'code') as code, trim(x->>'name') as name,
           coalesce(trim(x->>'grp'), '') as grp, nullif(trim(coalesce(x->>'pin', '')), '') as pin
    from jsonb_array_elements(rows) x
    where coalesce(trim(x->>'code'), '') <> '' and coalesce(trim(x->>'name'), '') <> '';
  delete from enrollments where course_id = cid and student_code not in (select code from _r);
  insert into enrollments(course_id, student_code, name, grp, pin)
    select cid, code, name, grp, pin from _r
    on conflict (course_id, student_code) do update set name = excluded.name, grp = excluded.grp, pin = excluded.pin;
  select count(*) into n from _r;
  perform log_audit(cid, 'رفع ملف الطلبة «' || coalesce(p_file, '') || '» (' || n || ' طالب)');
  return n;
end $$;

create or replace function public.set_group(cid uuid, code text, p_grp text) returns void
language plpgsql security definer set search_path = public as $$
declare old text; nm text;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select grp, name into old, nm from enrollments where course_id = cid and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  update enrollments set grp = coalesce(trim(p_grp), '') where course_id = cid and student_code = code;
  perform log_audit(cid, 'نقل ' || nm || ' من ' || case when old = '' then 'دون مجموعة' else 'مجموعة ' || old end
    || ' إلى ' || case when coalesce(trim(p_grp), '') = '' then 'دون مجموعة' else 'مجموعة ' || trim(p_grp) end);
end $$;

create or replace function public.course_bindings(cid uuid)
returns table(student_code text, registered boolean, device_bound boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if course_role(cid) is null then raise exception 'not_allowed'; end if;
  return query select e.student_code, s.student_code is not null, s.device_id is not null
    from enrollments e left join students s on s.student_code = e.student_code where e.course_id = cid;
end $$;

-- فك ربط الجهاز: الطالب يدخل من موبايله الجديد بنفس كلمة السر
create or replace function public.reset_device(cid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select name into nm from enrollments where course_id = cid and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  update students set device_id = null where student_code = code;
  delete from student_tokens where student_code = code;
  perform log_audit(cid, 'فك ربط جهاز ' || nm);
end $$;

-- مسح الحساب: لو حد عمل حساب بكود طالب تاني، الطالب الحقيقي يسجل من الأول
create or replace function public.reset_account(cid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select name into nm from enrollments where course_id = cid and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  delete from students where student_code = code;
  perform log_audit(cid, 'حذف حساب ' || nm || ' ليُنشئ حسابًا من جديد');
end $$;

create or replace function public.start_session(cid uuid, p_grp text, p_makeup boolean, p_minutes int, p_radius int,
  p_lat double precision, p_lng double precision) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid; nn int; g text := nullif(trim(coalesce(p_grp, '')), '');
begin
  if coalesce(course_role(cid), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  if exists (select 1 from sessions where course_id = cid and not ended) then raise exception 'session_running'; end if;
  select coalesce(max(n), 0) + 1 into nn from sessions where course_id = cid;
  insert into sessions(course_id, n, grp, allow_makeup, radius, lat, lng, ends_at, started_by)
    values (cid, nn, g, coalesce(p_makeup, false) and g is not null,
            least(500, greatest(20, coalesce(p_radius, 80))), p_lat, p_lng,
            now() + make_interval(mins => least(60, greatest(1, coalesce(p_minutes, 10)))), my_email())
    returning id into sid;
  insert into session_secrets(session_id, secret) values (sid, gen_random_bytes(32));
  perform log_audit(cid, 'بدأ المحاضرة ' || nn || ' · ' || coalesce('مجموعة ' || g, 'الدفعة كاملة')
    || case when coalesce(p_makeup, false) and g is not null then ' · التعويض متاح' else '' end
    || case when p_lat is null then ' · دون التحقق من الموقع' else '' end);
  return sid;
end $$;

-- الكود الحالي للعرض على البروجكتور (للمحاضر والمعيد بس)
create or replace function public.current_code(sid uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s sessions; sec bytea; st bigint := current_step();
begin
  select * into s from sessions where id = sid;
  if s.id is null or coalesce(course_role(s.course_id), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  if s.ended or s.closed_at is not null or now() >= s.ends_at then
    return json_build_object('open', false);
  end if;
  select secret into sec from session_secrets where session_id = sid;
  return json_build_object('open', true, 'code', totp_code(sec, st),
    'ms_left', ((st + 1) * code_step_seconds() * 1000 - floor(extract(epoch from now()) * 1000))::bigint,
    'step_ms', code_step_seconds() * 1000,
    'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint);
end $$;

create or replace function public.close_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  select * into s from sessions where id = sid;
  if s.id is null or coalesce(course_role(s.course_id), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  update sessions set closed_at = least(now(), ends_at) where id = sid and closed_at is null;
  perform log_audit(s.course_id, 'أغلق التسجيل في المحاضرة ' || s.n);
end $$;

create or replace function public.end_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions; p int;
begin
  select * into s from sessions where id = sid;
  if s.id is null or coalesce(course_role(s.course_id), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  select count(*) into p from attendance where session_id = sid and status = 'pending';
  update sessions set ended = true, closed_at = coalesce(closed_at, least(now(), ends_at)) where id = sid;
  perform log_audit(s.course_id, 'أنهى المحاضرة ' || s.n || case when p > 0 then ' (' || p || ' من الطلبات المعلّقة احتُسبت غيابًا)' else '' end);
end $$;

-- صلاحية تعديل الحضور: المحاضر والمعيد في المحاضرة الشغالة، والمحاضر بس في المحاضرات المنتهية
create or replace function public.check_edit(sid uuid) returns sessions
language plpgsql stable security definer set search_path = public as $$
declare s sessions; r text;
begin
  select * into s from sessions where id = sid;
  if s.id is null then raise exception 'not_found'; end if;
  r := course_role(s.course_id);
  if coalesce(r, '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  if s.ended and r <> 'owner' then raise exception 'session_ended'; end if;
  return s;
end $$;

create or replace function public.approve_attendance(sid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); a attendance;
begin
  select * into a from attendance where session_id = sid and student_code = code and status = 'pending';
  if a.session_id is null then raise exception 'not_found'; end if;
  update attendance set status = 'present', reason = 'وافق ' || staff_name(my_email()) || ' (' || a.reason || ')'
    where session_id = sid and student_code = code;
  perform log_audit(s.course_id, 'وافق على ' || case when a.makeup then 'حضور تعويضي' else 'حضور' end || ' '
    || (select name from enrollments where course_id = s.course_id and student_code = code) || ' في المحاضرة ' || s.n || ' (' || a.reason || ')');
end $$;

create or replace function public.reject_attendance(sid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); a attendance;
begin
  select * into a from attendance where session_id = sid and student_code = code and status = 'pending';
  if a.session_id is null then raise exception 'not_found'; end if;
  delete from attendance where session_id = sid and student_code = code;
  insert into attempts(session_id, student_code, reason) values (sid, code, 'rejected_by_staff');
  perform log_audit(s.course_id, 'رفض طلب ' || (select name from enrollments where course_id = s.course_id and student_code = code)
    || ' في المحاضرة ' || s.n || ' (' || a.reason || ')');
end $$;

create or replace function public.mark_manual(sid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); e enrollments;
begin
  select * into e from enrollments where course_id = s.course_id and student_code = code;
  if e.student_code is null then raise exception 'not_found'; end if;
  insert into attendance(session_id, student_code, status, makeup, reason)
    values (sid, code, 'manual', s.grp is not null and s.grp <> e.grp, 'تسجيل يدوي بواسطة ' || staff_name(my_email()))
    on conflict (session_id, student_code) do update set status = 'manual', reason = excluded.reason;
  perform log_audit(s.course_id, 'سجّل ' || e.name || ' يدويًّا في المحاضرة ' || s.n);
end $$;

create or replace function public.cancel_attendance(sid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid);
begin
  delete from attendance where session_id = sid and student_code = code;
  if not found then raise exception 'not_found'; end if;
  perform log_audit(s.course_id, 'ألغى حضور ' || (select name from enrollments where course_id = s.course_id and student_code = code)
    || ' في المحاضرة ' || s.n);
end $$;

-- ---------------------------------------------------------------------
-- دوال الطالب (من غير حساب Supabase: بكود الطالب + كلمة سر + توكن)
-- ---------------------------------------------------------------------

create or replace function public.student_from_token(p_token text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select student_code from student_tokens
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now()
$$;

create or replace function public.issue_token(code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into student_tokens(token_hash, student_code, expires_at)
    values (encode(digest(t, 'sha256'), 'hex'), code, now() + interval '150 days');
  delete from student_tokens where student_code = code and expires_at < now();
  return t;
end $$;

create or replace function public.student_locked(code text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 10 from login_failures where student_code = code and at > now() - interval '15 minutes'
$$;

create or replace function public.student_register(p_code text, p_password text, p_pin text, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); nm text;
begin
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  select name into nm from enrollments where student_code = code limit 1;
  if nm is null then raise exception 'not_enrolled'; end if;
  if exists (select 1 from students where student_code = code) then raise exception 'already_registered'; end if;
  if exists (select 1 from enrollments where student_code = code and coalesce(pin, '') <> '')
     and not exists (select 1 from enrollments where student_code = code and pin = trim(coalesce(p_pin, ''))) then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_pin');  -- return (not raise) so the failure row is kept
  end if;
  insert into students(student_code, pass_hash, device_id) values (code, crypt(p_password, gen_salt('bf', 10)), p_device);
  return json_build_object('token', issue_token(code), 'name', nm);
end $$;

create or replace function public.student_login(p_code text, p_password text, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); st students;
begin
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  select * into st from students where student_code = code;
  if st.student_code is null then raise exception 'not_registered'; end if;
  if crypt(coalesce(p_password, ''), st.pass_hash) <> st.pass_hash then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_password');  -- return (not raise) so the failure row is kept
  end if;
  if st.device_id is null then
    update students set device_id = p_device where student_code = code;
  elsif st.device_id <> p_device then
    raise exception 'device_mismatch';
  end if;
  return json_build_object('token', issue_token(code), 'name', (select name from enrollments where student_code = code limit 1));
end $$;

create or replace function public.student_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from student_tokens where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.student_change_password(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); st students;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password'; end if;
  select * into st from students where student_code = code;
  if crypt(coalesce(p_old, ''), st.pass_hash) <> st.pass_hash then raise exception 'bad_password'; end if;
  update students set pass_hash = crypt(p_new, gen_salt('bf', 10)) where student_code = code;
end $$;

-- كل اللي الطالب محتاجه في الشاشة الرئيسية
create or replace function public.student_home(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object(
    'code', code,
    'name', (select name from enrollments where student_code = code limit 1),
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'grp', e.grp,
        'absences', course_absences(c.id, code),
        'session', (
          select json_build_object('id', s.id, 'n', s.n, 'grp', s.grp, 'allow_makeup', s.allow_makeup,
            'open', (s.closed_at is null and now() < s.ends_at),
            'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint,
            'own', (s.grp is null or s.grp = e.grp),
            'tries_left', 5 - (select count(*) from attempts t where t.session_id = s.id and t.student_code = code and t.counts_as_try),
            'mine', (select json_build_object('status', a.status, 'reason', a.reason, 'makeup', a.makeup, 'at', a.at)
                     from attendance a where a.session_id = s.id and a.student_code = code))
          from sessions s where s.course_id = c.id and not s.ended)
      ) order by c.name)
      from enrollments e join courses c on c.id = e.course_id
      where e.student_code = code and not c.archived), '[]'::json));
end $$;

-- تسجيل الحضور: كل التحقق هنا على السيرفر
create or replace function public.student_check_in(p_token text, sid uuid, p_code text,
  p_lat double precision, p_lng double precision, p_acc double precision, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  code text := student_from_token(p_token);
  st students; s sessions; e enrollments; a attendance; sec bytea;
  tries int; makeup boolean := false; cur bigint := current_step(); i int;
  entered text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  dist int; acc int := case when p_acc is null then null else round(p_acc)::int end;
  other text;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into st from students where student_code = code;
  if st.device_id is distinct from p_device then raise exception 'device_mismatch'; end if;

  select * into s from sessions where id = sid for update;
  if s.id is null or s.ended or s.closed_at is not null or now() >= s.ends_at then
    return json_build_object('result', 'closed');
  end if;
  select * into e from enrollments where course_id = s.course_id and student_code = code;
  if e.student_code is null then return json_build_object('result', 'rejected', 'reason', 'not_enrolled'); end if;

  select * into a from attendance where session_id = sid and student_code = code;
  if a.session_id is not null then
    return json_build_object('result', case when a.status = 'pending' then 'pending' else 'already' end, 'reason', a.reason, 'makeup', a.makeup);
  end if;

  select count(*) into tries from attempts where session_id = sid and student_code = code and counts_as_try;
  if tries >= 5 then return json_build_object('result', 'locked'); end if;

  select student_code into other from attendance where session_id = sid and device_id = p_device and student_code <> code limit 1;
  if other is not null then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'device_used');
    return json_build_object('result', 'rejected', 'reason', 'device_used');
  end if;

  if s.grp is not null and s.grp <> e.grp then
    if not s.allow_makeup then
      insert into attempts(session_id, student_code, reason) values (sid, code, 'other_group');
      return json_build_object('result', 'rejected', 'reason', 'other_group', 'session_grp', s.grp, 'my_grp', e.grp);
    end if;
    makeup := true;
  end if;

  select secret into sec from session_secrets where session_id = sid;
  if entered <> totp_code(sec, cur) and not (entered = totp_code(sec, cur - 1) and code_step_age() < 30) then
    for i in 1..40 loop
      if entered = totp_code(sec, cur - i) then
        insert into attempts(session_id, student_code, reason, counts_as_try) values (sid, code, 'expired_code', true);
        return json_build_object('result', 'rejected', 'reason', 'expired_code', 'tries_left', 4 - tries);
      end if;
    end loop;
    insert into attempts(session_id, student_code, reason, counts_as_try) values (sid, code, 'wrong_code', true);
    return json_build_object('result', 'rejected', 'reason', 'wrong_code', 'tries_left', 4 - tries);
  end if;

  if s.lat is not null and p_lat is not null then
    dist := round(2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - s.lat) / 2), 2) +
      cos(radians(s.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.lng) / 2), 2))));
  end if;

  if s.lat is not null and p_lat is null then
    insert into attendance(session_id, student_code, status, makeup, reason, device_id)
      values (sid, code, 'pending', makeup, case when makeup then 'تعويض · ' else '' end || 'دون إذن الموقع', p_device);
    return json_build_object('result', 'pending', 'reason', 'no_location', 'makeup', makeup);
  end if;
  if s.lat is not null and acc > 100 then
    insert into attendance(session_id, student_code, status, makeup, reason, dist, acc, device_id)
      values (sid, code, 'pending', makeup, case when makeup then 'تعويض · ' else '' end || 'إشارة GPS ضعيفة (دقة ' || acc || ' م)', dist, acc, p_device);
    return json_build_object('result', 'pending', 'reason', 'weak_gps', 'acc', acc, 'dist', dist, 'makeup', makeup);
  end if;
  if s.lat is not null and dist > s.radius then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'too_far:' || dist);
    return json_build_object('result', 'rejected', 'reason', 'too_far', 'dist', dist, 'radius', s.radius);
  end if;

  insert into attendance(session_id, student_code, status, makeup, reason, dist, acc, device_id)
    values (sid, code, 'present', makeup,
            case when makeup then 'حضور تعويضي' else '' end || case when s.lat is null then ' دون التحقق من الموقع' else '' end,
            dist, acc, p_device);
  return json_build_object('result', 'present', 'dist', dist, 'makeup', makeup, 'no_geo', s.lat is null);
end $$;

-- ---------------------------------------------------------------------
-- مين يقدر يشغّل إيه
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.my_email(), public.staff_role(), public.course_role(uuid), public.session_course(uuid)
  to authenticated;

grant execute on function
  public.staff_me(), public.admin_save_staff(text, text, text), public.admin_set_status(text, text),
  public.admin_set_domain(text), public.create_course(text), public.rename_course(uuid, text),
  public.set_course_archived(uuid, boolean), public.add_ta(uuid, text), public.remove_ta(uuid, text),
  public.replace_roster(uuid, jsonb, text), public.set_group(uuid, text, text), public.course_bindings(uuid),
  public.reset_device(uuid, text), public.reset_account(uuid, text),
  public.start_session(uuid, text, boolean, int, int, double precision, double precision),
  public.current_code(uuid), public.close_session(uuid), public.end_session(uuid),
  public.approve_attendance(uuid, text), public.reject_attendance(uuid, text),
  public.mark_manual(uuid, text), public.cancel_attendance(uuid, text)
  to authenticated;

grant execute on function
  public.staff_can_login(text),
  public.student_register(text, text, text, text), public.student_login(text, text, text),
  public.student_logout(text), public.student_change_password(text, text, text), public.student_home(text),
  public.student_check_in(text, uuid, text, double precision, double precision, double precision, text)
  to anon, authenticated;

create or replace function public.delete_course(cid uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if coalesce(course_role(cid), '') <> 'owner' and staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  select name into nm from courses where id = cid;
  if nm is null then raise exception 'not_found'; end if;
  if trim(coalesce(p_confirm, '')) <> trim(nm) then raise exception 'confirm_mismatch'; end if;
  perform log_audit(null, 'حذف المادة «' || nm || '» بكل محاضراتها وحضورها');
  delete from courses where id = cid;
end $$;
revoke execute on function public.delete_course(uuid, text) from public, anon;
grant execute on function public.delete_course(uuid, text) to authenticated;

-- تحديث 2: تصنيف المواد (العام الدراسي، الترم، المستوى، الشعبة)
-- المستوى 1 و 2 تخصص عام (من غير شعبة)، والمستوى 3 و 4 و 5 لازم شعبة: عمارة داخلية أو سينوغرافيا

alter table public.courses add column if not exists academic_year text;
alter table public.courses add column if not exists term int;
alter table public.courses add column if not exists level int;
alter table public.courses add column if not exists track text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'courses_classification_ok') then
    alter table public.courses add constraint courses_classification_ok check (
      (academic_year is null or academic_year ~ '^\d{4}/\d{4}$')
      and (term is null or term in (1, 2, 3))
      and (level is null or level between 1 and 5)
      and (
        (level is null and track = '')
        or (level <= 2 and track = '')
        or (level >= 3 and track in ('عمارة داخلية', 'سينوغرافيا'))
      )
    );
  end if;
end $$;

create index if not exists courses_period on public.courses(academic_year, term, level);

create or replace function public.course_label(y text, t int, l int, tr text) returns text
language sql immutable as $$
  select concat_ws(' · ',
    case l when 1 then 'المستوى الأول' when 2 then 'المستوى الثاني' when 3 then 'المستوى الثالث'
           when 4 then 'المستوى الرابع' when 5 then 'المستوى الخامس' end,
    nullif(tr, ''),
    case t when 1 then 'الفصل الدراسي الأول' when 2 then 'الفصل الدراسي الثاني' when 3 then 'الفصل الصيفي' end,
    y)
$$;

create or replace function public.check_classification(y text, t int, l int, tr text) returns void
language plpgsql immutable as $$
begin
  if y is null or y !~ '^\d{4}/\d{4}$' or split_part(y, '/', 2)::int <> split_part(y, '/', 1)::int + 1 then raise exception 'bad_year'; end if;
  if t is null or t not in (1, 2, 3) then raise exception 'bad_term'; end if;
  if l is null or l not between 1 and 5 then raise exception 'bad_level'; end if;
  if l <= 2 and coalesce(tr, '') <> '' then raise exception 'track_not_allowed'; end if;
  if l >= 3 and coalesce(tr, '') not in ('عمارة داخلية', 'سينوغرافيا') then raise exception 'track_required'; end if;
end $$;

drop function if exists public.create_course(text);

create or replace function public.create_course(p_name text, p_year text, p_term int, p_level int, p_track text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; tr text := case when p_level >= 3 then trim(coalesce(p_track, '')) else '' end;
begin
  if coalesce(staff_role(), '') not in ('admin', 'lecturer') then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr);
  insert into courses(name, owner_email, academic_year, term, level, track)
    values (trim(p_name), my_email(), p_year, p_term, p_level, tr) returning id into cid;
  perform log_audit(cid, 'أنشأ المادة · ' || course_label(p_year, p_term, p_level, tr));
  return cid;
end $$;

create or replace function public.update_course_info(cid uuid, p_name text, p_year text, p_term int, p_level int, p_track text) returns void
language plpgsql security definer set search_path = public as $$
declare c courses; tr text := case when p_level >= 3 then trim(coalesce(p_track, '')) else '' end; changes text[] := '{}';
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr);
  select * into c from courses where id = cid;
  if c.name is distinct from trim(p_name) then changes := changes || ('الاسم إلى «' || trim(p_name) || '»'); end if;
  if row(c.academic_year, c.term, c.level, c.track) is distinct from row(p_year, p_term, p_level, tr) then
    changes := changes || ('التصنيف إلى ' || course_label(p_year, p_term, p_level, tr));
  end if;
  if array_length(changes, 1) is null then return; end if;
  update courses set name = trim(p_name), academic_year = p_year, term = p_term, level = p_level, track = tr where id = cid;
  perform log_audit(cid, 'غيّر ' || array_to_string(changes, ' و'));
end $$;

-- الشاشة الرئيسية للطالب: نفس القديمة + تصنيف المادة
create or replace function public.student_home(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object(
    'code', code,
    'name', (select name from enrollments where student_code = code limit 1),
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'grp', e.grp,
        'label', course_label(c.academic_year, c.term, c.level, c.track),
        'absences', course_absences(c.id, code),
        'session', (
          select json_build_object('id', s.id, 'n', s.n, 'grp', s.grp, 'allow_makeup', s.allow_makeup,
            'open', (s.closed_at is null and now() < s.ends_at),
            'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint,
            'own', (s.grp is null or s.grp = e.grp),
            'tries_left', 5 - (select count(*) from attempts t where t.session_id = s.id and t.student_code = code and t.counts_as_try),
            'mine', (select json_build_object('status', a.status, 'reason', a.reason, 'makeup', a.makeup, 'at', a.at)
                     from attendance a where a.session_id = s.id and a.student_code = code))
          from sessions s where s.course_id = c.id and not s.ended)
      ) order by c.level nulls last, c.name)
      from enrollments e join courses c on c.id = e.course_id
      where e.student_code = code and not c.archived), '[]'::json));
end $$;

revoke execute on function public.course_label(text, int, int, text), public.check_classification(text, int, int, text) from public, anon, authenticated;
revoke execute on function public.create_course(text, text, int, int, text), public.update_course_info(uuid, text, text, int, int, text) from public, anon;
grant execute on function public.create_course(text, text, int, int, text), public.update_course_info(uuid, text, text, int, int, text) to authenticated;
revoke execute on function public.student_home(text) from public;
grant execute on function public.student_home(text) to anon, authenticated;

-- تحديث 3:
--   (1) QR شخصي للطالب بيشتغل من غير نت، والمحاضر أو المعيد يمسحه من موبايله
--   (2) نوع المحاضرة: قاعة أو خارجية (المكان من موبايل اللي بدأ المحاضرة، ونطاق أوسع)
--   (3) التسجيل اليدوي لازم يتكتب معاه سبب

-- ---------- الأعمدة الجديدة ----------
alter table public.students add column if not exists qr_key bytea;
alter table public.sessions add column if not exists kind text not null default 'hall';
alter table public.attendance add column if not exists via text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_kind_ok') then
    alter table public.sessions add constraint sessions_kind_ok check (kind in ('hall', 'outdoor'));
  end if;
end $$;

-- فترة الـ QR: كل 15 ثانية
create or replace function public.qr_step() returns bigint
language sql stable as $$ select floor(extract(epoch from now()) / 15)::bigint $$;

-- توقيع الـ QR: أول 16 حرف من HMAC-SHA256(مفتاح الطالب, "الكود:الفترة")
create or replace function public.qr_mac(p_key bytea, p_code text, p_step bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select substr(encode(hmac(convert_to(p_code || ':' || p_step::text, 'UTF8'), p_key, 'sha256'), 'hex'), 1, 16)
$$;

-- ---------- الطالب: دخول وتسجيل بيغيروا مفتاح الـ QR ----------
-- (لو المحاضر فك ربط الموبايل والطالب دخل من موبايل جديد، الـ QR بتاع الموبايل القديم يبطل)
create or replace function public.student_register(p_code text, p_password text, p_pin text, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); nm text;
begin
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  select name into nm from enrollments where student_code = code limit 1;
  if nm is null then raise exception 'not_enrolled'; end if;
  if exists (select 1 from students where student_code = code) then raise exception 'already_registered'; end if;
  if exists (select 1 from enrollments where student_code = code and coalesce(pin, '') <> '')
     and not exists (select 1 from enrollments where student_code = code and pin = trim(coalesce(p_pin, ''))) then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_pin');  -- return (not raise) so the failure row is kept
  end if;
  insert into students(student_code, pass_hash, device_id, qr_key)
    values (code, crypt(p_password, gen_salt('bf', 10)), p_device, gen_random_bytes(32));
  return json_build_object('token', issue_token(code), 'name', nm);
end $$;

create or replace function public.student_login(p_code text, p_password text, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); st students;
begin
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  select * into st from students where student_code = code;
  if st.student_code is null then raise exception 'not_registered'; end if;
  if crypt(coalesce(p_password, ''), st.pass_hash) <> st.pass_hash then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_password');  -- return (not raise) so the failure row is kept
  end if;
  if st.device_id is null then
    update students set device_id = p_device where student_code = code;
  elsif st.device_id <> p_device then
    raise exception 'device_mismatch';
  end if;
  update students set qr_key = gen_random_bytes(32) where student_code = code;
  return json_build_object('token', issue_token(code), 'name', (select name from enrollments where student_code = code limit 1));
end $$;

-- مفتاح الـ QR للموبايل المربوط بس + وقت السيرفر (عشان نظبط فرق ساعة الموبايل)
create or replace function public.student_qr_key(p_token text, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); st students;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into st from students where student_code = code;
  if st.device_id is distinct from p_device then raise exception 'device_mismatch'; end if;
  if st.qr_key is null then
    update students set qr_key = gen_random_bytes(32) where student_code = code returning * into st;
  end if;
  return json_build_object('code', code, 'name', (select name from enrollments where student_code = code limit 1),
    'key', encode(st.qr_key, 'hex'), 'now_ms', floor(extract(epoch from now()) * 1000)::bigint);
end $$;

-- ---------- المحاضر/المعيد يمسح QR الطالب ----------
create or replace function public.scan_student(sid uuid, p_payload text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  s sessions; m text[]; code text; stp bigint; e enrollments; a attendance; k bytea;
  makeup boolean := false; cur bigint := qr_step();
begin
  select * into s from sessions where id = sid for update;
  if s.id is null or coalesce(course_role(s.course_id), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  if s.ended then return json_build_object('result', 'ended'); end if;

  m := regexp_match(trim(coalesce(p_payload, '')), '^CM1:([0-9A-Za-z_-]{1,40}):([0-9]{1,12}):([0-9a-f]{16})$');
  if m is null then return json_build_object('result', 'not_ours'); end if;
  code := m[1]; stp := m[2]::bigint;

  select * into e from enrollments where course_id = s.course_id and student_code = code;
  if e.student_code is null then return json_build_object('result', 'not_enrolled', 'code', code); end if;

  select qr_key into k from students where student_code = code;
  if k is null or qr_mac(k, code, stp) <> m[3] then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'bad_qr');
    return json_build_object('result', 'invalid', 'name', e.name, 'code', code);
  end if;
  -- مسموح فرق دقيقة في ساعة الموبايل. أقدم من كده يبقى غالبا صورة اتبعتت
  if abs(stp - cur) > 4 then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'old_qr');
    return json_build_object('result', 'expired', 'name', e.name, 'code', code);
  end if;

  if s.grp is not null and s.grp <> e.grp then
    if not s.allow_makeup then
      return json_build_object('result', 'other_group', 'name', e.name, 'code', code, 'grp', e.grp, 'session_grp', s.grp);
    end if;
    makeup := true;
  end if;

  select * into a from attendance where session_id = sid and student_code = code;
  if a.session_id is not null and a.status <> 'pending' then
    return json_build_object('result', 'already', 'name', e.name, 'code', code, 'grp', e.grp);
  end if;

  insert into attendance(session_id, student_code, status, makeup, reason, via)
    values (sid, code, 'present', makeup,
            case when makeup then 'تعويض · ' else '' end || 'مسح بطاقة الحضور بواسطة ' || staff_name(my_email()), 'scan')
    on conflict (session_id, student_code) do update
      set status = 'present', reason = excluded.reason, via = 'scan', at = now();
  return json_build_object('result', 'present', 'name', e.name, 'code', code, 'grp', e.grp, 'makeup', makeup);
end $$;

-- ---------- بدء المحاضرة: قاعة أو خارجية ----------
drop function if exists public.start_session(uuid, text, boolean, int, int, double precision, double precision);

create or replace function public.start_session(cid uuid, p_grp text, p_makeup boolean, p_minutes int, p_radius int,
  p_lat double precision, p_lng double precision, p_kind text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid; nn int; g text := nullif(trim(coalesce(p_grp, '')), '');
  k text := case when p_kind = 'outdoor' then 'outdoor' else 'hall' end;
begin
  if coalesce(course_role(cid), '') not in ('owner','ta') then raise exception 'not_allowed'; end if;
  if exists (select 1 from sessions where course_id = cid and not ended) then raise exception 'session_running'; end if;
  select coalesce(max(n), 0) + 1 into nn from sessions where course_id = cid;
  insert into sessions(course_id, n, grp, allow_makeup, radius, lat, lng, ends_at, started_by, kind)
    values (cid, nn, g, coalesce(p_makeup, false) and g is not null,
            least(500, greatest(20, coalesce(p_radius, case when k = 'outdoor' then 200 else 80 end))), p_lat, p_lng,
            now() + make_interval(mins => least(120, greatest(1, coalesce(p_minutes, 10)))), my_email(), k)
    returning id into sid;
  insert into session_secrets(session_id, secret) values (sid, gen_random_bytes(32));
  perform log_audit(cid, 'بدأ المحاضرة ' || nn || case when k = 'outdoor' then ' (خارجية)' else '' end
    || ' · ' || coalesce('مجموعة ' || g, 'الدفعة كاملة')
    || case when coalesce(p_makeup, false) and g is not null then ' · التعويض متاح' else '' end
    || case when p_lat is null then ' · دون التحقق من الموقع' else '' end);
  return sid;
end $$;

-- ---------- التسجيل اليدوي بسبب ----------
drop function if exists public.mark_manual(uuid, text);

create or replace function public.mark_manual(sid uuid, code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); e enrollments; r text := trim(coalesce(p_reason, ''));
begin
  if length(r) < 3 then raise exception 'reason_required'; end if;
  r := left(r, 200);
  select * into e from enrollments where course_id = s.course_id and student_code = code;
  if e.student_code is null then raise exception 'not_found'; end if;
  insert into attendance(session_id, student_code, status, makeup, reason, via)
    values (sid, code, 'manual', s.grp is not null and s.grp <> e.grp, r || ' · سجّله ' || staff_name(my_email()), 'manual')
    on conflict (session_id, student_code) do update set status = 'manual', reason = excluded.reason, via = 'manual';
  perform log_audit(s.course_id, 'سجّل ' || e.name || ' يدويًّا في المحاضرة ' || s.n || ' (السبب: ' || r || ')');
end $$;

-- ---------- الشاشة الرئيسية للطالب: + نوع المحاضرة ----------
create or replace function public.student_home(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object(
    'code', code,
    'name', (select name from enrollments where student_code = code limit 1),
    'now_ms', floor(extract(epoch from now()) * 1000)::bigint,
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'grp', e.grp,
        'label', course_label(c.academic_year, c.term, c.level, c.track),
        'absences', course_absences(c.id, code),
        'session', (
          select json_build_object('id', s.id, 'n', s.n, 'grp', s.grp, 'allow_makeup', s.allow_makeup, 'kind', s.kind,
            'open', (s.closed_at is null and now() < s.ends_at),
            'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint,
            'own', (s.grp is null or s.grp = e.grp),
            'tries_left', 5 - (select count(*) from attempts t where t.session_id = s.id and t.student_code = code and t.counts_as_try),
            'mine', (select json_build_object('status', a.status, 'reason', a.reason, 'makeup', a.makeup, 'at', a.at, 'via', a.via)
                     from attendance a where a.session_id = s.id and a.student_code = code))
          from sessions s where s.course_id = c.id and not s.ended)
      ) order by c.level nulls last, c.name)
      from enrollments e join courses c on c.id = e.course_id
      where e.student_code = code and not c.archived), '[]'::json));
end $$;

-- ---------- الصلاحيات ----------
revoke execute on function public.qr_step(), public.qr_mac(bytea, text, bigint) from public, anon, authenticated;
revoke execute on function public.student_register(text, text, text, text), public.student_login(text, text, text),
  public.student_qr_key(text, text), public.student_home(text) from public;
grant execute on function public.student_register(text, text, text, text), public.student_login(text, text, text),
  public.student_qr_key(text, text), public.student_home(text) to anon, authenticated;
revoke execute on function public.scan_student(uuid, text),
  public.start_session(uuid, text, boolean, int, int, double precision, double precision, text),
  public.mark_manual(uuid, text, text) from public, anon;
grant execute on function public.scan_student(uuid, text),
  public.start_session(uuid, text, boolean, int, int, double precision, double precision, text),
  public.mark_manual(uuid, text, text) to authenticated;

-- تحديث 4:
--   (1) محاضر مشارك في المادة: نفس صلاحيات صاحب المادة في الطلبة والمحاضرات والكشف،
--       ماعدا مسح المادة وتعديل بياناتها وأرشفتها وإدارة الفريق (دي لصاحب المادة بس)
--   (2) إضافة طالب واحد للمادة من غير رفع شيت (المحاضر أو المحاضر المشارك أو المعيد)
--       وشيل طالب من المادة (المحاضر أو المحاضر المشارك)

-- ---------- نوع العضو في فريق المادة ----------
alter table public.course_tas add column if not exists kind text not null default 'ta';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'course_tas_kind_ok') then
    alter table public.course_tas add constraint course_tas_kind_ok check (kind in ('ta', 'co'));
  end if;
end $$;

-- صاحب المادة الحقيقي (اللي عملها)
create or replace function public.course_owner(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_email = my_email() and staff_role() is not null)
$$;

-- الدور في المادة: المحاضر المشارك بياخد صلاحيات 'owner' في الطلبة والمحاضرات والكشف
create or replace function public.course_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.owner_email = my_email() then 'owner'
    when exists (select 1 from course_tas t where t.course_id = c.id and t.email = my_email() and t.kind = 'co') then 'owner'
    when exists (select 1 from course_tas t where t.course_id = c.id and t.email = my_email()) then 'ta'
    when staff_role() = 'admin' then 'viewer'
  end
  from courses c where c.id = cid and staff_role() is not null
$$;

-- ---------- حاجات صاحب المادة بس ----------
create or replace function public.rename_course(cid uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  update courses set name = trim(p_name) where id = cid;
  perform log_audit(cid, 'غيّر اسم المادة إلى ' || trim(p_name));
end $$;

create or replace function public.set_course_archived(cid uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  update courses set archived = p_archived where id = cid;
  perform log_audit(cid, case when p_archived then 'أرشف المادة' else 'أعاد المادة من الأرشيف' end);
end $$;

create or replace function public.update_course_info(cid uuid, p_name text, p_year text, p_term int, p_level int, p_track text) returns void
language plpgsql security definer set search_path = public as $$
declare c courses; tr text := case when p_level >= 3 then trim(coalesce(p_track, '')) else '' end; changes text[] := '{}';
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr);
  select * into c from courses where id = cid;
  if c.name is distinct from trim(p_name) then changes := changes || ('الاسم إلى «' || trim(p_name) || '»'); end if;
  if row(c.academic_year, c.term, c.level, c.track) is distinct from row(p_year, p_term, p_level, tr) then
    changes := changes || ('التصنيف إلى ' || course_label(p_year, p_term, p_level, tr));
  end if;
  if array_length(changes, 1) is null then return; end if;
  update courses set name = trim(p_name), academic_year = p_year, term = p_term, level = p_level, track = tr where id = cid;
  perform log_audit(cid, 'غيّر ' || array_to_string(changes, ' و'));
end $$;

create or replace function public.delete_course(cid uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not course_owner(cid) and staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  select name into nm from courses where id = cid;
  if nm is null then raise exception 'not_found'; end if;
  if trim(coalesce(p_confirm, '')) <> trim(nm) then raise exception 'confirm_mismatch'; end if;
  perform log_audit(null, 'حذف المادة «' || nm || '» بكل محاضراتها وحضورها');
  delete from courses where id = cid;
end $$;

-- إضافة عضو للفريق: p_kind = 'ta' معيد، 'co' محاضر مشارك. لو موجود بيتغير نوعه
create or replace function public.add_member(cid uuid, p_email text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, ''))); k text := case when p_kind = 'co' then 'co' else 'ta' end; old text;
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from staff where email = e and status <> 'suspended') then raise exception 'not_found'; end if;
  if exists (select 1 from courses where id = cid and owner_email = e) then raise exception 'already_owner'; end if;
  select kind into old from course_tas where course_id = cid and email = e;
  if old = k then return; end if;
  insert into course_tas(course_id, email, kind) values (cid, e, k)
    on conflict (course_id, email) do update set kind = excluded.kind;
  perform log_audit(cid, case when old is null then 'أضاف ' else 'غيّر ' end || staff_name(e)
    || case when k = 'co' then ' بصفة محاضر مشارك' else ' بصفة معيد' end || ' في المادة');
end $$;

create or replace function public.add_ta(cid uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform add_member(cid, p_email, 'ta');
end $$;

create or replace function public.remove_ta(cid uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  delete from course_tas where course_id = cid and email = lower(p_email);
  perform log_audit(cid, 'أزال ' || staff_name(lower(p_email)) || ' من فريق المادة');
end $$;

-- ---------- طالب واحد ----------
-- المحاضر أو المحاضر المشارك أو المعيد. الكود حروف إنجليزي وأرقام بس (عشان كود الحضور QR)
create or replace function public.add_student(cid uuid, p_code text, p_name text, p_grp text, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := trim(coalesce(p_code, '')); nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  g text := trim(coalesce(p_grp, '')); pin text := nullif(trim(coalesce(p_pin, '')), '');
begin
  if coalesce(course_role(cid), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if code !~ '^[0-9A-Za-z_-]{1,40}$' then raise exception 'bad_code'; end if;
  if length(nm) = 0 then raise exception 'name_required'; end if;
  if exists (select 1 from enrollments where course_id = cid and student_code = code) then raise exception 'already_in_course'; end if;
  insert into enrollments(course_id, student_code, name, grp, pin) values (cid, code, left(nm, 120), left(g, 20), left(pin, 30));
  perform log_audit(cid, 'أضاف الطالب ' || nm || ' (' || code || ')' || case when g <> '' then ' في مجموعة ' || g else '' end || ' للمادة');
end $$;

-- شيل طالب من المادة (المحاضر أو المحاضر المشارك). الحضور القديم بيفضل محفوظ لو رجع تاني
create or replace function public.remove_student(cid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select name into nm from enrollments where course_id = cid and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  delete from enrollments where course_id = cid and student_code = code;
  perform log_audit(cid, 'أزال الطالب ' || nm || ' (' || code || ') من المادة');
end $$;

-- ---------- الصلاحيات ----------
revoke execute on function public.course_owner(uuid), public.add_member(uuid, text, text),
  public.add_student(uuid, text, text, text, text), public.remove_student(uuid, text) from public, anon;
grant execute on function public.course_owner(uuid), public.add_member(uuid, text, text),
  public.add_student(uuid, text, text, text, text), public.remove_student(uuid, text) to authenticated;

-- تحديث 5:
--   (1) المسؤول يغيّر دور أي حد (معيد / محاضر / مسؤول) من الجدول على طول
--   (2) إعداد للقسم: «المعيدين يقدروا يعملوا مواد». المعيد اللي يعمل مادة بيبقى صاحبها
--       وليه كل صلاحيات صاحب المادة فيها (طلبة، شيت، فريق، إعدادات)

alter table public.settings add column if not exists ta_can_create boolean not null default false;

-- تغيير الدور
create or replace function public.admin_set_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, ''))); old text;
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  if p_role not in ('admin', 'lecturer', 'ta') then raise exception 'bad_role'; end if;
  if e = my_email() then raise exception 'cannot_demote_self'; end if;
  select role into old from staff where email = e;
  if old is null then raise exception 'not_found'; end if;
  if old = p_role then return; end if;
  update staff set role = p_role where email = e;
  perform log_audit(null, 'غيّر دور ' || staff_name(e) || ' من '
    || case old when 'admin' then 'مسؤول' when 'lecturer' then 'محاضر' else 'معيد' end || ' إلى '
    || case p_role when 'admin' then 'مسؤول' when 'lecturer' then 'محاضر' else 'معيد' end);
end $$;

-- السماح للمعيدين بعمل مواد
create or replace function public.admin_set_ta_create(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  update settings set ta_can_create = coalesce(p_on, false);
  perform log_audit(null, case when p_on then 'سمح للمعيدين بإنشاء مواد' else 'منع المعيدين من إنشاء مواد' end);
end $$;

-- عمل مادة: المحاضر والمسؤول دايما، والمعيد لو الإعداد مفتوح
create or replace function public.create_course(p_name text, p_year text, p_term int, p_level int, p_track text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; tr text := case when p_level >= 3 then trim(coalesce(p_track, '')) else '' end; r text := staff_role();
begin
  if coalesce(r, '') not in ('admin', 'lecturer')
     and not (r = 'ta' and (select ta_can_create from settings)) then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr);
  insert into courses(name, owner_email, academic_year, term, level, track)
    values (trim(p_name), my_email(), p_year, p_term, p_level, tr) returning id into cid;
  perform log_audit(cid, 'أنشأ المادة · ' || course_label(p_year, p_term, p_level, tr));
  return cid;
end $$;

revoke execute on function public.admin_set_role(text, text), public.admin_set_ta_create(boolean) from public, anon;
grant execute on function public.admin_set_role(text, text), public.admin_set_ta_create(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- مسح محاضرة اتعملت بالغلط (صاحب المادة أو المحاضر المشارك). حضورها ومحاولاتها بيتمسحوا،
-- والمحاضرات اللي بعدها بتترقم من جديد، والمسح بيتسجل في سجل التعديلات
create or replace function public.delete_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions; cnt int; later int;
begin
  select * into s from sessions where id = sid for update;
  if s.id is null then raise exception 'not_found'; end if;
  if course_role(s.course_id) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select count(*) into cnt from attendance where session_id = sid and status <> 'pending';
  delete from sessions where id = sid;
  update sessions set n = n - 1 where course_id = s.course_id and n > s.n;
  get diagnostics later = row_count;
  perform log_audit(s.course_id, 'حذف المحاضرة ' || s.n
    || case when s.grp is not null then ' (مجموعة ' || s.grp || ')' else '' end
    || ' بتاريخ ' || to_char(s.started_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')
    || '، وكان فيها ' || cnt || ' حاضر'
    || case when later > 0 then '، وأُعيد ترقيم المحاضرات التالية لها' else '' end);
end $$;

revoke execute on function public.delete_session(uuid) from public, anon;
grant execute on function public.delete_session(uuid) to authenticated;

-- تحديث 8:
--   (1) موافقة / رفض / تحضير يدوي لأكتر من طالب مرة واحدة (أي حد في فريق المادة: صاحبها، المحاضر المشارك، المعيدين)
--   (2) رفع حضور محاضرات قديمة من شيت إكسيل (ح / غ) لصاحب المادة والمحاضر المشارك

-- ---------- موافقة على كذا طلب معلّق ----------
create or replace function public.approve_many(sid uuid, codes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); n int;
begin
  with u as (
    update attendance set status = 'present', reason = 'وافق ' || staff_name(my_email()) || ' (' || reason || ')'
      where session_id = sid and status = 'pending' and student_code = any(coalesce(codes, '{}'))
      returning 1)
  select count(*) into n from u;
  if n > 0 then
    perform log_audit(s.course_id, 'وافق على ' || n || ' من الطلبات المعلّقة دفعة واحدة في المحاضرة ' || s.n);
  end if;
  return n;
end $$;

-- ---------- رفض كذا طلب معلّق ----------
create or replace function public.reject_many(sid uuid, codes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); n int;
begin
  with d as (
    delete from attendance where session_id = sid and status = 'pending' and student_code = any(coalesce(codes, '{}'))
      returning student_code),
  i as (insert into attempts(session_id, student_code, reason) select sid, student_code, 'rejected_by_staff' from d returning 1)
  select count(*) into n from i;
  if n > 0 then
    perform log_audit(s.course_id, 'رفض ' || n || ' من الطلبات المعلّقة دفعة واحدة في المحاضرة ' || s.n);
  end if;
  return n;
end $$;

-- ---------- تحضير يدوي لكذا طالب بسبب واحد ----------
create or replace function public.mark_manual_many(sid uuid, codes text[], p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare s sessions := check_edit(sid); r text := left(trim(coalesce(p_reason, '')), 200); n int; names text;
begin
  if length(r) < 3 then raise exception 'reason_required'; end if;
  with ins as (
    insert into attendance(session_id, student_code, status, makeup, reason, via)
      select sid, e.student_code, 'manual', s.grp is not null and e.grp <> s.grp, r || ' · سجّله ' || staff_name(my_email()), 'manual'
        from enrollments e where e.course_id = s.course_id and e.student_code = any(coalesce(codes, '{}'))
      on conflict (session_id, student_code) do update
        set status = 'manual', reason = excluded.reason, via = 'manual' where attendance.status = 'pending'
      returning student_code)
  select count(*), string_agg(e.name, '، ' order by e.name) into n, names
    from ins join enrollments e on e.course_id = s.course_id and e.student_code = ins.student_code;
  if n > 0 then
    perform log_audit(s.course_id, 'سجّل ' || case when n = 1 then names else n || ' من الطلبة يدويًّا (' || left(names, 300) || ')' end
      || case when n = 1 then ' يدويًّا' else '' end || ' في المحاضرة ' || s.n || ' (السبب: ' || r || ')');
  end if;
  return n;
end $$;

-- ---------- حضور محاضرة قديمة من شيت إكسيل ----------
-- p_present: أكواد الحاضرين (ح)، p_absent: أكواد الغايبين (غ). المحاضرة بتتعمل منتهية بتاريخها،
-- ولو فيه محاضرة بنفس التاريخ ونفس المجموعة بيتحدث حضورها بدل ما تتكرر. الغياب بيشيل بس الحضور
-- اللي جه من شيت قبل كده، ومش بيلمس حضور اتسجل في المحاضرة نفسها. المحاضرات بتترقم بترتيب التاريخ.
create or replace function public.import_lecture(cid uuid, p_date date, p_grp text, p_present text[], p_absent text[]) returns json
language plpgsql security definer set search_path = public as $$
declare g text := nullif(trim(coalesce(p_grp, '')), ''); s sessions; created boolean := false;
  added int; cleared int; kept int; t timestamptz;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if p_date is null or p_date > (now() at time zone 'Africa/Cairo')::date then raise exception 'bad_date'; end if;
  select * into s from sessions where course_id = cid and grp is not distinct from g
    and (started_at at time zone 'Africa/Cairo')::date = p_date order by started_at limit 1;
  if s.id is null then
    t := (p_date + time '09:00') at time zone 'Africa/Cairo';
    insert into sessions(course_id, n, grp, allow_makeup, radius, started_at, ends_at, closed_at, ended, started_by, kind)
      values (cid, 0, g, false, 80, t, t + interval '10 min', t + interval '10 min', true, my_email(), 'hall')
      returning * into s;
    created := true;
  end if;

  with ins as (
    insert into attendance(session_id, student_code, status, makeup, reason, via, at)
      select s.id, e.student_code, 'present', g is not null and e.grp <> g, 'من ملف محاضرات سابقة', 'import', s.started_at
        from enrollments e where e.course_id = cid and e.student_code = any(coalesce(p_present, '{}'))
      on conflict (session_id, student_code) do update
        set status = 'present', reason = excluded.reason, via = 'import' where attendance.status = 'pending'
      returning 1)
  select count(*) into added from ins;

  with del as (delete from attendance where session_id = s.id and via = 'import'
      and student_code = any(coalesce(p_absent, '{}')) returning 1)
  select count(*) into cleared from del;
  select count(*) into kept from attendance where session_id = s.id and student_code = any(coalesce(p_absent, '{}'));

  update sessions x set n = r.rn
    from (select id, row_number() over (order by started_at, id) as rn from sessions where course_id = cid) r
    where x.id = r.id and x.n is distinct from r.rn;
  select n into s.n from sessions where id = s.id;

  perform log_audit(cid, case when created then 'رفع حضور محاضرة سابقة' else 'حدّث حضور المحاضرة ' || s.n || ' من ملف' end
    || ' بتاريخ ' || to_char(p_date, 'YYYY-MM-DD') || ' · ' || coalesce('مجموعة ' || g, 'الدفعة كاملة')
    || ' · ' || coalesce(array_length(p_present, 1), 0) || ' حاضر و' || coalesce(array_length(p_absent, 1), 0) || ' غائب');
  return json_build_object('created', created, 'n', s.n, 'added', added, 'cleared', cleared, 'kept', kept);
end $$;

revoke execute on function public.approve_many(uuid, text[]), public.reject_many(uuid, text[]),
  public.mark_manual_many(uuid, text[], text), public.import_lecture(uuid, date, text, text[], text[]) from public, anon;
grant execute on function public.approve_many(uuid, text[]), public.reject_many(uuid, text[]),
  public.mark_manual_many(uuid, text[], text), public.import_lecture(uuid, date, text, text[], text[]) to authenticated;

-- تحديث 10: نظام الإنذارات الجديد وإشعار الطالب بالإنذار
--   غيابان: إنذار أول · 3: إنذار ثانٍ · 4: إنذار ثالث ونهائي · 5 فأكثر: انسحاب إجباري
--   يظهر للطالب إشعار عند وصوله إلى مستوى إنذار جديد، ويُسجَّل وقت اطّلاعه عليه ليراه فريق المادة.

-- ---------- مستوى الإنذار من عدد مرات الغياب ----------
create or replace function public.warn_level(n int) returns int
language sql immutable as $$
  select case when n >= 5 then 4 when n >= 4 then 3 when n >= 3 then 2 when n >= 2 then 1 else 0 end
$$;

-- ---------- سجل اطّلاع الطلبة على الإنذارات ----------
create table if not exists public.warning_notices (
  course_id uuid not null references public.courses(id) on delete cascade,
  student_code text not null,
  level int not null check (level between 1 and 4),
  absences int not null,
  seen_at timestamptz not null default now(),
  primary key (course_id, student_code, level)
);
alter table public.warning_notices enable row level security;
drop policy if exists notices_read on public.warning_notices;
create policy notices_read on public.warning_notices for select to authenticated using (course_role(course_id) is not null);
revoke all on public.warning_notices from anon;
grant select on public.warning_notices to authenticated;

-- ---------- الطالب يؤكّد اطّلاعه على الإنذار ----------
create or replace function public.student_ack_warning(p_token text, cid uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); ab int; l int;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from enrollments where course_id = cid and student_code = code) then raise exception 'not_found'; end if;
  ab := course_absences(cid, code); l := warn_level(ab);
  insert into warning_notices(course_id, student_code, level, absences)
    select cid, code, g, ab from generate_series(1, l) g
    on conflict do nothing;
  return l;
end $$;

-- ---------- الشاشة الرئيسية للطالب: + مستوى الإنذار وآخر إنذار اطّلع عليه والمحاضرات التي غاب عنها ----------
create or replace function public.student_home(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object(
    'code', code,
    'name', (select name from enrollments where student_code = code limit 1),
    'now_ms', floor(extract(epoch from now()) * 1000)::bigint,
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'grp', e.grp,
        'label', course_label(c.academic_year, c.term, c.level, c.track),
        'absences', x.ab,
        'level', warn_level(x.ab),
        'seen', coalesce((select max(w.level) from warning_notices w where w.course_id = c.id and w.student_code = code), 0),
        'missed', coalesce((
          select json_agg(json_build_object('n', s.n, 'at', s.started_at) order by s.started_at)
          from sessions s
          where s.course_id = c.id and (s.ended or s.closed_at is not null or now() >= s.ends_at)
            and (s.grp is null or s.grp = e.grp)
            and not exists (select 1 from attendance a where a.session_id = s.id and a.student_code = code and a.status <> 'pending')), '[]'::json),
        'session', (
          select json_build_object('id', s.id, 'n', s.n, 'grp', s.grp, 'allow_makeup', s.allow_makeup, 'kind', s.kind,
            'open', (s.closed_at is null and now() < s.ends_at),
            'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint,
            'own', (s.grp is null or s.grp = e.grp),
            'tries_left', 5 - (select count(*) from attempts t where t.session_id = s.id and t.student_code = code and t.counts_as_try),
            'mine', (select json_build_object('status', a.status, 'reason', a.reason, 'makeup', a.makeup, 'at', a.at, 'via', a.via)
                     from attendance a where a.session_id = s.id and a.student_code = code))
          from sessions s where s.course_id = c.id and not s.ended)
      ) order by c.level nulls last, c.name)
      from enrollments e join courses c on c.id = e.course_id
        cross join lateral (select course_absences(c.id, code) as ab) x
      where e.student_code = code and not c.archived), '[]'::json));
end $$;

revoke execute on function public.student_ack_warning(text, uuid), public.student_home(text) from public;
grant execute on function public.student_ack_warning(text, uuid), public.student_home(text) to anon, authenticated;
grant execute on function public.warn_level(int) to anon, authenticated;

-- تحديث 11: البرنامج الخاص لقسم الديكور
--   البرنامج العام (القائم): المستويات 1–5، والشعبة من المستوى الثالث (عمارة داخلية أو سينوغرافيا)
--   البرنامج الخاص (بمصروفات خاصة): شعبة العمارة الداخلية فقط، والمستويات 1–4

alter table public.courses add column if not exists dept text not null default 'الديكور';
alter table public.courses add column if not exists program text not null default 'عام';

alter table public.courses drop constraint if exists courses_classification_ok;
alter table public.courses add constraint courses_classification_ok check (
  (academic_year is null or academic_year ~ '^\d{4}/\d{4}$')
  and (term is null or term in (1, 2, 3))
  and dept = 'الديكور'
  and program in ('عام', 'خاص')
  and (
    (level is null and track = '')
    or (program = 'عام' and level between 1 and 2 and track = '')
    or (program = 'عام' and level between 3 and 5 and track in ('عمارة داخلية', 'سينوغرافيا'))
    or (program = 'خاص' and level between 1 and 4 and track = 'عمارة داخلية')
  )
);

create or replace function public.course_label(y text, t int, l int, tr text, prog text) returns text
language sql immutable as $$
  select concat_ws(' · ',
    case when prog = 'خاص' then 'البرنامج الخاص' end,
    case l when 1 then 'المستوى الأول' when 2 then 'المستوى الثاني' when 3 then 'المستوى الثالث'
           when 4 then 'المستوى الرابع' when 5 then 'المستوى الخامس' end,
    nullif(tr, ''),
    case t when 1 then 'الفصل الدراسي الأول' when 2 then 'الفصل الدراسي الثاني' when 3 then 'الفصل الصيفي' end,
    y)
$$;

-- الشعبة الفعلية بعد التطبيع: البرنامج الخاص دائمًا عمارة داخلية، والعام بلا شعبة في المستويين الأول والثاني
create or replace function public.norm_track(l int, tr text, prog text) returns text
language sql immutable as $$
  select case when prog = 'خاص' then 'عمارة داخلية' when l >= 3 then trim(coalesce(tr, '')) else '' end
$$;

create or replace function public.check_classification(y text, t int, l int, tr text, prog text) returns void
language plpgsql immutable as $$
begin
  if y is null or y !~ '^\d{4}/\d{4}$' or split_part(y, '/', 2)::int <> split_part(y, '/', 1)::int + 1 then raise exception 'bad_year'; end if;
  if t is null or t not in (1, 2, 3) then raise exception 'bad_term'; end if;
  if prog is null or prog not in ('عام', 'خاص') then raise exception 'bad_program'; end if;
  if prog = 'خاص' then
    if l is null or l not between 1 and 4 then raise exception 'bad_level_private'; end if;
    if tr is distinct from 'عمارة داخلية' then raise exception 'track_private'; end if;
    return;
  end if;
  if l is null or l not between 1 and 5 then raise exception 'bad_level'; end if;
  if l <= 2 and coalesce(tr, '') <> '' then raise exception 'track_not_allowed'; end if;
  if l >= 3 and coalesce(tr, '') not in ('عمارة داخلية', 'سينوغرافيا') then raise exception 'track_required'; end if;
end $$;

-- إنشاء مادة مع البرنامج
create or replace function public.create_course(p_name text, p_year text, p_term int, p_level int, p_track text, p_program text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; prog text := coalesce(nullif(trim(p_program), ''), 'عام'); tr text := norm_track(p_level, p_track, prog); r text := staff_role();
begin
  if coalesce(r, '') not in ('admin', 'lecturer')
     and not (r = 'ta' and (select ta_can_create from settings)) then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr, prog);
  insert into courses(name, owner_email, academic_year, term, level, track, program)
    values (trim(p_name), my_email(), p_year, p_term, p_level, tr, prog) returning id into cid;
  perform log_audit(cid, 'أنشأ المادة · ' || course_label(p_year, p_term, p_level, tr, prog));
  return cid;
end $$;

-- الصيغة السابقة (دون البرنامج) تبقى للتوافق، وتعني البرنامج العام
create or replace function public.create_course(p_name text, p_year text, p_term int, p_level int, p_track text) returns uuid
language sql security definer set search_path = public as $$
  select create_course(p_name, p_year, p_term, p_level, p_track, 'عام')
$$;

create or replace function public.update_course_info(cid uuid, p_name text, p_year text, p_term int, p_level int, p_track text, p_program text) returns void
language plpgsql security definer set search_path = public as $$
declare c courses; prog text := coalesce(nullif(trim(p_program), ''), 'عام'); tr text := norm_track(p_level, p_track, prog); changes text[] := '{}';
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  perform check_classification(p_year, p_term, p_level, tr, prog);
  select * into c from courses where id = cid;
  if c.name is distinct from trim(p_name) then changes := changes || ('الاسم إلى «' || trim(p_name) || '»'); end if;
  if row(c.academic_year, c.term, c.level, c.track, c.program) is distinct from row(p_year, p_term, p_level, tr, prog) then
    changes := changes || ('التصنيف إلى ' || course_label(p_year, p_term, p_level, tr, prog));
  end if;
  if array_length(changes, 1) is null then return; end if;
  update courses set name = trim(p_name), academic_year = p_year, term = p_term, level = p_level, track = tr, program = prog where id = cid;
  perform log_audit(cid, 'غيّر ' || array_to_string(changes, ' و'));
end $$;

create or replace function public.update_course_info(cid uuid, p_name text, p_year text, p_term int, p_level int, p_track text) returns void
language sql security definer set search_path = public as $$
  select update_course_info(cid, p_name, p_year, p_term, p_level, p_track, (select program from courses where id = cid))
$$;

create or replace function public.student_home(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object(
    'code', code,
    'name', (select name from enrollments where student_code = code limit 1),
    'now_ms', floor(extract(epoch from now()) * 1000)::bigint,
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'grp', e.grp,
        'label', course_label(c.academic_year, c.term, c.level, c.track, c.program),
        'absences', x.ab,
        'level', warn_level(x.ab),
        'seen', coalesce((select max(w.level) from warning_notices w where w.course_id = c.id and w.student_code = code), 0),
        'missed', coalesce((
          select json_agg(json_build_object('n', s.n, 'at', s.started_at) order by s.started_at)
          from sessions s
          where s.course_id = c.id and (s.ended or s.closed_at is not null or now() >= s.ends_at)
            and (s.grp is null or s.grp = e.grp)
            and not exists (select 1 from attendance a where a.session_id = s.id and a.student_code = code and a.status <> 'pending')), '[]'::json),
        'session', (
          select json_build_object('id', s.id, 'n', s.n, 'grp', s.grp, 'allow_makeup', s.allow_makeup, 'kind', s.kind,
            'open', (s.closed_at is null and now() < s.ends_at),
            'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint,
            'own', (s.grp is null or s.grp = e.grp),
            'tries_left', 5 - (select count(*) from attempts t where t.session_id = s.id and t.student_code = code and t.counts_as_try),
            'mine', (select json_build_object('status', a.status, 'reason', a.reason, 'makeup', a.makeup, 'at', a.at, 'via', a.via)
                     from attendance a where a.session_id = s.id and a.student_code = code))
          from sessions s where s.course_id = c.id and not s.ended)
      ) order by c.level nulls last, c.name)
      from enrollments e join courses c on c.id = e.course_id
        cross join lateral (select course_absences(c.id, code) as ab) x
      where e.student_code = code and not c.archived), '[]'::json));
end $$;

revoke execute on function public.course_label(text, int, int, text, text), public.check_classification(text, int, int, text, text),
  public.norm_track(int, text, text) from public, anon, authenticated;
revoke execute on function public.create_course(text, text, int, int, text, text),
  public.update_course_info(uuid, text, text, int, int, text, text) from public, anon;
grant execute on function public.create_course(text, text, int, int, text, text),
  public.update_course_info(uuid, text, text, int, int, text, text) to authenticated;
revoke execute on function public.student_home(text) from public;
grant execute on function public.student_home(text) to anon, authenticated;


-- =====================================================================
-- تحديث 12: التكليفات وتسليم الطلبة ورصد الدرجات، وربط المادة بمقرر اللائحة
--   • يضيف فريق المادة تكليفات (مشروع، بحث، اسكتش…) لكل منها درجة عظمى وموعد تسليم.
--   • يسلّم الطالب من التطبيق: يُرفع الملف إلى Google Drive الخاص بالطالب نفسه،
--     ويُحفظ هنا رابط الملف وبصمته (md5 والحجم ووقت التعديل) لاكتشاف أي تعديل بعد التسليم.
--   • يرصد المحاضر أو المعيد الدرجة والدرجة الإضافية (بونص) والملاحظة، ثم تُعلن الدرجات للطلبة.
--   • تكليف «رصد يدوي»: بلا تسليم من الطالب، لرصد درجات عمل سُلِّم ورقيًّا أو في المرسم.
--   • تُحفظ في المادة بيانات اللائحة: كود المقرر والنهاية العظمى للأعمال الفصلية والامتحان.

-- ---------- بيانات اللائحة في المادة ----------
alter table public.courses add column if not exists bylaw_code text not null default '';
alter table public.courses add column if not exists cw_max int check (cw_max is null or cw_max between 0 and 1000);
alter table public.courses add column if not exists exam_max int check (exam_max is null or exam_max between 0 and 1000);
alter table public.courses add column if not exists credits int check (credits is null or credits between 0 and 30);

create or replace function public.set_course_bylaw(cid uuid, p_code text, p_cw int, p_exam int, p_credits int) returns void
language plpgsql security definer set search_path = public as $$
declare c courses;
begin
  if not course_owner(cid) then raise exception 'not_allowed'; end if;
  if p_cw is not null and p_cw not between 0 and 1000 or p_exam is not null and p_exam not between 0 and 1000 then raise exception 'bad_grade'; end if;
  select * into c from courses where id = cid;
  if row(c.bylaw_code, c.cw_max, c.exam_max, c.credits) is not distinct from row(trim(coalesce(p_code, '')), p_cw, p_exam, p_credits) then return; end if;
  update courses set bylaw_code = trim(coalesce(p_code, '')), cw_max = p_cw, exam_max = p_exam, credits = p_credits where id = cid;
  perform log_audit(cid, 'ربط المادة بمقرر اللائحة ' || coalesce(nullif(trim(p_code), ''), '—')
    || ' · أعمال فصلية ' || coalesce(p_cw::text, '—') || ' · امتحان ' || coalesce(p_exam::text, '—'));
end $$;

-- ---------- التكليفات ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  details text not null default '' check (length(details) <= 4000),
  max_grade numeric(6,2) not null check (max_grade > 0 and max_grade <= 1000),
  due_at timestamptz not null,
  late text not null default 'accept' check (late in ('accept', 'close')),
  mode text not null default 'submit' check (mode in ('submit', 'manual')),
  grp text,
  released boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists tasks_course on public.tasks(course_id, due_at);

-- ---------- التسليمات والدرجات (صف لكل طالب في كل تكليف) ----------
create table if not exists public.submissions (
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_code text not null,
  kind text check (kind in ('drive', 'link')),
  url text check (url is null or length(url) <= 1000),
  file_id text check (file_id is null or file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  file_name text check (file_name is null or length(file_name) <= 300),
  mime text check (mime is null or length(mime) <= 200),
  size bigint,
  md5 text check (md5 is null or md5 ~ '^[0-9a-f]{32}$'),
  file_modified timestamptz,
  note text not null default '' check (length(note) <= 1000),
  submitted_at timestamptz,
  late boolean not null default false,
  version int not null default 0,
  grade numeric(6,2),
  bonus numeric(6,2) not null default 0 check (bonus >= 0 and bonus <= 1000),
  feedback text not null default '' check (length(feedback) <= 2000),
  graded_by text,
  graded_at timestamptz,
  check_state text check (check_state in ('ok', 'changed', 'missing')),
  checked_at timestamptz,
  primary key (task_id, student_code)
);
create index if not exists submissions_code on public.submissions(student_code);

create or replace function public.task_course(tid uuid) returns uuid
language sql stable security definer set search_path = public as $$ select course_id from tasks where id = tid $$;

alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (course_role(course_id) is not null);
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions for select to authenticated using (course_role(task_course(task_id)) is not null);
revoke all on public.tasks, public.submissions from anon;
revoke insert, update, delete on public.tasks, public.submissions from authenticated;
grant select on public.tasks, public.submissions to authenticated;

-- ---------- فريق المادة: إدارة التكليفات (صاحب المادة والمحاضر المشارك) ----------
create or replace function public.check_task_fields(p_title text, p_max numeric, p_due timestamptz, p_late text) returns void
language plpgsql immutable as $$
begin
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'title_required'; end if;
  if p_max is null or p_max <= 0 or p_max > 1000 then raise exception 'bad_grade'; end if;
  if p_due is null then raise exception 'due_required'; end if;
  if coalesce(p_late, '') not in ('accept', 'close') then raise exception 'bad_late'; end if;
end $$;

-- صلاحية التعديل على تكليف: صاحب المادة والمحاضر المشارك، أو المعيد الذي أضافه
create or replace function public.can_edit_task(t tasks) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(course_role(t.course_id), '') = 'owner' or (course_role(t.course_id) = 'ta' and t.created_by = my_email())
$$;

create or replace function public.create_task(cid uuid, p_title text, p_details text, p_max numeric, p_due timestamptz, p_late text, p_grp text, p_mode text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; g text := nullif(trim(coalesce(p_grp, '')), ''); m text := coalesce(nullif(p_mode, ''), 'submit');
begin
  if coalesce(course_role(cid), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if m not in ('submit', 'manual') then raise exception 'bad_mode'; end if;
  perform check_task_fields(p_title, p_max, coalesce(p_due, case when m = 'manual' then now() end), p_late);
  insert into tasks(course_id, title, details, max_grade, due_at, late, mode, grp, created_by)
    values (cid, trim(p_title), trim(coalesce(p_details, '')), p_max, coalesce(p_due, now()), p_late, m, g, my_email()) returning id into tid;
  perform log_audit(cid, case when m = 'manual' then 'أضاف رصدًا يدويًّا «' else 'أضاف التكليف «' end || trim(p_title) || '» · الدرجة العظمى ' || trim_scale(p_max) || coalesce(' · مجموعة ' || g, ''));
  return tid;
end $$;

create or replace function public.create_task(cid uuid, p_title text, p_details text, p_max numeric, p_due timestamptz, p_late text, p_grp text) returns uuid
language sql security definer set search_path = public as $$ select create_task(cid, p_title, p_details, p_max, p_due, p_late, p_grp, 'submit') $$;

create or replace function public.update_task(tid uuid, p_title text, p_details text, p_max numeric, p_due timestamptz, p_late text, p_grp text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; g text := nullif(trim(coalesce(p_grp, '')), '');
begin
  select * into t from tasks where id = tid;
  if t.id is null or not can_edit_task(t) then raise exception 'not_allowed'; end if;
  perform check_task_fields(p_title, p_max, coalesce(p_due, t.due_at), p_late);
  if p_max < coalesce((select max(grade) from submissions where task_id = tid), 0) then raise exception 'max_below_grades'; end if;
  update tasks set title = trim(p_title), details = trim(coalesce(p_details, '')), max_grade = p_max, due_at = coalesce(p_due, t.due_at), late = p_late, grp = g where id = tid;
  perform log_audit(t.course_id, 'عدّل التكليف «' || trim(p_title) || '»'
    || case when t.due_at <> coalesce(p_due, t.due_at) then ' · موعد التسليم' else '' end
    || case when t.max_grade <> p_max then ' · الدرجة العظمى من ' || trim_scale(t.max_grade) || ' إلى ' || trim_scale(p_max) else '' end);
end $$;

create or replace function public.delete_task(tid uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; n int;
begin
  select * into t from tasks where id = tid;
  if t.id is null or not can_edit_task(t) then raise exception 'not_allowed'; end if;
  select count(*) into n from submissions where task_id = tid and (submitted_at is not null or grade is not null);
  if n > 0 and trim(coalesce(p_confirm, '')) <> trim(t.title) then raise exception 'confirm_mismatch'; end if;
  delete from tasks where id = tid;
  perform log_audit(t.course_id, 'حذف التكليف «' || t.title || '»' || case when n > 0 then ' وما فيه من ' || n || ' تسليم ودرجة' else '' end);
end $$;

create or replace function public.set_task_released(tid uuid, p_released boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = tid;
  if t.id is null or not can_edit_task(t) then raise exception 'not_allowed'; end if;
  if t.released = p_released then return; end if;
  update tasks set released = p_released where id = tid;
  perform log_audit(t.course_id, case when p_released then 'أعلن درجات التكليف «' else 'أخفى درجات التكليف «' end || t.title || '» عن الطلبة');
end $$;

-- ---------- رصد الدرجات: صاحب المادة والمحاضر المشارك والمعيد ----------
-- rows: [{"code":"2023101","grade":18.5,"bonus":1,"feedback":"..."}]   grade = null يمسح الدرجة، وغياب bonus يُبقيه كما هو
-- p_source: مصدر الرصد في السجل (مثلًا «من ملف إكسل …»)
create or replace function public.grade_many(tid uuid, rows jsonb, p_source text) returns int
language plpgsql security definer set search_path = public as $$
declare t tasks; r jsonb; g numeric; b numeric; fb text; n int := 0; code text; old submissions;
begin
  select * into t from tasks where id = tid;
  if t.id is null or coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 2000 then raise exception 'bad_rows'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    code := trim(r->>'code');
    if not exists (select 1 from enrollments where course_id = t.course_id and student_code = code) then raise exception 'not_found'; end if;
    g := case when r->'grade' is null or jsonb_typeof(r->'grade') = 'null' then null else (r->>'grade')::numeric end;
    if g is not null and (g < 0 or g > t.max_grade) then raise exception 'grade_range'; end if;
    b := case when r ? 'bonus' then coalesce(nullif(r->>'bonus', '')::numeric, 0) else null end;
    if b is not null and (b < 0 or b > t.max_grade) then raise exception 'bonus_range'; end if;
    select * into old from submissions where task_id = tid and student_code = code;
    fb := case when r ? 'feedback' then left(trim(coalesce(r->>'feedback', '')), 2000) else coalesce(old.feedback, '') end;
    b := coalesce(b, old.bonus, 0);
    if old.task_id is not null and old.grade is not distinct from g and old.bonus = b and old.feedback = fb then continue; end if;
    if old.task_id is null and g is null and b = 0 and fb = '' then continue; end if;
    insert into submissions(task_id, student_code, grade, bonus, feedback, graded_by, graded_at)
      values (tid, code, g, b, fb, my_email(), now())
    on conflict (task_id, student_code) do update set
      grade = excluded.grade, bonus = excluded.bonus, feedback = excluded.feedback, graded_by = excluded.graded_by, graded_at = excluded.graded_at;
    n := n + 1;
  end loop;
  if n > 0 then perform log_audit(t.course_id, 'رصد درجات التكليف «' || t.title || '» لـ ' || n || ' طالب' || coalesce(' · ' || nullif(trim(p_source), ''), '')); end if;
  return n;
end $$;

create or replace function public.grade_many(tid uuid, rows jsonb) returns int
language sql security definer set search_path = public as $$ select grade_many(tid, rows, null) $$;

-- نتيجة فحص الملفات على Google Drive (يُجرى من متصفح فريق المادة)
-- rows: [{"code":"2023101","state":"ok|changed|missing"}]
create or replace function public.record_checks(tid uuid, rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = tid;
  if t.id is null or coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  update submissions s set check_state = x.state, checked_at = now()
  from jsonb_to_recordset(rows) as x(code text, state text)
  where s.task_id = tid and s.student_code = x.code and x.state in ('ok', 'changed', 'missing') and s.kind = 'drive';
end $$;

-- ---------- الطالب ----------
create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'open', (now() <= t.due_at or t.late = 'accept'),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code))
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

-- p_kind: 'drive' (رُفع الملف إلى Drive الطالب من التطبيق) أو 'link' (رابط يكتبه الطالب)
create or replace function public.student_submit(p_token text, tid uuid, p_kind text, p_url text, p_file_id text, p_name text,
  p_mime text, p_size bigint, p_md5 text, p_modified timestamptz, p_note text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); t tasks; e enrollments; s submissions; lt boolean; u text := trim(coalesce(p_url, ''));
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if t.mode <> 'submit' then raise exception 'manual_task'; end if;
  select * into e from enrollments where course_id = t.course_id and student_code = code;
  select * into s from submissions where task_id = tid and student_code = code;
  -- تكليف مجموعة أخرى: مسموح فقط لو للطالب تسليم فيه من قبل (مثلًا نُقل من تلك المجموعة)
  if e.student_code is null or (t.grp is not null and t.grp <> e.grp and s.task_id is null)
     or (select archived from courses where id = t.course_id) then raise exception 'not_found'; end if;
  lt := now() > t.due_at;
  if lt and t.late = 'close' then raise exception 'task_closed'; end if;
  if s.grade is not null then raise exception 'already_graded'; end if;
  if coalesce(s.version, 0) >= 30 then raise exception 'too_many_versions'; end if;
  if p_kind = 'drive' then
    if u !~ '^https://(drive|docs)\.google\.com/' or coalesce(p_file_id, '') !~ '^[A-Za-z0-9_-]{10,200}$'
       or coalesce(p_md5, '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_file'; end if;
  elsif p_kind = 'link' then
    if u !~ '^https://[^\s/$.?#][^\s]*$' or length(u) > 1000 then raise exception 'bad_link'; end if;
    p_file_id := null; p_md5 := null; p_size := null; p_mime := null; p_modified := null;
  else raise exception 'bad_file'; end if;
  insert into submissions(task_id, student_code, kind, url, file_id, file_name, mime, size, md5, file_modified, note, submitted_at, late, version)
    values (tid, code, p_kind, u, p_file_id, left(trim(coalesce(p_name, '')), 300), left(p_mime, 200), p_size, p_md5, p_modified,
            left(trim(coalesce(p_note, '')), 1000), now(), lt, 1)
  on conflict (task_id, student_code) do update set
    kind = excluded.kind, url = excluded.url, file_id = excluded.file_id, file_name = excluded.file_name, mime = excluded.mime,
    size = excluded.size, md5 = excluded.md5, file_modified = excluded.file_modified, note = excluded.note,
    submitted_at = excluded.submitted_at, late = excluded.late, version = submissions.version + 1,
    check_state = null, checked_at = null;
  return json_build_object('submitted_at', now(), 'late', lt, 'version', coalesce(s.version, 0) + 1);
end $$;

revoke execute on function public.task_course(uuid), public.check_task_fields(text, numeric, timestamptz, text), public.can_edit_task(tasks) from public, anon;
grant execute on function public.task_course(uuid) to authenticated;
revoke execute on function public.set_course_bylaw(uuid, text, int, int, int),
  public.create_task(uuid, text, text, numeric, timestamptz, text, text),
  public.create_task(uuid, text, text, numeric, timestamptz, text, text, text),
  public.update_task(uuid, text, text, numeric, timestamptz, text, text),
  public.delete_task(uuid, text), public.set_task_released(uuid, boolean),
  public.grade_many(uuid, jsonb), public.grade_many(uuid, jsonb, text), public.record_checks(uuid, jsonb) from public, anon;
grant execute on function public.set_course_bylaw(uuid, text, int, int, int),
  public.create_task(uuid, text, text, numeric, timestamptz, text, text),
  public.create_task(uuid, text, text, numeric, timestamptz, text, text, text),
  public.update_task(uuid, text, text, numeric, timestamptz, text, text),
  public.delete_task(uuid, text), public.set_task_released(uuid, boolean),
  public.grade_many(uuid, jsonb), public.grade_many(uuid, jsonb, text), public.record_checks(uuid, jsonb) to authenticated;
revoke execute on function public.student_tasks(text),
  public.student_submit(text, uuid, text, text, text, text, text, bigint, text, timestamptz, text) from public;
grant execute on function public.student_tasks(text),
  public.student_submit(text, uuid, text, text, text, text, text, bigint, text, timestamptz, text) to anon, authenticated;



-- =====================================================================
-- تحديث 13: تسجيل الحضور بمسح رمز QR يتغيّر كل 15 ثانية
--   • يعرض المحاضر على جهاز العرض رمز QR يتغيّر كل 15 ثانية، بجانب الرمز الرقمي (يبقى الرقمي صالحًا كما هو).
--   • يمسحه الطالب بكاميرا هاتفه أو من داخل التطبيق، فيُسجَّل حضوره بالشروط نفسها: الحساب المرتبط بهاتفه، والموقع داخل النطاق.
--   • الرمز صالح 15 ثانية، ويُقبل السابق 15 ثانية أخرى، فلا تنفع صورة الشاشة المرسلة لاحقًا.

create or replace function public.qr_live_step() returns bigint
language sql stable as $$ select floor(extract(epoch from now()) / 15)::bigint $$;

create or replace function public.session_qr_token(p_secret bytea, p_step bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select substr(encode(hmac(('qr:' || p_step)::bytea, p_secret, 'sha256'), 'hex'), 1, 12)
$$;

-- لفريق المادة: رمز QR الحالي
create or replace function public.current_qr(sid uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s sessions; sec bytea; st bigint := qr_live_step();
begin
  select * into s from sessions where id = sid;
  if s.id is null or coalesce(course_role(s.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if s.ended or s.closed_at is not null or now() >= s.ends_at then return json_build_object('open', false); end if;
  select secret into sec from session_secrets where session_id = sid;
  return json_build_object('open', true, 'token', session_qr_token(sec, st),
    'ms_left', ((st + 1) * 15000 - floor(extract(epoch from now()) * 1000))::bigint,
    'step_ms', 15000,
    'ends_in_ms', floor(extract(epoch from (s.ends_at - now())) * 1000)::bigint);
end $$;

-- للطالب: التسجيل برمز QR. عند صحة الرمز تُطبَّق كل شروط التسجيل بالرمز الرقمي كما هي.
create or replace function public.student_check_in_qr(p_token text, sid uuid, p_qr text,
  p_lat double precision, p_lng double precision, p_acc double precision, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); sec bytea; st bigint := qr_live_step(); q text := lower(trim(coalesce(p_qr, ''))); r json; i int;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from sessions where id = sid) then return json_build_object('result', 'closed'); end if;
  select secret into sec from session_secrets where session_id = sid;
  if q <> '' and (q = session_qr_token(sec, st) or q = session_qr_token(sec, st - 1)) then
    r := student_check_in(p_token, sid, totp_code(sec, current_step()), p_lat, p_lng, p_acc, p_device);
    if r->>'result' in ('present', 'pending') then
      update attendance set via = 'qr' where session_id = sid and student_code = code and via = '';
    end if;
    return r;
  end if;
  if exists (select 1 from enrollments e join sessions s on s.course_id = e.course_id where s.id = sid and e.student_code = code)
     and not exists (select 1 from attendance where session_id = sid and student_code = code) then
    for i in 2..240 loop
      if q = session_qr_token(sec, st - i) then
        insert into attempts(session_id, student_code, reason) values (sid, code, 'old_qr_code');
        return json_build_object('result', 'rejected', 'reason', 'expired_qr');
      end if;
    end loop;
    insert into attempts(session_id, student_code, reason) values (sid, code, 'bad_qr_code');
  end if;
  if exists (select 1 from attendance where session_id = sid and student_code = code) then
    return student_check_in(p_token, sid, '', p_lat, p_lng, p_acc, p_device); -- يُرجع «سُجِّل من قبل»
  end if;
  return json_build_object('result', 'rejected', 'reason', 'bad_qr');
end $$;

revoke execute on function public.qr_live_step(), public.session_qr_token(bytea, bigint) from public, anon, authenticated;
revoke execute on function public.current_qr(uuid), public.student_check_in_qr(text, uuid, text, double precision, double precision, double precision, text) from public;
revoke execute on function public.current_qr(uuid) from anon;
grant execute on function public.current_qr(uuid) to authenticated;
grant execute on function public.student_check_in_qr(text, uuid, text, double precision, double precision, double precision, text) to anon, authenticated;



-- =====================================================================
-- تحديث 14: البرنامج الخاص (برنامج تصميم العمارة الداخلية، لائحة 2023) خمسة مستويات بدلًا من أربعة،
-- وتصحيح أسماء المواد الحالية إلى أسمائها في اللائحة مع كود المقرر ودرجاته العظمى.

alter table public.courses drop constraint if exists courses_classification_ok;
alter table public.courses add constraint courses_classification_ok check (
  (academic_year is null or academic_year ~ '^\d{4}/\d{4}$')
  and (term is null or term in (1, 2, 3))
  and dept = 'الديكور'
  and program in ('عام', 'خاص')
  and ((level is null and track = '')
    or (program = 'عام' and level between 1 and 2 and track = '')
    or (program = 'عام' and level between 3 and 5 and track in ('عمارة داخلية', 'سينوغرافيا'))
    or (program = 'خاص' and level between 1 and 5 and track = 'عمارة داخلية')));

create or replace function public.check_classification(y text, t int, l int, tr text, prog text) returns void
language plpgsql immutable as $$
begin
  if y is null or y !~ '^\d{4}/\d{4}$' or split_part(y, '/', 2)::int <> split_part(y, '/', 1)::int + 1 then raise exception 'bad_year'; end if;
  if t is null or t not in (1, 2, 3) then raise exception 'bad_term'; end if;
  if prog is null or prog not in ('عام', 'خاص') then raise exception 'bad_program'; end if;
  if prog = 'خاص' then
    if l is null or l not between 1 and 5 then raise exception 'bad_level_private'; end if;
    if tr is distinct from 'عمارة داخلية' then raise exception 'track_private'; end if;
    return;
  end if;
  if l is null or l not between 1 and 5 then raise exception 'bad_level'; end if;
  if l <= 2 and coalesce(tr, '') <> '' then raise exception 'track_not_allowed'; end if;
  if l >= 3 and coalesce(tr, '') not in ('عمارة داخلية', 'سينوغرافيا') then raise exception 'track_required'; end if;
end $$;



-- تحديث 15: الطالب ينقل حسابه بنفسه إلى هاتف أو متصفح جديد (بدل ما يروح للمحاضر يفك الربط)
--   • بكود الطالب وكلمة السر، مرة كل 3 أيام بحد أقصى 4 مرات في 30 يومًا.
--   • يُرفض لو الهاتف الجديد مربوط بطالب آخر.
--   • يُسجَّل في سجل تعديلات كل مواد الطالب، وأي حضور خلال 12 ساعة من النقل ينتظر موافقة المحاضر.
--   • نحفظ اسم المتصفح المربوط (مثل «Chrome · Android») ليعرف الطالب من أين يدخل.

alter table public.students add column if not exists device_label text;
alter table public.students add column if not exists device_bound_at timestamptz;

create table if not exists public.device_moves (
  id bigserial primary key,
  student_code text not null references public.students(student_code) on delete cascade,
  at timestamptz not null default now(),
  old_label text,
  new_label text
);
create index if not exists device_moves_code on public.device_moves(student_code, at desc);
alter table public.device_moves enable row level security;  -- من غير policy: مقفول، والقراءة من الدوال فقط

create or replace function public.students_bound_at() returns trigger
language plpgsql as $$
begin
  if new.device_id is distinct from old.device_id then new.device_bound_at := case when new.device_id is null then null else now() end; end if;
  return new;
end $$;
create or replace trigger students_bound_at before update of device_id on public.students for each row execute function public.students_bound_at();

create or replace function public.clean_label(l text) returns text
language sql immutable as $$ select nullif(left(regexp_replace(coalesce(l, ''), '[^[:alnum:][:space:]·()._/-]', '', 'g'), 60), '') $$;

-- دخول/تسجيل مع اسم المتصفح (الدوال القديمة تبقى كما هي)
create or replace function public.student_login(p_code text, p_password text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r json := student_login(p_code, p_password, p_device);
begin
  update students set device_label = clean_label(p_label)
    where student_code = trim(coalesce(p_code, '')) and device_id = p_device and clean_label(p_label) is not null;
  return r;
end $$;

create or replace function public.student_register(p_code text, p_password text, p_pin text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r json := student_register(p_code, p_password, p_pin, p_device);
begin
  update students set device_label = clean_label(p_label), device_bound_at = now()
    where student_code = trim(coalesce(p_code, '')) and device_id = p_device;
  return r;
end $$;

-- نقل الحساب: p_confirm=false يرجع معلومات فقط (بعد التحقق من كلمة السر)، true ينفّذ النقل
create or replace function public.student_move_device(p_code text, p_password text, p_device text, p_label text, p_confirm boolean) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); st students; last_at timestamptz; n30 int; nxt timestamptz; lbl text := clean_label(p_label);
begin
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  select * into st from students where student_code = code;
  if st.student_code is null then raise exception 'not_registered'; end if;
  if crypt(coalesce(p_password, ''), st.pass_hash) <> st.pass_hash then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_password');
  end if;
  if st.device_id = p_device then  -- نفس الهاتف أصلًا: دخول عادي
    return json_build_object('token', issue_token(code), 'name', (select name from enrollments where student_code = code limit 1), 'same', true);
  end if;
  select max(at), count(*) filter (where at > now() - interval '30 days') into last_at, n30 from device_moves where student_code = code;
  nxt := greatest(last_at + interval '3 days',
    case when n30 >= 4 then (select min(at) + interval '30 days' from (select at from device_moves where student_code = code order by at desc limit 4) x) end);
  if nxt <= now() then nxt := null; end if;
  if not coalesce(p_confirm, false) then
    return json_build_object('info', true, 'label', st.device_label, 'bound_at', st.device_bound_at, 'next_at', nxt);
  end if;
  if nxt is not null then raise exception 'move_too_soon'; end if;
  if exists (select 1 from students where device_id = p_device and student_code <> code) then raise exception 'device_taken'; end if;
  insert into device_moves(student_code, old_label, new_label) values (code, st.device_label, lbl);
  update students set device_id = p_device, device_label = lbl, qr_key = gen_random_bytes(32) where student_code = code;
  update student_tokens set expires_at = now() - interval '1 second' where student_code = code;  -- تنتهي جلسات المتصفح القديم
  insert into audit(actor, course_id, action)
    select e.name, e.course_id, 'نقل حسابه بنفسه إلى ' || coalesce(lbl, 'هاتف جديد')
      || case when st.device_label is not null then ' (كان مربوطًا بـ ' || st.device_label || ')' else '' end
      || '. حضوره خلال 12 ساعة ينتظر موافقتك.'
    from enrollments e join courses c on c.id = e.course_id where e.student_code = code and not c.archived;
  return json_build_object('token', issue_token(code), 'name', (select name from enrollments where student_code = code limit 1), 'moved', true);
end $$;

-- لفريق المادة: الربط + اسم المتصفح + آخر نقل لكل طالب
create or replace function public.course_bindings2(cid uuid)
returns table(student_code text, registered boolean, device_bound boolean, device_label text, moved_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if course_role(cid) is null then raise exception 'not_allowed'; end if;
  return query select e.student_code, s.student_code is not null, s.device_id is not null, s.device_label,
      (select max(m.at) from device_moves m where m.student_code = e.student_code)
    from enrollments e left join students s on s.student_code = e.student_code where e.course_id = cid;
end $$;

-- الحضور: نفس الدالة + حالة «هاتف جديد»
create or replace function public.student_check_in(p_token text, sid uuid, p_code text,
  p_lat double precision, p_lng double precision, p_acc double precision, p_device text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  code text := student_from_token(p_token);
  st students; s sessions; e enrollments; a attendance; sec bytea;
  tries int; makeup boolean := false; cur bigint := current_step(); i int;
  entered text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  dist int; acc int := case when p_acc is null then null else round(p_acc)::int end;
  other text;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into st from students where student_code = code;
  if st.device_id is distinct from p_device then raise exception 'device_mismatch'; end if;

  select * into s from sessions where id = sid for update;
  if s.id is null or s.ended or s.closed_at is not null or now() >= s.ends_at then
    return json_build_object('result', 'closed');
  end if;
  select * into e from enrollments where course_id = s.course_id and student_code = code;
  if e.student_code is null then return json_build_object('result', 'rejected', 'reason', 'not_enrolled'); end if;

  select * into a from attendance where session_id = sid and student_code = code;
  if a.session_id is not null then
    return json_build_object('result', case when a.status = 'pending' then 'pending' else 'already' end, 'reason', a.reason, 'makeup', a.makeup);
  end if;

  select count(*) into tries from attempts where session_id = sid and student_code = code and counts_as_try;
  if tries >= 5 then return json_build_object('result', 'locked'); end if;

  select student_code into other from attendance where session_id = sid and device_id = p_device and student_code <> code limit 1;
  if other is not null then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'device_used');
    return json_build_object('result', 'rejected', 'reason', 'device_used');
  end if;

  if s.grp is not null and s.grp <> e.grp then
    if not s.allow_makeup then
      insert into attempts(session_id, student_code, reason) values (sid, code, 'other_group');
      return json_build_object('result', 'rejected', 'reason', 'other_group', 'session_grp', s.grp, 'my_grp', e.grp);
    end if;
    makeup := true;
  end if;

  select secret into sec from session_secrets where session_id = sid;
  if entered <> totp_code(sec, cur) and not (entered = totp_code(sec, cur - 1) and code_step_age() < 30) then
    for i in 1..40 loop
      if entered = totp_code(sec, cur - i) then
        insert into attempts(session_id, student_code, reason, counts_as_try) values (sid, code, 'expired_code', true);
        return json_build_object('result', 'rejected', 'reason', 'expired_code', 'tries_left', 4 - tries);
      end if;
    end loop;
    insert into attempts(session_id, student_code, reason, counts_as_try) values (sid, code, 'wrong_code', true);
    return json_build_object('result', 'rejected', 'reason', 'wrong_code', 'tries_left', 4 - tries);
  end if;

  if s.lat is not null and p_lat is not null then
    dist := round(2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - s.lat) / 2), 2) +
      cos(radians(s.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.lng) / 2), 2))));
  end if;

  if s.lat is not null and p_lat is null then
    insert into attendance(session_id, student_code, status, makeup, reason, device_id)
      values (sid, code, 'pending', makeup, case when makeup then 'تعويض · ' else '' end || 'دون إذن الموقع', p_device);
    return json_build_object('result', 'pending', 'reason', 'no_location', 'makeup', makeup);
  end if;
  if s.lat is not null and acc > 100 then
    insert into attendance(session_id, student_code, status, makeup, reason, dist, acc, device_id)
      values (sid, code, 'pending', makeup, case when makeup then 'تعويض · ' else '' end || 'إشارة GPS ضعيفة (دقة ' || acc || ' م)', dist, acc, p_device);
    return json_build_object('result', 'pending', 'reason', 'weak_gps', 'acc', acc, 'dist', dist, 'makeup', makeup);
  end if;
  if s.lat is not null and dist > s.radius then
    insert into attempts(session_id, student_code, reason) values (sid, code, 'too_far:' || dist);
    return json_build_object('result', 'rejected', 'reason', 'too_far', 'dist', dist, 'radius', s.radius);
  end if;

  -- نقل الطالب حسابه بنفسه إلى هاتف/متصفح آخر خلال آخر 12 ساعة: الحضور ينتظر موافقة المحاضر
  if exists (select 1 from device_moves where student_code = code and at > now() - interval '12 hours') then
    insert into attendance(session_id, student_code, status, makeup, reason, dist, acc, device_id)
      values (sid, code, 'pending', makeup, case when makeup then 'تعويض · ' else '' end || 'هاتف جديد: نقل الطالب حسابه إليه اليوم', dist, acc, p_device);
    return json_build_object('result', 'pending', 'reason', 'new_device', 'dist', dist, 'makeup', makeup);
  end if;

  insert into attendance(session_id, student_code, status, makeup, reason, dist, acc, device_id)
    values (sid, code, 'present', makeup,
            case when makeup then 'حضور تعويضي' else '' end || case when s.lat is null then ' دون التحقق من الموقع' else '' end,
            dist, acc, p_device);
  return json_build_object('result', 'present', 'dist', dist, 'makeup', makeup, 'no_geo', s.lat is null);
end $$;


revoke execute on function public.students_bound_at(), public.clean_label(text) from public, anon, authenticated;
revoke execute on function public.student_login(text, text, text, text), public.student_register(text, text, text, text, text),
  public.student_move_device(text, text, text, text, boolean), public.course_bindings2(uuid) from public, anon;
grant execute on function public.student_login(text, text, text, text), public.student_register(text, text, text, text, text),
  public.student_move_device(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.course_bindings2(uuid) to authenticated;

-- تحديث 17: التسجيل الأكاديمي باستمارة التسجيل (نظام ابن الهيثم)
--   • الطالب يرفع استمارة التسجيل، فيقرأ التطبيق على هاتفه كوده واسمه ومستواه والمقررات المسجلة.
--   • يُضاف الطالب إلى مادة كل مقرر في العام والفصل الحاليين، وإن لم تكن المادة موجودة يُنشئها النظام
--     (صاحبها المسؤول، ويعيّن لها فريقها). المقررات تُطابق بلائحة القسم (bylaw_courses) فقط.
--   • الطالب المُضاف بالاستمارة يظهر للمحاضر بعلامة «بالاستمارة»، ولو أزاله المحاضر لا يستطيع إضافة نفسه مرة أخرى.

alter table public.enrollments add column if not exists source text not null default '';
alter table public.enrollments add column if not exists added_at timestamptz;
alter table public.courses add column if not exists auto_created boolean not null default false;

create table if not exists public.enrollment_blocks (
  course_id uuid not null references public.courses(id) on delete cascade,
  student_code text not null,
  at timestamptz not null default now(),
  active boolean not null default true,
  primary key (course_id, student_code)
);
alter table public.enrollment_blocks enable row level security;

create table if not exists public.form_regs (
  id bigserial primary key,
  student_code text not null,
  at timestamptz not null default now(),
  via text not null,
  items int not null default 0
);
create index if not exists form_regs_code on public.form_regs(student_code, at desc);
alter table public.form_regs enable row level security;

-- مقررات اللائحتين (نسخة من catalog.js بنفس الترتيب: id = رقم المقرر في CATALOG)
create table if not exists public.bylaw_courses (
  id int primary key,
  prog text not null,
  code text not null,
  prefix text not null default '',
  name text not null,
  level int,
  sem int,
  track text not null default '',
  elective text not null default '',
  credits int,
  cw int,
  ex int
);
alter table public.bylaw_courses enable row level security;

insert into public.bylaw_courses(id, prog, code, prefix, name, level, sem, track, elective, credits, cw, ex) values
(0,'عام','40101','ديك','تصميم 1',1,1,'','',3,100,0),
(1,'عام','40102','ديك','التشكيل و أسس التصميم 1',1,1,'','',2,100,0),
(2,'عام','40103','ديك','دراسة المرئيات 1',1,1,'','',2,100,0),
(3,'عام','40104','ديك','الإسقاط الهندسي 1',1,1,'','',2,100,0),
(4,'عام','40105','','التشريح الفنى',1,1,'','',2,60,40),
(5,'عام','40106','تفن','تاريخ الفن 1',1,1,'','',2,60,40),
(6,'عام','40107','','لغة أجنبية 1',1,1,'','',2,60,40),
(7,'عام','40108','','الكيمياء الصناعية',1,1,'','',2,60,40),
(8,'عام','40109','ديك','تصميم 2',1,2,'','',3,100,0),
(9,'عام','40110','ديك','التشكيل و أسس التصميم 2',1,2,'','',2,100,0),
(10,'عام','40111','ديك','دراسة المرئيات 2',1,2,'','',2,100,0),
(11,'عام','40112','ديك','الإسقاط الهندسي 2',1,2,'','',2,100,0),
(12,'عام','40113','ديك','الحاسب الآلي للتخصص',1,2,'','',2,100,0),
(13,'عام','40113','','مقدمة الحاسب الآلي للتخصص',1,2,'','',2,100,0),
(14,'عام','40114','','فيزياء اللون والضوء',1,2,'','',2,60,40),
(15,'عام','40115','ديك','التصميم و سلوكيات الإنسان',1,2,'','',2,60,40),
(16,'عام','40115','ديك','التصميم و سلوكيات الإنسان',1,2,'','',2,80,20),
(17,'عام','40116','','التفكير الناقد',1,2,'','',2,0,0),
(18,'عام','40201','ديك','تصميم 3',2,3,'','',3,100,0),
(19,'عام','40202','ديك','دراسة المرئيات 3',2,3,'','',2,100,0),
(20,'عام','40203','ديك','المنظور الهندسي 1',2,3,'','',2,100,0),
(21,'عام','40204','عمر','الإنشاء المعمارى 1',2,3,'','',2,100,0),
(22,'عام','40205','ديك','تكنولوجيا الخامات 1',2,3,'','',2,60,40),
(23,'عام','40206','','تطبيقات الحاسب الآلي 1',2,3,'','',2,100,0),
(24,'عام','40206','ديك','تطبيقات الحاسب الآلي 1',2,3,'','',2,60,40),
(25,'عام','40207','تفن','تاريخ الفن 2',2,3,'','',2,60,40),
(26,'عام','40208','','لغة أجنبية 2',2,3,'','',2,60,40),
(27,'عام','40209','ديك','تصميم 4',2,4,'','',3,100,0),
(28,'عام','40210','ديك','دراسة المرئيات 4',2,4,'','',2,100,0),
(29,'عام','40211','ديك','المنظور الهندسي 2',2,4,'','',2,100,0),
(30,'عام','40212','عمر','الإنشاء المعمارى 2',2,4,'','',2,100,0),
(31,'عام','40213','ديك','تكنولوجيا الخامات 2',2,4,'','',2,60,40),
(32,'عام','40213','ديك','تكنولوجيا الخامات 2',2,4,'','',2,100,0),
(33,'عام','40214','ديك','مواد البناء',2,4,'','',2,60,40),
(34,'عام','40215','عمر','الطرز المعمارية',2,4,'','',2,60,40),
(35,'عام','40215','عمر','الطرز المعمارية',2,4,'','',2,80,20),
(36,'عام','40216','','الإبتكار وريادة الأعمال',2,4,'','',2,0,0),
(37,'عام','40101','سج','تصميم سينوجرافيا 1',3,5,'سينوغرافيا','',4,100,0),
(38,'عام','40102','سج','دراسة المرئيات 5',3,5,'سينوغرافيا','',2,100,0),
(39,'عام','40103','سج','ماكيت 1',3,5,'سينوغرافيا','',2,100,0),
(40,'عام','40104','سج','هندسة المناظر المسرحيه',3,5,'سينوغرافيا','',2,60,40),
(41,'عام','40105','سج','تاريخ الأزياء 1',3,5,'سينوغرافيا','',2,60,40),
(42,'عام','40106','تفن','تاريخ الفن 3',3,5,'سينوغرافيا','',2,60,40),
(43,'عام','40107','','لغة أجنبية 3',3,5,'سينوغرافيا','',2,60,40),
(44,'عام','40301','عد','تصميمات العمارة الداخلية 1',3,5,'عمارة داخلية','',4,100,0),
(45,'عام','40302','عد','دراسة المرئيات 5',3,5,'عمارة داخلية','',2,100,0),
(46,'عام','40303','عد','طرز العمارة الداخلية و التأثيث 1',3,5,'عمارة داخلية','',2,80,20),
(47,'عام','40304','عد','المنظور الهندسى 3',3,5,'عمارة داخلية','',2,100,0),
(48,'عام','40305','عد','تكنولوجيا الخامات 3',3,5,'عمارة داخلية','',2,60,40),
(49,'عام','40306','عمر','التجهيزات الفنية 1',3,5,'عمارة داخلية','',2,60,40),
(50,'عام','40307','تفن','تاريخ الفن 3',3,5,'عمارة داخلية','',2,60,40),
(51,'عام','40308','','لغة أجنبية 3',3,5,'عمارة داخلية','',2,60,40),
(52,'عام','40308','سج','تصميم سينوجرافيا 2',3,6,'سينوغرافيا','',4,100,0),
(53,'عام','40309','سج','دراسة المرئيات 6',3,6,'سينوغرافيا','',2,100,0),
(54,'عام','40310','سج','ماكيت 2',3,6,'سينوغرافيا','',2,100,0),
(55,'عام','40311','سج','هندسة المناظر السنيمائيه',3,6,'سينوغرافيا','',2,60,40),
(56,'عام','40312','سج','تاريخ الأزياء 2',3,6,'سينوغرافيا','',2,60,40),
(57,'عام','40313','سج','تاريخ المسرح و السينما',3,6,'سينوغرافيا','',2,60,40),
(58,'عام','40314','سج','تطبيقات الحاسب الآلي 2',3,6,'سينوغرافيا','',2,100,0),
(59,'عام','40309','عد','تصميمات العمارة الداخلية 2',3,6,'عمارة داخلية','',4,100,0),
(60,'عام','40310','عد','دراسة المرئيات 6',3,6,'عمارة داخلية','',2,100,0),
(61,'عام','40311','عد','طرز العمارة الداخلية و التأثيث 2',3,6,'عمارة داخلية','',2,80,20),
(62,'عام','40312','عد','المنظور الحر والإظهار',3,6,'عمارة داخلية','',2,80,20),
(63,'عام','40313','عد','نظريات واتجاهات العمارة الداخلية',3,6,'عمارة داخلية','',2,60,40),
(64,'عام','40314','عمر','التجهيزات الفنية 2',3,6,'عمارة داخلية','',2,60,40),
(65,'عام','40315','عد','تطبيقات الحاسب الآلي 2',3,6,'عمارة داخلية','',2,100,0),
(66,'عام','40401','سج','تصميم سينوجرافيا 3',4,7,'سينوغرافيا','',3,100,0),
(67,'عام','40402','سج','دراسة المرئيات 7',4,7,'سينوغرافيا','',2,100,0),
(68,'عام','40403','سج','تصميم و تنفيذ العرائس 1',4,7,'سينوغرافيا','',2,60,40),
(69,'عام','40404','عمر','التصميم المعمارى',4,7,'سينوغرافيا','',2,60,40),
(70,'عام','40405','سج','تصميم الأزياء للتخصص 1',4,7,'سينوغرافيا','',2,60,40),
(71,'عام','40406','سج','طرز التأثيث للتخصص 1',4,7,'سينوغرافيا','',2,60,40),
(72,'عام','40407','','تكنولوجيا المسرح',4,7,'سينوغرافيا','',2,60,40),
(73,'عام','40401','عد','تصميمات العمارة الداخلية 3',4,7,'عمارة داخلية','',4,100,0),
(74,'عام','40402','عد','دراسة المرئيات 7',4,7,'عمارة داخلية','',2,100,0),
(75,'عام','40403','عد','التصميم المعمارى 1',4,7,'عمارة داخلية','',2,100,0),
(76,'عام','40404','عد','التصميمات التنفيذية للعمارة الداخلية 1',4,7,'عمارة داخلية','',2,80,20),
(77,'عام','40405','عد','التجهيزات الفنية 3',4,7,'عمارة داخلية','',2,60,40),
(78,'عام','40406','عد','تنسيق المواقع الداخلية 1',4,7,'عمارة داخلية','',2,100,0),
(79,'عام','40408','سج','تصميم سينوجرافيا 4',4,8,'سينوغرافيا','',4,100,0),
(80,'عام','40409','سج','دراسة المرئيات 8',4,8,'سينوغرافيا','',2,100,0),
(81,'عام','40410','سج','تصميم الأزياء للتخصص',4,8,'سينوغرافيا','',2,60,40),
(82,'عام','40411','سج','طرز التأثيث للتخصص 2',4,8,'سينوغرافيا','',2,60,40),
(83,'عام','40412','','تكنولوجيا السينما',4,8,'سينوغرافيا','',2,60,40),
(84,'عام','40407','عد','تصميمات العمارة الداخلية 4',4,8,'عمارة داخلية','',4,100,0),
(85,'عام','40408','عد','دراسة المرئيات 8',4,8,'عمارة داخلية','',2,100,0),
(86,'عام','40409','عد','التصميم المعمارى 2',4,8,'عمارة داخلية','',2,100,0),
(87,'عام','40410','عد','التصميمات التنفيذية للعمارة الداخلية 2',4,8,'عمارة داخلية','',2,80,20),
(88,'عام','40411','عد','تنسيق المواقع الداخليه 2',4,8,'عمارة داخلية','',2,100,0),
(89,'عام','40501','سج','تصميم سينوجرافيا 5',5,9,'سينوغرافيا','',4,100,0),
(90,'عام','40502','سج','دراسة المرئيات 9',5,9,'سينوغرافيا','',3,100,0),
(91,'عام','40503','سج','تصميم و تنفيذ العرائس 2',5,9,'سينوغرافيا','',2,60,40),
(92,'عام','40504','','التصوير والإضاءه السينمائيه',5,9,'سينوغرافيا','',2,60,40),
(93,'عام','40505','','الإخراج الدرامى',5,9,'سينوغرافيا','',2,60,40),
(94,'عام','40506','سج','بحث مشروع التخرج',5,9,'سينوغرافيا','',3,100,0),
(95,'عام','40501','عد','تصميمات العمارة الداخلية 5',5,9,'عمارة داخلية','',4,100,0),
(96,'عام','40502','عد','دراسة المرئيات 9',5,9,'عمارة داخلية','',2,100,0),
(97,'عام','40503','عد','التصميمات التنفيذيه للعمارة الداخلية 3',5,9,'عمارة داخلية','',2,60,40),
(98,'عام','40504','عد','المواصفات وحساب الكميات للتخصص',5,9,'عمارة داخلية','',2,60,40),
(99,'عام','40505','عد','الإستدامه والتصميم البيئى فى العمارة الداخلية',5,9,'عمارة داخلية','',2,60,40),
(100,'عام','40506','عد','إدارة المشروعات وممارسة المهنه',5,9,'عمارة داخلية','',2,60,40),
(101,'عام','40507','عد','بحث مشروع التخرج',5,9,'عمارة داخلية','',2,100,0),
(102,'عام','40507','سج','تصميم سينوجرافيا 6',5,10,'سينوغرافيا','',4,100,0),
(103,'عام','40508','سج','دراسات تحليلية',5,10,'سينوغرافيا','',2,100,0),
(104,'عام','40509','سج','مشروع التخرج',5,10,'سينوغرافيا','',7,0,0),
(105,'عام','40508','عد','تصميمات العمارة الداخلية 6',5,10,'عمارة داخلية','',4,100,0),
(106,'عام','40509','عد','التصميمات التنفيذيه للعمارة الداخلية 4',5,10,'عمارة داخلية','',2,60,40),
(107,'عام','40510','عد','مشروع التخرج',5,10,'عمارة داخلية','',7,100,0),
(108,'عام','4007','سج','الدراما والسيناريو',null,null,'','سينوغرافيا',2,60,40),
(109,'عام','4008','سج','تصميم الدعاية للتخصص',null,null,'','سينوغرافيا',2,100,0),
(110,'عام','4009','سج','تصميم احتفالات و مناسبات',null,null,'','سينوغرافيا',2,100,0),
(111,'عام','4010','سج','إنتاج سنيمائى ومسرحى',null,null,'','سينوغرافيا',2,60,40),
(112,'عام','4011','سج','تنفيذ الأزياء',null,null,'','سينوغرافيا',2,100,0),
(113,'عام','4001','ديك','الحيز المعمارى الداخلى',null,null,'','عام',2,100,0),
(114,'عام','4002','ديك','تصميم برامج تليفزيونيه',null,null,'','عام',2,100,0),
(115,'عام','4003','ديك','منسوجات ومفروشات',null,null,'','عام',2,60,40),
(116,'عام','4004','ديك','بانوه',null,null,'','عام',2,100,0),
(117,'عام','4005','ديك','تصوير فوتوغرافى',null,null,'','عام',2,100,0),
(118,'عام','4006','ديك','الخط العربى فى الحيز الداخلى',null,null,'','عام',2,100,0),
(119,'عام','4006','ديك','الخط العربى والتصميم',null,null,'','عام',2,100,0),
(120,'عام','4007','عد','مكملات عناصر العمارة الداخلية',null,null,'','عمارة داخلية',2,100,0),
(121,'عام','4008','عد','التسويق فى مجالات العمارة الداخلية',null,null,'','عمارة داخلية',2,60,40),
(122,'عام','4009','عد','تصميم المتاحف والمعارض',null,null,'','عمارة داخلية',2,100,0),
(123,'عام','4010','عد','مناهج النقد والتحليل لحيزات العمارة الداخلية',null,null,'','عمارة داخلية',2,60,40),
(124,'خاص','111','تعد','تصميمات العمارة الداخلية 1',1,1,'عمارة داخلية','',4,100,0),
(125,'خاص','112','تعد','دراسة المرئيات 1',1,1,'عمارة داخلية','',3,100,0),
(126,'خاص','113','تعد','أسس تصميم 1',1,1,'عمارة داخلية','',2,100,0),
(127,'خاص','114','تعد','رسم هندسي 1',1,1,'عمارة داخلية','',2,100,0),
(128,'خاص','115','كيم','كيمياء الألوان',1,1,'عمارة داخلية','',2,60,40),
(129,'خاص','116','تعد','تطبيقات الحاسب الآلي 1',1,1,'عمارة داخلية','',2,100,0),
(130,'خاص','117','تعد','التفكير الناقد (متطلب جامعة)',1,1,'عمارة داخلية','',2,0,0),
(131,'خاص','121','تعد','تصميمات العمارة الداخلية 2',1,2,'عمارة داخلية','',4,100,0),
(132,'خاص','122','تعد','دراسة المرئيات 2',1,2,'عمارة داخلية','',3,100,0),
(133,'خاص','123','تعد','أسس تصميم 2',1,2,'عمارة داخلية','',2,100,0),
(134,'خاص','124','تعد','رسم هندسي 2',1,2,'عمارة داخلية','',2,100,0),
(135,'خاص','125','تعد','الطرز المعمارية',1,2,'عمارة داخلية','',2,60,40),
(136,'خاص','126','تعد','فيزياء الصوت والضوء',1,2,'عمارة داخلية','',2,60,40),
(137,'خاص','127','تعد','تطبيقات الحاسب الآلي 2',1,2,'عمارة داخلية','',2,100,0),
(138,'خاص','211','تعد','تصميمات العمارة الداخلية 3',2,3,'عمارة داخلية','',4,100,0),
(139,'خاص','212','تعد','دراسة المرئيات 3',2,3,'عمارة داخلية','',3,100,0),
(140,'خاص','213','تعد','المنظور الهندسي 1',2,3,'عمارة داخلية','',2,100,0),
(141,'خاص','214','تعد','الإنشاء المعمارى 1',2,3,'عمارة داخلية','',2,100,0),
(142,'خاص','215','تعد','تطبيقات الحاسب الآلي 3',2,3,'عمارة داخلية','',2,100,0),
(143,'خاص','216','تعد','علوم القياسات',2,3,'عمارة داخلية','',2,60,40),
(144,'خاص','217','تعد','سلوكيات الإنسان والتصميم',2,3,'عمارة داخلية','',2,60,40),
(145,'خاص','221','تعد','تصميمات العمارة الداخلية 4',2,4,'عمارة داخلية','',4,100,0),
(146,'خاص','222','تعد','دراسة المرئيات 4',2,4,'عمارة داخلية','',3,100,0),
(147,'خاص','223','تعد','المنظور الهندسي 2',2,4,'عمارة داخلية','',2,100,0),
(148,'خاص','224','تعد','الإنشاء المعمارى 2',2,4,'عمارة داخلية','',2,100,0),
(149,'خاص','225','تعد','تطبيقات الحاسب الآلي 4',2,4,'عمارة داخلية','',2,100,0),
(150,'خاص','311','تعد','تصميمات العمارة الداخلية 5',3,5,'عمارة داخلية','',4,100,0),
(151,'خاص','312','تعد','دراسة المرئيات 5',3,5,'عمارة داخلية','',3,100,0),
(152,'خاص','313','تعد','تكنولوجيا الخامات 1',3,5,'عمارة داخلية','',2,60,40),
(153,'خاص','314','تعد','التصميم المعمارى 1',3,5,'عمارة داخلية','',2,100,0),
(154,'خاص','315','تعد','تجهيزات العمارة الداخلية 1',3,5,'عمارة داخلية','',2,100,0),
(155,'خاص','316','تعد','تطبيقات الحاسب الآلي 5',3,5,'عمارة داخلية','',2,100,0),
(156,'خاص','317','تفن','تاريخ فن 1 (متطلب كلية)',3,5,'عمارة داخلية','',2,60,40),
(157,'خاص','321','تعد','تصميمات العمارة الداخلية 6',3,6,'عمارة داخلية','',4,100,0),
(158,'خاص','322','تعد','دراسة المرئيات 6',3,6,'عمارة داخلية','',3,100,0),
(159,'خاص','323','تعد','تكنولوجيا الخامات 2',3,6,'عمارة داخلية','',2,60,40),
(160,'خاص','324','تعد','التصميم المعمارى 2',3,6,'عمارة داخلية','',2,100,0),
(161,'خاص','325','تعد','تجهيزات العمارة الداخلية 2',3,6,'عمارة داخلية','',2,100,0),
(162,'خاص','326','تعد','التصميمات التنفيذية للعمارة الداخلية 1',3,6,'عمارة داخلية','',2,100,0),
(163,'خاص','327','تفن','تاريخ فن 2 (متطلب كلية)',3,6,'عمارة داخلية','',2,60,40),
(164,'خاص','411','تعد','تصميمات العمارة الداخلية 7',4,7,'عمارة داخلية','',4,100,0),
(165,'خاص','412','تعد','التصميمات التنفيذية للعمارة الداخلية 2',4,7,'عمارة داخلية','',2,100,0),
(166,'خاص','413','تعد','التصميم المعمارى 3',4,7,'عمارة داخلية','',2,100,0),
(167,'خاص','414','تعد','تجهيزات العمارة الداخلية 3',4,7,'عمارة داخلية','',2,100,0),
(168,'خاص','415','تعد','نظريات واتجاهات العمارة الداخلية 1',4,7,'عمارة داخلية','',2,60,40),
(169,'خاص','416','تعد','طرز العمارة الداخلية و التأثيث 1',4,7,'عمارة داخلية','',2,60,40),
(170,'خاص','421','تعد','تصميمات العمارة الداخلية 8',4,8,'عمارة داخلية','',4,100,0),
(171,'خاص','422','تعد','التصميمات التنفيذية للعمارة الداخلية 3',4,8,'عمارة داخلية','',2,100,0),
(172,'خاص','423','تعد','التصميم المعمارى 4',4,8,'عمارة داخلية','',2,100,0),
(173,'خاص','424','تعد','تجهيزات العمارة الداخلية 4',4,8,'عمارة داخلية','',2,100,0),
(174,'خاص','425','تعد','نظريات واتجاهات العمارة الداخلية 2',4,8,'عمارة داخلية','',2,60,40),
(175,'خاص','426','تعد','طرز العمارة الداخلية و التأثيث 2',4,8,'عمارة داخلية','',2,60,40),
(176,'خاص','427','تعد','الإستدامة والتصميم البيئي في العمارة الداخلية 1',4,8,'عمارة داخلية','',2,60,40),
(177,'خاص','511','تعد','تصميمات العمارة الداخلية 9',5,9,'عمارة داخلية','',4,100,0),
(178,'خاص','512','تعد','التصميمات التنفيذية للعمارة الداخلية 4',5,9,'عمارة داخلية','',2,100,0),
(179,'خاص','513','تعد','الإستدامة والتصميم البيئي في العمارة الداخلية 2',5,9,'عمارة داخلية','',2,60,40),
(180,'خاص','514','تعد','بحث مشروع التخرج',5,9,'عمارة داخلية','',2,100,0),
(181,'خاص','515','تعد','المواصفات وحساب الكميات للتخصص',5,9,'عمارة داخلية','',2,60,40),
(182,'خاص','516','تعد','الهوية التصميمية للعمارة الداخلية',5,9,'عمارة داخلية','',2,60,40),
(183,'خاص','521','تعد','إدارة المشروعات وممارسة المهنة',5,10,'عمارة داخلية','',2,60,40),
(184,'خاص','522','تعد','أكواد المباني',5,10,'عمارة داخلية','',2,60,40),
(185,'خاص','523','تعد','مشروع التخرج',5,10,'عمارة داخلية','',11,100,0),
(186,'خاص','001','تعد','الحيز المعماري الداخلي',null,null,'','عام',2,null,null),
(187,'خاص','002','سفس','تصميم برامج تليفزيونية',null,null,'','عام',2,null,null),
(188,'خاص','003','تعد','منسوجات ومفروشات',null,null,'','عام',2,null,null),
(189,'خاص','004','سفس','عناصر تشكيلية',null,null,'','عام',2,null,null),
(190,'خاص','005','سفس','تصوير فوتوغرافي',null,null,'','عام',2,null,null),
(191,'خاص','006','سفس','الخط العربي والتصميم',null,null,'','عام',2,null,null),
(192,'خاص','007','تعد','مكملات عناصر العمارة الداخلية',null,null,'','عمارة داخلية',2,null,null),
(193,'خاص','008','تعد','التسويق في مجالات العمارة الداخلية',null,null,'','عمارة داخلية',2,null,null),
(194,'خاص','009','تعد','تصميم المتاحف والمعارض',null,null,'','عمارة داخلية',2,null,null),
(195,'خاص','010','تعد','النقد والتحليل في العمارة الداخلية',null,null,'','عمارة داخلية',2,null,null),
(196,'خاص','011','تعد','تصميم أثاث',null,null,'','عمارة داخلية',2,null,null)
on conflict (id) do update set prog = excluded.prog, code = excluded.code, prefix = excluded.prefix, name = excluded.name, level = excluded.level, sem = excluded.sem, track = excluded.track, elective = excluded.elective, credits = excluded.credits, cw = excluded.cw, ex = excluded.ex;

-- العام والفصل الدراسيان الحاليان (بتوقيت القاهرة): سبتمبر–يناير الأول، فبراير–يونيو الثاني، يوليو–أغسطس الصيفي
create or replace function public.academic_term() returns json
language sql stable as $$
  select case when m >= 9 then json_build_object('year', y || '/' || (y + 1), 'term', 1)
              when m = 1 then json_build_object('year', (y - 1) || '/' || y, 'term', 1)
              when m <= 6 then json_build_object('year', (y - 1) || '/' || y, 'term', 2)
              else json_build_object('year', (y - 1) || '/' || y, 'term', 3) end
  from (select extract(year from now() at time zone 'Africa/Cairo')::int y, extract(month from now() at time zone 'Africa/Cairo')::int m) d
$$;

create or replace function public.norm_ar(s text) returns text
language sql immutable as $$ select translate(regexp_replace(coalesce(s, ''), '[\sـًٌٍَُِّْ*]', '', 'g'), 'أإآٱىة', 'اااايه') $$;

-- قلب العملية: إضافة الطالب إلى مواد المقررات المذكورة في استمارته
create or replace function public.form_enroll(code text, p_name text, p_level int, p_items jsonb, p_via text) returns json
language plpgsql security definer set search_path = public as $$
declare it jsonb; b bylaw_courses; y text; tm int; lvl int; tr text; cid uuid; nm text; outj jsonb := '[]'::jsonb; st text;
  own text; dg text; bc text; n int := 0; bid int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no_courses'; end if;
  if (select count(*) from form_regs where student_code = code and at > now() - interval '1 day') >= 10 then raise exception 'too_many_tries'; end if;
  select a->>'year', (a->>'term')::int into y, tm from (select academic_term() a) x;
  -- الاسم: من كشوف المحاضرين إن وُجد، وإلا من الاستمارة
  nm := (select e.name from enrollments e where e.student_code = code and e.source = '' limit 1);
  if nm is null then nm := (select e.name from enrollments e where e.student_code = code limit 1); end if;
  if nm is null then nm := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120); end if;
  if length(coalesce(nm, '')) < 3 then raise exception 'name_required'; end if;
  select email into own from staff where role = 'admin' and status <> 'suspended' order by created_at limit 1;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1; exit when n > 20;
    st := null; cid := null; b := null;
    dg := regexp_replace(coalesce(it->>'code', ''), '\D', '', 'g');
    bid := case when coalesce(it->>'bid', '') ~ '^\d{1,4}$' then (it->>'bid')::int end;
    if bid is not null then select * into b from bylaw_courses where id = bid; end if;
    if b.id is null or regexp_replace(b.code, '\D', '', 'g') <> dg then
      outj := outj || jsonb_build_object('code', it->>'code', 'name', it->>'name', 'status', 'unknown'); continue;
    end if;
    lvl := coalesce(b.level, case when p_level between 1 and 5 then p_level end);
    tr := case when b.prog = 'خاص' then 'عمارة داخلية'
               when lvl <= 2 then ''
               when b.track <> '' then b.track
               when b.elective in ('عمارة داخلية', 'سينوغرافيا') then b.elective
               when b.prefix = 'عد' then 'عمارة داخلية'
               when b.prefix = 'سج' then 'سينوغرافيا' end;
    bc := case when b.prefix <> '' then b.prefix || ' ' else '' end || b.code;
    if lvl is null or tr is null then
      outj := outj || jsonb_build_object('code', bc, 'name', b.name, 'status', 'unknown'); continue;
    end if;
    select c.id into cid from courses c
      where not c.archived and c.academic_year = y and c.term = tm and c.program = b.prog and c.level = lvl
        and (regexp_replace(c.bylaw_code, '\D', '', 'g') = dg or (c.bylaw_code = '' and norm_ar(c.name) = norm_ar(b.name)))
      order by exists (select 1 from enrollments e where e.course_id = c.id and e.student_code = code) desc, c.created_at
      limit 1;
    if cid is null then
      if own is null then outj := outj || jsonb_build_object('code', bc, 'name', b.name, 'status', 'unknown'); continue; end if;
      insert into courses(name, owner_email, academic_year, term, level, track, program, dept, bylaw_code, cw_max, exam_max, credits, auto_created)
        values (b.name, own, y, tm, lvl, tr, b.prog, 'الديكور', bc, b.cw, b.ex, b.credits, true) returning id into cid;
      insert into audit(actor, course_id, action) values ('النظام', cid,
        'أُنشئت المادة تلقائيًّا لأن طالبًا سجّلها في استمارة التسجيل الأكاديمي. عيّن لها محاضرًا أو معيدًا من تبويب «الفريق».');
      st := 'created';
    end if;
    if exists (select 1 from enrollments where course_id = cid and student_code = code) then st := 'already';
    elsif exists (select 1 from enrollment_blocks where course_id = cid and student_code = code and active) then st := 'blocked';
    else
      insert into enrollments(course_id, student_code, name, grp, source, added_at) values (cid, code, nm, '', 'form', now());
      insert into audit(actor, course_id, action) values (nm, cid, 'سجّل نفسه في المادة من استمارة التسجيل الأكاديمي (الكود ' || code || ')');
      st := coalesce(st, 'added');
    end if;
    outj := outj || jsonb_build_object('code', bc, 'name', (select name from courses where id = cid), 'status', st);
  end loop;
  insert into form_regs(student_code, via, items) values (code, p_via, least(n, 20));
  return json_build_object('year', y, 'term', tm, 'name', nm, 'items', outj);
end $$;

-- طالب جديد: ينشئ حسابه ويُضاف إلى مواده من الاستمارة في خطوة واحدة
create or replace function public.student_form_register(p_code text, p_name text, p_level int, p_items jsonb,
  p_password text, p_pin text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); en json; r json;
begin
  if code !~ '^\d{6,12}$' then raise exception 'bad_code'; end if;
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password'; end if;
  if student_locked(code) then raise exception 'locked'; end if;
  if exists (select 1 from students where student_code = code) then raise exception 'already_registered'; end if;
  -- لو المحاضر أعطى هذا الكود رمز تفعيل، فيلزم الرمز
  if exists (select 1 from enrollments where student_code = code and coalesce(pin, '') <> '')
     and not exists (select 1 from enrollments where student_code = code and pin = trim(coalesce(p_pin, ''))) then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_pin');
  end if;
  en := form_enroll(code, p_name, p_level, p_items, 'register');
  if not exists (select 1 from enrollments where student_code = code) then
    return json_build_object('error', 'no_course_matched', 'enroll', en);
  end if;
  r := student_register(code, p_password, p_pin, p_device, p_label);
  return json_build_object('token', r->>'token', 'name', r->>'name', 'enroll', en);
end $$;

-- طالب له حساب: يضيف مواده الجديدة من الاستمارة (لا يُحذف شيء)
create or replace function public.student_form_sync(p_token text, p_code text, p_name text, p_level int, p_items jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if regexp_replace(coalesce(p_code, ''), '\D', '', 'g') <> code then raise exception 'code_mismatch'; end if;
  return form_enroll(code, p_name, p_level, p_items, 'sync');
end $$;

-- إزالة طالب من المادة: لا يستطيع إضافة نفسه إليها مرة أخرى من الاستمارة
create or replace function public.remove_student(cid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  select name into nm from enrollments where course_id = cid and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  delete from enrollments where course_id = cid and student_code = code;
  insert into enrollment_blocks(course_id, student_code) values (cid, code)
    on conflict (course_id, student_code) do update set active = true, at = now();
  perform log_audit(cid, 'أزال الطالب ' || nm || ' (' || code || ') من المادة');
end $$;

-- إضافة طالب يدويًّا ترفع الحظر
create or replace function public.add_student(cid uuid, p_code text, p_name text, p_grp text, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := trim(coalesce(p_code, '')); nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  g text := trim(coalesce(p_grp, '')); pin text := nullif(trim(coalesce(p_pin, '')), '');
begin
  if coalesce(course_role(cid), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if code !~ '^[0-9A-Za-z_-]{1,40}$' then raise exception 'bad_code'; end if;
  if length(nm) = 0 then raise exception 'name_required'; end if;
  if exists (select 1 from enrollments where course_id = cid and student_code = code) then raise exception 'already_in_course'; end if;
  insert into enrollments(course_id, student_code, name, grp, pin) values (cid, code, left(nm, 120), left(g, 20), left(pin, 30));
  update enrollment_blocks set active = false where course_id = cid and student_code = code;
  perform log_audit(cid, 'أضاف الطالب ' || nm || ' (' || code || ')' || case when g <> '' then ' في مجموعة ' || g else '' end || ' للمادة');
end $$;

-- رفع ملف الطلبة: لا يحذف من سجّلوا أنفسهم بالاستمارة، ومن يرد اسمه في الملف يصبح من الكشف الرسمي
create or replace function public.replace_roster(cid uuid, rows jsonb, p_file text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if course_role(cid) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then raise exception 'empty_roster'; end if;
  create temp table _r on commit drop as
    select distinct on (trim(x->>'code')) trim(x->>'code') as code, trim(x->>'name') as name,
           coalesce(trim(x->>'grp'), '') as grp, nullif(trim(coalesce(x->>'pin', '')), '') as pin
    from jsonb_array_elements(rows) x
    where coalesce(trim(x->>'code'), '') <> '' and coalesce(trim(x->>'name'), '') <> '';
  delete from enrollments where course_id = cid and source <> 'form' and student_code not in (select code from _r);
  insert into enrollments(course_id, student_code, name, grp, pin)
    select cid, code, name, grp, pin from _r
    on conflict (course_id, student_code) do update set name = excluded.name, grp = excluded.grp, pin = excluded.pin, source = '';
  update enrollment_blocks set active = false where course_id = cid and student_code in (select code from _r);
  select count(*) into n from _r;
  perform log_audit(cid, 'رفع ملف الطلبة «' || coalesce(p_file, '') || '» (' || n || ' طالب)');
  return n;
end $$;

revoke execute on function public.academic_term(), public.norm_ar(text), public.form_enroll(text, text, int, jsonb, text) from public, anon, authenticated;
revoke execute on function public.student_form_register(text, text, int, jsonb, text, text, text, text),
  public.student_form_sync(text, text, text, int, jsonb) from public;
grant execute on function public.student_form_register(text, text, int, jsonb, text, text, text, text),
  public.student_form_sync(text, text, text, int, jsonb) to anon, authenticated;
revoke execute on function public.remove_student(uuid, text), public.add_student(uuid, text, text, text, text), public.replace_roster(uuid, jsonb, text) from public, anon;
grant execute on function public.remove_student(uuid, text), public.add_student(uuid, text, text, text, text), public.replace_roster(uuid, jsonb, text) to authenticated;

-- تحديث 18: «لا يُقبل التسليم ممن غاب في محاضرة يوم التسليم» (اختيار لكل تكليف) + قبول بعذر
--   absent_rule: 'flag' (يُقبل ويُنبَّه المحاضر، كما كان) أو 'refuse' (لا يُقبل إلا بعذر يقبله فريق المادة).
--   الطالب «غائب يوم التسليم» = له محاضرة (لمجموعته) في يوم التسليم بتوقيت القاهرة انتهى تسجيلها،
--   ولم يُسجَّل له حضور (غير المنتظر) في أي محاضرة للمادة في ذلك اليوم.

alter table public.tasks add column if not exists absent_rule text not null default 'flag';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_absent_rule_ok') then
    alter table public.tasks add constraint tasks_absent_rule_ok check (absent_rule in ('flag', 'refuse'));
  end if;
end $$;

create table if not exists public.task_excuses (
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_code text not null,
  by_email text not null,
  note text not null default '',
  active boolean not null default true,
  at timestamptz not null default now(),
  primary key (task_id, student_code)
);
alter table public.task_excuses enable row level security;
drop policy if exists task_excuses_read on public.task_excuses;
create policy task_excuses_read on public.task_excuses for select to authenticated using (course_role(task_course(task_id)) is not null);

create or replace function public.task_excused(tid uuid, code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_excuses where task_id = tid and student_code = code and active)
$$;

create or replace function public.absent_on_due(t tasks, code text) returns boolean
language sql stable security definer set search_path = public as $$
  with d as (select (t.due_at at time zone 'Africa/Cairo')::date dd),
       e as (select grp from enrollments where course_id = t.course_id and student_code = code)
  select exists (select 1 from sessions s, d, e
                 where s.course_id = t.course_id and (s.started_at at time zone 'Africa/Cairo')::date = d.dd
                   and (s.grp is null or s.grp = e.grp)
                   and (s.ended or s.closed_at is not null or now() >= s.ends_at))
     and not exists (select 1 from attendance a join sessions s on s.id = a.session_id, d
                     where s.course_id = t.course_id and a.student_code = code and a.status <> 'pending'
                       and (s.started_at at time zone 'Africa/Cairo')::date = d.dd)
$$;

create or replace function public.set_task_absent_rule(tid uuid, p_rule text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if not can_edit_task(t) then raise exception 'not_allowed'; end if;
  if p_rule not in ('flag', 'refuse') then raise exception 'bad_rule'; end if;
  if t.absent_rule = p_rule then return; end if;
  update tasks set absent_rule = p_rule where id = tid;
  perform log_audit(t.course_id, case when p_rule = 'refuse' then 'جعل التكليف «' || t.title || '» لا يُقبل ممن غاب في محاضرة يوم التسليم'
    else 'جعل التكليف «' || t.title || '» يُقبل ممن غاب في محاضرة يوم التسليم (مع التنبيه)' end);
end $$;

-- قبول عذر طالب غاب يوم التسليم (أو إلغاؤه)
create or replace function public.set_task_excuse(tid uuid, code text, p_on boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; nm text;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  select name into nm from enrollments where course_id = t.course_id and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  insert into task_excuses(task_id, student_code, by_email, note, active) values (tid, code, my_email(), left(trim(coalesce(p_note, '')), 300), p_on)
    on conflict (task_id, student_code) do update set active = p_on, by_email = my_email(), note = left(trim(coalesce(p_note, '')), 300), at = now();
  perform log_audit(t.course_id, case when p_on then 'قبل عذر ' || nm || ' في التكليف «' || t.title || '» (غاب يوم التسليم)' || coalesce(nullif(' · ' || trim(coalesce(p_note, '')), ' · '), '')
    else 'ألغى قبول عذر ' || nm || ' في التكليف «' || t.title || '»' end);
end $$;

create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'open', (now() <= t.due_at or t.late = 'accept'),
      'absent_rule', t.absent_rule,
      'refused', (t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(t.id, code)),
      'excused', task_excused(t.id, code),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code))
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

create or replace function public.student_submit(p_token text, tid uuid, p_kind text, p_url text, p_file_id text, p_name text,
  p_mime text, p_size bigint, p_md5 text, p_modified timestamptz, p_note text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); t tasks; e enrollments; s submissions; lt boolean; u text := trim(coalesce(p_url, ''));
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if t.mode <> 'submit' then raise exception 'manual_task'; end if;
  select * into e from enrollments where course_id = t.course_id and student_code = code;
  select * into s from submissions where task_id = tid and student_code = code;
  -- تكليف مجموعة أخرى: مسموح فقط لو للطالب تسليم فيه من قبل (مثلًا نُقل من تلك المجموعة)
  if e.student_code is null or (t.grp is not null and t.grp <> e.grp and s.task_id is null)
     or (select archived from courses where id = t.course_id) then raise exception 'not_found'; end if;
  lt := now() > t.due_at;
  if lt and t.late = 'close' then raise exception 'task_closed'; end if;
  -- «لا يُقبل ممن غاب في محاضرة يوم التسليم» إلا بعذر يقبله فريق المادة
  if t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(tid, code) then raise exception 'absent_on_due'; end if;
  if s.grade is not null then raise exception 'already_graded'; end if;
  if coalesce(s.version, 0) >= 30 then raise exception 'too_many_versions'; end if;
  if p_kind = 'drive' then
    if u !~ '^https://(drive|docs)\.google\.com/' or coalesce(p_file_id, '') !~ '^[A-Za-z0-9_-]{10,200}$'
       or coalesce(p_md5, '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_file'; end if;
  elsif p_kind = 'link' then
    if u !~ '^https://[^\s/$.?#][^\s]*$' or length(u) > 1000 then raise exception 'bad_link'; end if;
    p_file_id := null; p_md5 := null; p_size := null; p_mime := null; p_modified := null;
  else raise exception 'bad_file'; end if;
  insert into submissions(task_id, student_code, kind, url, file_id, file_name, mime, size, md5, file_modified, note, submitted_at, late, version)
    values (tid, code, p_kind, u, p_file_id, left(trim(coalesce(p_name, '')), 300), left(p_mime, 200), p_size, p_md5, p_modified,
            left(trim(coalesce(p_note, '')), 1000), now(), lt, 1)
  on conflict (task_id, student_code) do update set
    kind = excluded.kind, url = excluded.url, file_id = excluded.file_id, file_name = excluded.file_name, mime = excluded.mime,
    size = excluded.size, md5 = excluded.md5, file_modified = excluded.file_modified, note = excluded.note,
    submitted_at = excluded.submitted_at, late = excluded.late, version = submissions.version + 1,
    check_state = null, checked_at = null;
  return json_build_object('submitted_at', now(), 'late', lt, 'version', coalesce(s.version, 0) + 1);
end $$;

revoke execute on function public.task_excused(uuid, text), public.absent_on_due(tasks, text) from public, anon, authenticated;
revoke execute on function public.set_task_absent_rule(uuid, text), public.set_task_excuse(uuid, text, boolean, text) from public, anon;
grant execute on function public.set_task_absent_rule(uuid, text), public.set_task_excuse(uuid, text, boolean, text) to authenticated;

-- تحديث 19: «يوم طرح المشروع» منفصل عن «آخر موعد لرفع الملفات»
--   tasks.present_day: يوم المحاضرة الذي يُطرح/يُعرض فيه المشروع، وبه يُقارن حضور الطالب (إن لم يُحدَّد فيوم موعد التسليم كما كان).
--   ومن غاب فيه: يُكتب «متأخر» (flag) أو لا يُقبل تسليمه إلا بعذر (refuse).

alter table public.tasks add column if not exists present_day date;

create or replace function public.absent_on_due(t tasks, code text) returns boolean
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(t.present_day, (t.due_at at time zone 'Africa/Cairo')::date) dd),
       e as (select grp from enrollments where course_id = t.course_id and student_code = code)
  select exists (select 1 from sessions s, d, e
                 where s.course_id = t.course_id and (s.started_at at time zone 'Africa/Cairo')::date = d.dd
                   and (s.grp is null or s.grp = e.grp)
                   and (s.ended or s.closed_at is not null or now() >= s.ends_at))
     and not exists (select 1 from attendance a join sessions s on s.id = a.session_id, d
                     where s.course_id = t.course_id and a.student_code = code and a.status <> 'pending'
                       and (s.started_at at time zone 'Africa/Cairo')::date = d.dd)
$$;

create or replace function public.set_task_present_day(tid uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if not can_edit_task(t) then raise exception 'not_allowed'; end if;
  if t.present_day is not distinct from p_day then return; end if;
  update tasks set present_day = p_day where id = tid;
  perform log_audit(t.course_id, case when p_day is null then 'ألغى يوم طرح المشروع للتكليف «' || t.title || '»'
    else 'حدّد يوم طرح المشروع للتكليف «' || t.title || '»: ' || to_char(p_day, 'DD/MM/YYYY') end);
end $$;

create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'open', (now() <= t.due_at or t.late = 'accept'),
      'absent_rule', t.absent_rule, 'present_day', t.present_day, 'absent_due', absent_on_due(t, code),
      'refused', (t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(t.id, code)),
      'excused', task_excused(t.id, code),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code))
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

revoke execute on function public.absent_on_due(tasks, text) from public, anon, authenticated;
revoke execute on function public.set_task_present_day(uuid, date) from public, anon;
grant execute on function public.set_task_present_day(uuid, date) to authenticated;

-- تحديث 20: مكان العمل في المشروع: في الكلية (يُشترط الحضور يوم الطرح) أو في البيت (لا يُشترط الحضور)

alter table public.tasks add column if not exists at_home boolean not null default false;

create or replace function public.absent_on_due(t tasks, code text) returns boolean
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(t.present_day, (t.due_at at time zone 'Africa/Cairo')::date) dd),
       e as (select grp from enrollments where course_id = t.course_id and student_code = code)
  select not t.at_home and exists (select 1 from sessions s, d, e
                 where s.course_id = t.course_id and (s.started_at at time zone 'Africa/Cairo')::date = d.dd
                   and (s.grp is null or s.grp = e.grp)
                   and (s.ended or s.closed_at is not null or now() >= s.ends_at))
     and not exists (select 1 from attendance a join sessions s on s.id = a.session_id, d
                     where s.course_id = t.course_id and a.student_code = code and a.status <> 'pending'
                       and (s.started_at at time zone 'Africa/Cairo')::date = d.dd)
$$;

create or replace function public.set_task_place(tid uuid, p_home boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if not can_edit_task(t) then raise exception 'not_allowed'; end if;
  if t.at_home = coalesce(p_home, false) then return; end if;
  update tasks set at_home = coalesce(p_home, false) where id = tid;
  perform log_audit(t.course_id, 'جعل مكان العمل في التكليف «' || t.title || '» ' || case when p_home then 'في البيت (لا يُشترط الحضور يوم الطرح)' else 'في الكلية (يُشترط الحضور يوم الطرح)' end);
end $$;

create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'open', (now() <= t.due_at or t.late = 'accept'),
      'absent_rule', t.absent_rule, 'present_day', t.present_day, 'at_home', t.at_home, 'absent_due', absent_on_due(t, code),
      'refused', (t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(t.id, code)),
      'excused', task_excused(t.id, code),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code))
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

revoke execute on function public.absent_on_due(tasks, text) from public, anon, authenticated;
revoke execute on function public.set_task_place(uuid, boolean) from public, anon;
grant execute on function public.set_task_place(uuid, boolean) to authenticated;

-- تحديث 21: الدخول ببصمة الوجه أو الإصبع (مفتاح مرور Passkey / WebAuthn)
--   مشكلة آيفون (Safari): يمسح بيانات المواقع (ومنها معرّف الهاتف وجلسة الدخول) بعد أيام بلا استخدام، فيظهر «الحساب مرتبط بهاتف آخر».
--   مفتاح المرور محفوظ في سلسلة مفاتيح iCloud (أو مدير كلمات مرور Google)، فلا يُمسح مع بيانات المتصفح، ولا يملكه غير صاحب الحساب.
--   التحقق من التوقيع يتم في دالة الحافة «passkey» (Edge Function)، وهي وحدها التي تستدعي passkey_save و passkey_login.

create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  kind text not null check (kind in ('register', 'login')),
  student_code text,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists passkey_challenges_at on public.passkey_challenges(created_at);
alter table public.passkey_challenges enable row level security;

create table if not exists public.student_passkeys (
  cred_id text primary key,
  student_code text not null references public.students(student_code) on delete cascade,
  jwk jsonb not null,
  sign_count bigint not null default 0,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists student_passkeys_code on public.student_passkeys(student_code);
alter table public.student_passkeys enable row level security;

-- بدء التسجيل (بجلسة الطالب) أو الدخول (دون جلسة)
create or replace function public.passkey_begin(p_token text default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text; ch text := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'); cid uuid; nm text;
begin
  if (select count(*) from passkey_challenges where created_at > now() - interval '1 minute') > 300 then raise exception 'too_many_tries'; end if;
  if p_token is not null and p_token <> '' then
    code := student_from_token(p_token);
    if code is null then raise exception 'not_signed_in'; end if;
    insert into passkey_challenges(challenge, kind, student_code) values (ch, 'register', code) returning id into cid;
    select name into nm from enrollments where student_code = code limit 1;
    return json_build_object('id', cid, 'challenge', ch, 'code', code, 'name', coalesce(nm, code),
      'exclude', coalesce((select json_agg(cred_id) from student_passkeys where student_code = code), '[]'::json));
  end if;
  insert into passkey_challenges(challenge, kind) values (ch, 'login') returning id into cid;
  return json_build_object('id', cid, 'challenge', ch);
end $$;

-- للطالب: هل له مفتاح مرور؟
create or replace function public.student_passkey_count(p_token text) returns int
language plpgsql stable security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return (select count(*) from student_passkeys where student_code = code);
end $$;

-- ===== لدالة الحافة فقط (service_role) =====
create or replace function public.passkey_take_challenge(p_id uuid, p_kind text) returns json
language plpgsql security definer set search_path = public as $$
declare c passkey_challenges;
begin
  update passkey_challenges set used = true
    where id = p_id and kind = p_kind and not used and created_at > now() - interval '5 minutes'
    returning * into c;
  if c.id is null then raise exception 'challenge_expired'; end if;
  return json_build_object('challenge', c.challenge, 'code', c.student_code);
end $$;

create or replace function public.passkey_save(p_code text, p_cred text, p_jwk jsonb, p_label text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from students where student_code = p_code) then raise exception 'not_registered'; end if;
  if (select count(*) from student_passkeys where student_code = p_code) >= 10 then raise exception 'too_many_passkeys'; end if;
  insert into student_passkeys(cred_id, student_code, jwk, label) values (p_cred, p_code, p_jwk, left(p_label, 60))
    on conflict (cred_id) do nothing;
  insert into audit(actor, course_id, action)
    select e.name, e.course_id, 'فعّل الدخول ببصمة الهاتف (مفتاح مرور) على ' || coalesce(nullif(left(p_label, 60), ''), 'هاتفه')
    from enrollments e join courses c on c.id = e.course_id where e.student_code = p_code and not c.archived;
  return json_build_object('ok', true);
end $$;

create or replace function public.passkey_key(p_cred text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('code', student_code, 'jwk', jwk, 'sign_count', sign_count) from student_passkeys where cred_id = p_cred
$$;

-- دخول ناجح بمفتاح المرور: يُربط الحساب بهذا المتصفح فورًا (دون مهلة الأيام الثلاثة ودون انتظار موافقة)، لأن المفتاح لا يملكه غير صاحب الحساب
create or replace function public.passkey_login(p_cred text, p_sign_count bigint, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare k student_passkeys; st students;
begin
  select * into k from student_passkeys where cred_id = p_cred;
  if k.cred_id is null then raise exception 'unknown_passkey'; end if;
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  if p_sign_count > 0 and k.sign_count > 0 and p_sign_count <= k.sign_count then raise exception 'passkey_cloned'; end if;
  update student_passkeys set sign_count = greatest(p_sign_count, sign_count), last_used_at = now() where cred_id = p_cred;
  select * into st from students where student_code = k.student_code;
  if st.device_id is distinct from p_device then
    if exists (select 1 from students where device_id = p_device and student_code <> k.student_code) then raise exception 'device_taken'; end if;
    update students set device_id = p_device, device_label = clean_label(p_label), qr_key = gen_random_bytes(32) where student_code = k.student_code;
    update student_tokens set expires_at = now() - interval '1 second' where student_code = k.student_code;
    insert into audit(actor, course_id, action)
      select e.name, e.course_id, 'دخل ببصمة الهاتف (مفتاح مرور) من ' || coalesce(clean_label(p_label), 'متصفح جديد') || '، فارتبط به حسابه'
      from enrollments e join courses c on c.id = e.course_id where e.student_code = k.student_code and not c.archived;
  end if;
  return json_build_object('token', issue_token(k.student_code), 'code', k.student_code,
    'name', (select name from enrollments where student_code = k.student_code limit 1));
end $$;

revoke execute on function public.passkey_take_challenge(uuid, text), public.passkey_save(text, text, jsonb, text),
  public.passkey_key(text), public.passkey_login(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.passkey_take_challenge(uuid, text), public.passkey_save(text, text, jsonb, text),
  public.passkey_key(text), public.passkey_login(text, bigint, text, text) to service_role;
revoke execute on function public.passkey_begin(text), public.student_passkey_count(text) from public;
grant execute on function public.passkey_begin(text), public.student_passkey_count(text) to anon, authenticated;

-- تحديث 22: سجل أخطاء التسليم من هواتف الطلبة (للتشخيص فقط)
create table if not exists public.client_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  student_code text,
  "where" text not null,
  msg text,
  info jsonb
);
alter table public.client_errors enable row level security;

create or replace function public.client_log(p_token text, p_where text, p_msg text, p_info jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from client_errors where at > now() - interval '1 minute') > 120 then return; end if;
  insert into client_errors(student_code, "where", msg, info)
    values (case when p_token is not null then student_from_token(p_token) end, left(coalesce(p_where, ''), 40), left(p_msg, 700),
            case when jsonb_typeof(p_info) = 'object' then p_info end);
end $$;
revoke execute on function public.client_log(text, text, text, jsonb) from public;
grant execute on function public.client_log(text, text, text, jsonb) to anon, authenticated;

-- تحديث 23: الطالب يستعيد كلمة السر بنفسه
--   (1) من المتصفح المرتبط بحسابه، (2) ببصمة الوجه/الإصبع، (3) بحساب Google الذي سلّم منه تكليفاته،
--   (4) وإلا يطلب موافقة المحاضر أو المعيد بلمسة واحدة، ثم يكمل من هاتفه.

alter table public.students add column if not exists google_id text;
alter table public.students add column if not exists google_email text;
create index if not exists students_google on public.students(google_id);

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  student_code text not null references public.students(student_code) on delete cascade,
  secret_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'used')),
  device_label text,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index if not exists password_resets_code on public.password_resets(student_code, created_at desc);
alter table public.password_resets enable row level security;

-- كلمة السر الجديدة + ربط الحساب بهذا المتصفح + جلسة جديدة (مشتركة بين طرق الاستعادة)
create or replace function public.reset_password_apply(code text, p_new text, p_device text, p_label text, p_how text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare st students;
begin
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password'; end if;
  if length(coalesce(p_device, '')) < 8 then raise exception 'bad_device'; end if;
  select * into st from students where student_code = code;
  if st.student_code is null then raise exception 'not_registered'; end if;
  if st.device_id is distinct from p_device and exists (select 1 from students where device_id = p_device and student_code <> code) then raise exception 'device_taken'; end if;
  update students set pass_hash = crypt(p_new, gen_salt('bf', 10)),
    device_id = p_device, device_label = coalesce(clean_label(p_label), device_label),
    qr_key = case when device_id is distinct from p_device then gen_random_bytes(32) else qr_key end
    where student_code = code;
  update student_tokens set expires_at = now() - interval '1 second' where student_code = code;
  insert into audit(actor, course_id, action)
    select e.name, e.course_id, 'غيّر كلمة السر بنفسه (' || p_how || ')' || case when st.device_id is distinct from p_device then ' ومن متصفح جديد: ' || coalesce(clean_label(p_label), '—') else '' end
    from enrollments e join courses c on c.id = e.course_id where e.student_code = code and not c.archived;
  return json_build_object('token', issue_token(code), 'code', code, 'name', (select name from enrollments where student_code = code limit 1));
end $$;

-- (1) المتصفح المرتبط بالحساب نفسه (معرّف الجهاز سرّ لا يوجد إلا على هاتف الطالب)
create or replace function public.student_reset_on_device(p_code text, p_device text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, ''));
begin
  if student_locked(code) then raise exception 'locked'; end if;
  if length(coalesce(p_device, '')) < 8 or not exists (select 1 from students where student_code = code and device_id = p_device) then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'not_this_device');
  end if;
  return reset_password_apply(code, p_new, p_device, null, 'من هاتفه المرتبط');
end $$;

-- (2) بعد الدخول ببصمة الوجه: جلسة صالحة على المتصفح المرتبط
create or replace function public.student_set_password(p_token text, p_device text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from students where student_code = code and device_id = p_device) then raise exception 'device_mismatch'; end if;
  return reset_password_apply(code, p_new, p_device, null, 'بعد الدخول بالبصمة');
end $$;

-- (4) طلب موافقة المحاضر
create or replace function public.student_reset_request(p_code text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); sec text := encode(gen_random_bytes(24), 'hex'); rid uuid;
begin
  if not exists (select 1 from students where student_code = code) then raise exception 'not_registered'; end if;
  if (select count(*) from password_resets where student_code = code and created_at > now() - interval '1 day') >= 5 then raise exception 'too_many_tries'; end if;
  update password_resets set status = 'rejected', decided_at = now(), decided_by = 'طلب أحدث'
    where student_code = code and status = 'pending';
  insert into password_resets(student_code, secret_hash, device_label) values (code, encode(digest(sec, 'sha256'), 'hex'), clean_label(p_label)) returning id into rid;
  return json_build_object('id', rid, 'secret', sec, 'name', (select name from enrollments where student_code = code limit 1));
end $$;

create or replace function public.student_reset_status(p_id uuid, p_secret text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case when created_at < now() - interval '1 day' and status <> 'used' then 'expired' else status end
  from password_resets where id = p_id and secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')
$$;

create or replace function public.student_reset_finish(p_id uuid, p_secret text, p_new text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r password_resets;
begin
  update password_resets set status = 'used'
    where id = p_id and secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex') and status = 'approved'
      and created_at > now() - interval '1 day'
    returning * into r;
  if r.id is null then raise exception 'reset_not_approved'; end if;
  return reset_password_apply(r.student_code, p_new, p_device, p_label, 'بموافقة ' || coalesce(staff_name(r.decided_by), 'المحاضر'));
end $$;

-- لفريق المادة: الطلبات المعلّقة لطلبة المادة
create or replace function public.course_reset_requests(cid uuid) returns table(id uuid, student_code text, name text, device_label text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(course_role(cid), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  return query select r.id, r.student_code, e.name, r.device_label, r.created_at
    from password_resets r join enrollments e on e.student_code = r.student_code and e.course_id = cid
    where r.status = 'pending' and r.created_at > now() - interval '1 day' order by r.created_at;
end $$;

create or replace function public.decide_reset(rid uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r password_resets; cid uuid;
begin
  select * into r from password_resets where id = rid;
  if r.id is null or r.status <> 'pending' then raise exception 'not_found'; end if;
  select e.course_id into cid from enrollments e where e.student_code = r.student_code and coalesce(course_role(e.course_id), '') in ('owner', 'ta') limit 1;
  if cid is null then raise exception 'not_allowed'; end if;
  update password_resets set status = case when p_ok then 'approved' else 'rejected' end, decided_by = my_email(), decided_at = now() where id = rid;
  perform log_audit(cid, case when p_ok then 'وافق على استعادة كلمة سر ' else 'رفض طلب استعادة كلمة سر ' end || (select name from enrollments where student_code = r.student_code and course_id = cid));
end $$;

-- (3) حساب Google — لدالة الحافة فقط (بعد التحقق من رمز Google عند Google نفسها)
create or replace function public.google_link(p_token text, p_gid text, p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  update students set google_id = p_gid, google_email = lower(p_email) where student_code = code;
  return json_build_object('ok', true);
end $$;

create or replace function public.google_reset(p_code text, p_gid text, p_new text, p_device text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, ''));
begin
  if student_locked(code) then raise exception 'locked'; end if;
  if not exists (select 1 from students where student_code = code and google_id = p_gid) then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'google_not_linked');   -- إرجاع بدل raise حتى تُحفظ المحاولة الفاشلة
  end if;
  return reset_password_apply(code, p_new, p_device, p_label, 'بحساب Google');
end $$;

revoke execute on function public.reset_password_apply(text, text, text, text, text), public.google_link(text, text, text),
  public.google_reset(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.google_link(text, text, text), public.google_reset(text, text, text, text, text) to service_role;
revoke execute on function public.student_reset_on_device(text, text, text), public.student_set_password(text, text, text),
  public.student_reset_request(text, text, text), public.student_reset_status(uuid, text), public.student_reset_finish(uuid, text, text, text, text) from public;
grant execute on function public.student_reset_on_device(text, text, text), public.student_set_password(text, text, text),
  public.student_reset_request(text, text, text), public.student_reset_status(uuid, text), public.student_reset_finish(uuid, text, text, text, text) to anon, authenticated;
revoke execute on function public.course_reset_requests(uuid), public.decide_reset(uuid, boolean) from public, anon;
grant execute on function public.course_reset_requests(uuid), public.decide_reset(uuid, boolean) to authenticated;

-- تحديث 24: دخول من جهاز آخر لتسليم التكليفات ومتابعة الدرجات فقط (دون تسجيل حضور ودون نقل الحساب)
-- الحساب يبقى مرتبطًا بهاتفه؛ تسجيل الحضور وبطاقة الحضور تتحقق من الهاتف المرتبط كما هي.
alter table public.student_tokens add column if not exists limited boolean not null default false;

create or replace function public.token_limited(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select limited from student_tokens where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')), false)
$$;

create or replace function public.student_login_web(p_code text, p_password text, p_label text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := trim(coalesce(p_code, '')); st students; t text := encode(gen_random_bytes(32), 'hex');
begin
  if student_locked(code) then raise exception 'locked'; end if;
  select * into st from students where student_code = code;
  if st.student_code is null then raise exception 'not_registered'; end if;
  if crypt(coalesce(p_password, ''), st.pass_hash) <> st.pass_hash then
    insert into login_failures(student_code) values (code);
    return json_build_object('error', 'bad_password');
  end if;
  insert into student_tokens(token_hash, student_code, expires_at, limited)
    values (encode(digest(t, 'sha256'), 'hex'), code, now() + interval '14 days', true);
  return json_build_object('token', t, 'limited', true, 'name', (select name from enrollments where student_code = code limit 1),
    'bound_label', st.device_label);
end $$;

-- جلسة «التسليم فقط» لا تفعّل البصمة ولا تربط حساب Google (وإلا صارت طريقًا لنقل الحساب دون مهلة)
create or replace function public.passkey_begin(p_token text default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text; ch text := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'); cid uuid; nm text;
begin
  if (select count(*) from passkey_challenges where created_at > now() - interval '1 minute') > 300 then raise exception 'too_many_tries'; end if;
  if p_token is not null and p_token <> '' then
    code := student_from_token(p_token);
    if code is null then raise exception 'not_signed_in'; end if;
    if token_limited(p_token) then raise exception 'limited_session'; end if;
    insert into passkey_challenges(challenge, kind, student_code) values (ch, 'register', code) returning id into cid;
    select name into nm from enrollments where student_code = code limit 1;
    return json_build_object('id', cid, 'challenge', ch, 'code', code, 'name', coalesce(nm, code),
      'exclude', coalesce((select json_agg(cred_id) from student_passkeys where student_code = code), '[]'::json));
  end if;
  insert into passkey_challenges(challenge, kind) values (ch, 'login') returning id into cid;
  return json_build_object('id', cid, 'challenge', ch);
end $$;

create or replace function public.google_link(p_token text, p_gid text, p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if token_limited(p_token) then raise exception 'limited_session'; end if;
  update students set google_id = p_gid, google_email = lower(p_email) where student_code = code;
  return json_build_object('ok', true);
end $$;

revoke execute on function public.token_limited(text) from public, anon, authenticated;
revoke execute on function public.student_login_web(text, text, text) from public;
grant execute on function public.student_login_web(text, text, text) to anon, authenticated;
revoke execute on function public.google_link(text, text, text) from public, anon, authenticated;
grant execute on function public.google_link(text, text, text) to service_role;

-- تحديث 25: رابط تنزيل تسليمات تكليف يُرسل للدكتور (دون حساب)، ينتهي بمدة ويمكن إيقافه.
create table if not exists public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  key_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  opens int not null default 0,
  last_open timestamptz
);
create index if not exists task_links_task on public.task_links(task_id);
alter table public.task_links enable row level security;

create or replace function public.create_task_link(tid uuid, p_days int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare t tasks; k text := encode(gen_random_bytes(24), 'hex'); d int := least(greatest(coalesce(p_days, 7), 1), 60); lid uuid; ex timestamptz;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if (select count(*) from task_links where task_id = tid and created_at > now() - interval '1 day') >= 20 then raise exception 'too_many_tries'; end if;
  insert into task_links(task_id, key_hash, created_by, expires_at)
    values (tid, encode(digest(k, 'sha256'), 'hex'), my_email(), now() + make_interval(days => d)) returning id, expires_at into lid, ex;
  perform log_audit(t.course_id, 'أنشأ رابط تنزيل لتسليمات «' || t.title || '» صالحًا ' || d || ' يوم');
  return json_build_object('id', lid, 'key', k, 'expires_at', ex);
end $$;

create or replace function public.task_links_list(tid uuid) returns table(id uuid, created_by text, created_at timestamptz, expires_at timestamptz, revoked boolean, opens int, last_open timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := (select course_id from tasks where tasks.id = tid);
begin
  if coalesce(course_role(cid), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  return query select l.id, coalesce(staff_name(l.created_by), l.created_by), l.created_at, l.expires_at, l.revoked, l.opens, l.last_open
    from task_links l where l.task_id = tid order by l.created_at desc;
end $$;

create or replace function public.revoke_task_link(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select tk.* into t from task_links l join tasks tk on tk.id = l.task_id where l.id = lid;
  if t.id is null then raise exception 'not_found'; end if;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  update task_links set revoked = true where id = lid;
  perform log_audit(t.course_id, 'أوقف رابط تنزيل تسليمات «' || t.title || '»');
end $$;

-- صفحة الرابط (بلا حساب): التكليف وطلبته وتسليماتهم
create or replace function public.task_link_open(p_key text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare l task_links; t tasks; c courses;
begin
  select * into l from task_links where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if l.id is null or l.revoked then raise exception 'link_invalid'; end if;
  if l.expires_at < now() then raise exception 'link_expired'; end if;
  update task_links set opens = opens + 1, last_open = now() where id = l.id;
  select * into t from tasks where id = l.task_id;
  select * into c from courses where id = t.course_id;
  return json_build_object(
    'task', json_build_object('id', t.id, 'title', t.title, 'max_grade', t.max_grade, 'grp', t.grp, 'due_at', t.due_at,
      'present_day', t.present_day, 'at_home', t.at_home, 'absent_rule', t.absent_rule, 'course_id', t.course_id),
    'course', c.name, 'expires_at', l.expires_at,
    'rows', coalesce((select json_agg(json_build_object(
        'code', e.student_code, 'name', e.name, 'grp', e.grp,
        'absent', absent_on_due(t, e.student_code), 'excused', task_excused(t.id, e.student_code),
        'sub', case when s.task_id is null then null else json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name,
          'mime', s.mime, 'size', s.size, 'late', s.late, 'submitted_at', s.submitted_at, 'note', s.note, 'grade', s.grade, 'bonus', s.bonus, 'feedback', s.feedback) end))
      from enrollments e left join submissions s on s.task_id = t.id and s.student_code = e.student_code
      where e.course_id = t.course_id and (t.grp is null or e.grp = t.grp or (s.task_id is not null and (s.submitted_at is not null or s.url is not null or s.grade is not null)))), '[]'::json));
end $$;

revoke execute on function public.create_task_link(uuid, int), public.task_links_list(uuid), public.revoke_task_link(uuid) from public, anon;
grant execute on function public.create_task_link(uuid, int), public.task_links_list(uuid), public.revoke_task_link(uuid) to authenticated;
revoke execute on function public.task_link_open(text) from public;
grant execute on function public.task_link_open(text) to anon, authenticated;

-- تحديث 26: «تسليم استثنائي» لطالب بعينه بعد انتهاء موعد التسليم، بعذر ولمدة يحددها فريق المادة.
--   يسمح له بالتسليم حتى الموعد الجديد ولو أُغلق التسليم أو كان غائبًا يوم الطرح، ولا يُعلَّم «متأخرًا».
create table if not exists public.task_extensions (
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_code text not null,
  until timestamptz not null,
  reason text not null default '' check (length(reason) <= 300),
  by_email text not null,
  at timestamptz not null default now(),
  active boolean not null default true,
  primary key (task_id, student_code)
);
alter table public.task_extensions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_extensions' and policyname = 'task_extensions_read') then
    create policy task_extensions_read on public.task_extensions for select to authenticated using (course_role(task_course(task_id)) is not null);
  end if;
end $$;

-- موعد التسليم الاستثنائي الساري (أو null)
create or replace function public.task_ext_until(tid uuid, code text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select until from task_extensions where task_id = tid and student_code = code and active and until > now()
$$;

create or replace function public.set_task_extension(tid uuid, code text, p_until timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; nm text;
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if t.mode <> 'submit' then raise exception 'manual_task'; end if;
  select name into nm from enrollments where course_id = t.course_id and student_code = code;
  if nm is null then raise exception 'not_found'; end if;
  if p_until is null then
    update task_extensions set active = false where task_id = tid and student_code = code;
    perform log_audit(t.course_id, 'ألغى التسليم الاستثنائي لـ ' || nm || ' في «' || t.title || '»');
    return;
  end if;
  if p_until <= now() or p_until > now() + interval '60 days' then raise exception 'bad_until'; end if;
  insert into task_extensions(task_id, student_code, until, reason, by_email, at, active)
    values (tid, code, p_until, left(trim(coalesce(p_reason, '')), 300), my_email(), now(), true)
  on conflict (task_id, student_code) do update set until = excluded.until, reason = excluded.reason, by_email = excluded.by_email, at = now(), active = true;
  perform log_audit(t.course_id, 'فتح تسليمًا استثنائيًا لـ ' || nm || ' في «' || t.title || '» حتى '
    || to_char(p_until at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || case when trim(coalesce(p_reason, '')) <> '' then ' (' || left(trim(p_reason), 120) || ')' else '' end);
end $$;

create or replace function public.student_submit(p_token text, tid uuid, p_kind text, p_url text, p_file_id text, p_name text,
  p_mime text, p_size bigint, p_md5 text, p_modified timestamptz, p_note text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token); t tasks; e enrollments; s submissions; lt boolean; u text := trim(coalesce(p_url, '')); ext timestamptz;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if t.mode <> 'submit' then raise exception 'manual_task'; end if;
  select * into e from enrollments where course_id = t.course_id and student_code = code;
  select * into s from submissions where task_id = tid and student_code = code;
  ext := task_ext_until(tid, code);
  -- تكليف مجموعة أخرى: مسموح فقط لو للطالب تسليم فيه من قبل (مثلًا نُقل من تلك المجموعة) أو فُتح له تسليم استثنائي
  if e.student_code is null or (t.grp is not null and t.grp <> e.grp and s.task_id is null and ext is null)
     or (select archived from courses where id = t.course_id) then raise exception 'not_found'; end if;
  lt := now() > t.due_at and ext is null;
  if lt and t.late = 'close' then raise exception 'task_closed'; end if;
  -- «لا يُقبل ممن غاب في محاضرة يوم التسليم» إلا بعذر يقبله فريق المادة (أو تسليم استثنائي)
  if ext is null and t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(tid, code) then raise exception 'absent_on_due'; end if;
  if s.grade is not null then raise exception 'already_graded'; end if;
  if coalesce(s.version, 0) >= 30 then raise exception 'too_many_versions'; end if;
  if p_kind = 'drive' then
    if u !~ '^https://(drive|docs)\.google\.com/' or coalesce(p_file_id, '') !~ '^[A-Za-z0-9_-]{10,200}$'
       or coalesce(p_md5, '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_file'; end if;
  elsif p_kind = 'link' then
    if u !~ '^https://[^\s/$.?#][^\s]*$' or length(u) > 1000 then raise exception 'bad_link'; end if;
    p_file_id := null; p_md5 := null; p_size := null; p_mime := null; p_modified := null;
  else raise exception 'bad_file'; end if;
  insert into submissions(task_id, student_code, kind, url, file_id, file_name, mime, size, md5, file_modified, note, submitted_at, late, version)
    values (tid, code, p_kind, u, p_file_id, left(trim(coalesce(p_name, '')), 300), left(p_mime, 200), p_size, p_md5, p_modified,
            left(trim(coalesce(p_note, '')), 1000), now(), lt, 1)
  on conflict (task_id, student_code) do update set
    kind = excluded.kind, url = excluded.url, file_id = excluded.file_id, file_name = excluded.file_name, mime = excluded.mime,
    size = excluded.size, md5 = excluded.md5, file_modified = excluded.file_modified, note = excluded.note,
    submitted_at = excluded.submitted_at, late = excluded.late, version = submissions.version + 1,
    check_state = null, checked_at = null;
  return json_build_object('submitted_at', now(), 'late', lt, 'version', coalesce(s.version, 0) + 1);
end $$;

create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'open', (now() <= t.due_at or t.late = 'accept' or task_ext_until(t.id, code) is not null),
      'ext_until', task_ext_until(t.id, code),
      'ext_reason', (select x.reason from task_extensions x where x.task_id = t.id and x.student_code = code and x.active and x.until > now()),
      'absent_rule', t.absent_rule, 'present_day', t.present_day, 'at_home', t.at_home, 'absent_due', absent_on_due(t, code),
      'refused', (t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(t.id, code) and task_ext_until(t.id, code) is null),
      'excused', task_excused(t.id, code),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code)
           or task_ext_until(t.id, code) is not null)
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

revoke execute on function public.task_ext_until(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_task_extension(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.set_task_extension(uuid, text, timestamptz, text) to authenticated;
grant select on public.task_extensions to authenticated;

-- تحديث 27: المسؤول (admin) له صلاحيات صاحب المادة كاملة في كل المواد، حتى التي لم ينشئها
--   (كان «مشاهد» فقط). كل ما يفعله يُكتب في سجل المادة باسمه كالمعتاد.
create or replace function public.course_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.owner_email = my_email() then 'owner'
    when exists (select 1 from course_tas t where t.course_id = c.id and t.email = my_email() and t.kind = 'co') then 'owner'
    when exists (select 1 from course_tas t where t.course_id = c.id and t.email = my_email()) then 'ta'
    when staff_role() = 'admin' then 'owner'
  end
  from courses c where c.id = cid and staff_role() is not null
$$;

create or replace function public.course_owner(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and (c.owner_email = my_email() or staff_role() = 'admin') and staff_role() is not null)
$$;

-- تحديث 28: تقسيم درجة التكليف على مشاريع فرعية (2 إلى 10)، لكل منها اسم ودرجة عظمى؛
--   الدرجة العظمى للتكليف = مجموعها، ودرجة الطالب = مجموع درجاته فيها.
alter table public.tasks add column if not exists parts jsonb;          -- [{"name":"…","max":5}, …] أو null
alter table public.submissions add column if not exists parts jsonb;    -- [4.5, null, 3] بنفس الترتيب

create or replace function public.set_task_parts(tid uuid, p_parts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; x jsonb; nm text; mx numeric; tot numeric := 0; out jsonb := '[]'::jsonb; n int;
begin
  select * into t from tasks where id = tid;
  if t.id is null or not can_edit_task(t) then raise exception 'not_allowed'; end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    if t.parts is not null then
      update tasks set parts = null where id = tid;
      perform log_audit(t.course_id, 'ألغى تقسيم درجة التكليف «' || t.title || '» على مشاريع فرعية');
    end if;
    return;
  end if;
  n := jsonb_array_length(p_parts);
  if n < 2 or n > 10 then raise exception 'bad_parts'; end if;
  for x in select * from jsonb_array_elements(p_parts) loop
    nm := left(trim(coalesce(x->>'name', '')), 60);
    mx := nullif(x->>'max', '')::numeric;
    if nm = '' or mx is null or mx <= 0 or mx > 1000 then raise exception 'bad_parts'; end if;
    tot := tot + mx; out := out || jsonb_build_array(jsonb_build_object('name', nm, 'max', mx));
  end loop;
  if tot > 1000 then raise exception 'bad_parts'; end if;
  if exists (select 1 from submissions where task_id = tid and parts is not null and grade is not null and jsonb_array_length(parts) <> n) then raise exception 'parts_in_use'; end if;
  if tot < coalesce((select max(grade) from submissions where task_id = tid), 0) then raise exception 'max_below_grades'; end if;
  if exists (select 1 from submissions s, jsonb_array_elements(s.parts) with ordinality e(v, i)
             where s.task_id = tid and s.parts is not null and jsonb_typeof(e.v) = 'number' and (e.v #>> '{}')::numeric > (out->(e.i::int - 1)->>'max')::numeric) then raise exception 'max_below_grades'; end if;
  if t.parts is not distinct from out and t.max_grade = tot then return; end if;
  update tasks set parts = out, max_grade = tot where id = tid;
  perform log_audit(t.course_id, 'قسّم درجة التكليف «' || t.title || '» على ' || n || ' مشاريع فرعية (المجموع ' || trim_scale(tot) || ')');
end $$;

-- rows: [{"code":"…","parts":[4,3,null],"bonus":1,"feedback":"…"}] أو {"grade":…} كما كان
create or replace function public.grade_many(tid uuid, rows jsonb, p_source text) returns int
language plpgsql security definer set search_path = public as $$
declare t tasks; r jsonb; g numeric; b numeric; fb text; n int := 0; code text; old submissions; pp jsonb; x jsonb; v numeric; k int; np int;
begin
  select * into t from tasks where id = tid;
  if t.id is null or coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 2000 then raise exception 'bad_rows'; end if;
  np := case when t.parts is null then 0 else jsonb_array_length(t.parts) end;
  for r in select * from jsonb_array_elements(rows) loop
    code := trim(r->>'code');
    if not exists (select 1 from enrollments where course_id = t.course_id and student_code = code) then raise exception 'not_found'; end if;
    select * into old from submissions where task_id = tid and student_code = code;
    if np > 0 and r ? 'parts' and jsonb_typeof(r->'parts') = 'array' then
      if jsonb_array_length(r->'parts') <> np then raise exception 'bad_parts'; end if;
      pp := '[]'::jsonb; g := null;
      for k in 0 .. np - 1 loop
        x := r->'parts'->k;
        if x is null or jsonb_typeof(x) = 'null' or (x #>> '{}') = '' then pp := pp || 'null'::jsonb;
        else
          v := (x #>> '{}')::numeric;
          if v < 0 or v > (t.parts->k->>'max')::numeric then raise exception 'grade_range'; end if;
          pp := pp || jsonb_build_array(v); g := coalesce(g, 0) + v;
        end if;
      end loop;
      if g is null then pp := null; end if;
    else
      g := case when r->'grade' is null or jsonb_typeof(r->'grade') = 'null' then null else (r->>'grade')::numeric end;
      -- درجة كلية مكتوبة مباشرة: تُلغى تفاصيل المشاريع الفرعية إن تغيّرت
      pp := case when old.task_id is not null and old.grade is not distinct from g then old.parts else null end;
    end if;
    if g is not null and (g < 0 or g > t.max_grade) then raise exception 'grade_range'; end if;
    b := case when r ? 'bonus' then coalesce(nullif(r->>'bonus', '')::numeric, 0) else null end;
    if b is not null and (b < 0 or b > t.max_grade) then raise exception 'bonus_range'; end if;
    fb := case when r ? 'feedback' then left(trim(coalesce(r->>'feedback', '')), 2000) else coalesce(old.feedback, '') end;
    b := coalesce(b, old.bonus, 0);
    if old.task_id is not null and old.grade is not distinct from g and old.bonus = b and old.feedback = fb and old.parts is not distinct from pp then continue; end if;
    if old.task_id is null and g is null and b = 0 and fb = '' then continue; end if;
    insert into submissions(task_id, student_code, grade, bonus, feedback, parts, graded_by, graded_at)
      values (tid, code, g, b, fb, pp, my_email(), now())
    on conflict (task_id, student_code) do update set
      grade = excluded.grade, bonus = excluded.bonus, feedback = excluded.feedback, parts = excluded.parts, graded_by = excluded.graded_by, graded_at = excluded.graded_at;
    n := n + 1;
  end loop;
  if n > 0 then perform log_audit(t.course_id, 'رصد درجات التكليف «' || t.title || '» لـ ' || n || ' طالب' || coalesce(' · ' || nullif(trim(p_source), ''), '')); end if;
  return n;
end $$;

create or replace function public.student_tasks(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'tasks', coalesce((
    select json_agg(json_build_object(
      'id', t.id, 'course_id', c.id, 'course', c.name, 'title', t.title, 'details', t.details,
      'max', t.max_grade, 'due_at', t.due_at, 'late', t.late, 'mode', t.mode, 'grp', t.grp, 'released', t.released,
      'parts', t.parts,
      'open', (now() <= t.due_at or t.late = 'accept' or task_ext_until(t.id, code) is not null),
      'ext_until', task_ext_until(t.id, code),
      'ext_reason', (select x.reason from task_extensions x where x.task_id = t.id and x.student_code = code and x.active and x.until > now()),
      'absent_rule', t.absent_rule, 'present_day', t.present_day, 'at_home', t.at_home, 'absent_due', absent_on_due(t, code),
      'refused', (t.absent_rule = 'refuse' and absent_on_due(t, code) and not task_excused(t.id, code) and task_ext_until(t.id, code) is null),
      'excused', task_excused(t.id, code),
      'mine', (select json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name, 'mime', s.mime,
                 'size', s.size, 'submitted_at', s.submitted_at, 'late', s.late, 'version', s.version, 'note', s.note,
                 'graded', s.grade is not null,
                 'grade', case when t.released then s.grade end,
                 'parts', case when t.released then s.parts end,
                 'bonus', case when t.released then s.bonus end,
                 'feedback', case when t.released then s.feedback end)
               from submissions s where s.task_id = t.id and s.student_code = code)
    ) order by t.due_at)
    from enrollments e join courses c on c.id = e.course_id join tasks t on t.course_id = c.id
    where e.student_code = code and not c.archived
      and (t.grp is null or t.grp = e.grp or exists (select 1 from submissions x where x.task_id = t.id and x.student_code = code)
           or task_ext_until(t.id, code) is not null)
      and (t.mode = 'submit' or t.released)), '[]'::json));
end $$;

create or replace function public.task_link_open(p_key text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare l task_links; t tasks; c courses;
begin
  select * into l from task_links where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if l.id is null or l.revoked then raise exception 'link_invalid'; end if;
  if l.expires_at < now() then raise exception 'link_expired'; end if;
  update task_links set opens = opens + 1, last_open = now() where id = l.id;
  select * into t from tasks where id = l.task_id;
  select * into c from courses where id = t.course_id;
  return json_build_object(
    'task', json_build_object('id', t.id, 'title', t.title, 'max_grade', t.max_grade, 'grp', t.grp, 'due_at', t.due_at,
      'present_day', t.present_day, 'at_home', t.at_home, 'absent_rule', t.absent_rule, 'course_id', t.course_id, 'parts', t.parts),
    'course', c.name, 'expires_at', l.expires_at,
    'rows', coalesce((select json_agg(json_build_object(
        'code', e.student_code, 'name', e.name, 'grp', e.grp,
        'absent', absent_on_due(t, e.student_code), 'excused', task_excused(t.id, e.student_code),
        'sub', case when s.task_id is null then null else json_build_object('kind', s.kind, 'url', s.url, 'file_id', s.file_id, 'file_name', s.file_name,
          'mime', s.mime, 'size', s.size, 'late', s.late, 'submitted_at', s.submitted_at, 'note', s.note, 'grade', s.grade, 'parts', s.parts, 'bonus', s.bonus, 'feedback', s.feedback) end))
      from enrollments e left join submissions s on s.task_id = t.id and s.student_code = e.student_code
      where e.course_id = t.course_id and (t.grp is null or e.grp = t.grp or (s.task_id is not null and (s.submitted_at is not null or s.url is not null or s.grade is not null)))), '[]'::json));
end $$;

revoke execute on function public.set_task_parts(uuid, jsonb) from public, anon;
grant execute on function public.set_task_parts(uuid, jsonb) to authenticated;

-- تحديث 30: الدراسات العليا بقسم الديكور (لائحة الساعات المعتمدة 2017/2018)
--   الطالب يسجّل بإيميله الجامعي (@f-arts.capu.edu.eg) واسمه الرباعي بالعربي، ثم يسجّل مواد الترم المفتوحة مع الأستاذ الذي يختاره
--   بأسبقية الحجز (لكل أستاذ عدد مقاعد)، وفق قواعد اللائحة: الإجباري أولًا، وحدود ساعات الترم، وساعات الاختياري، والمتطلب السابق.
create table if not exists public.pg_programs (
  id text primary key,                         -- D-IA, D-ST, M-IA, M-ST, P-IA, P-ST
  stage text not null check (stage in ('diploma', 'master', 'phd')),
  track text not null,                         -- IA العمارة الداخلية · ST ديكور المسرح والسينما والتليفزيون
  name text not null,
  total_hours int not null, general_hours int not null, mandatory_hours int not null, elective_hours int not null, thesis_hours int not null,
  load_min int not null default 0, load_max int not null default 16,
  sort int not null default 0
);
create table if not exists public.pg_courses (
  program_id text not null references public.pg_programs(id),
  code text not null,
  name text not null,
  hours int not null check (hours > 0),
  kind text not null check (kind in ('general', 'mandatory', 'elective')),
  practical boolean not null default false,
  prereq text,
  sort int not null default 0,
  primary key (program_id, code)
);
create table if not exists public.pg_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 80),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.pg_offerings (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.pg_terms(id),
  program_id text not null,
  code text not null,
  professor text not null check (length(trim(professor)) between 2 and 120),
  staff_email text,
  capacity int not null check (capacity between 1 and 500),
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (program_id, code) references public.pg_courses(program_id, code)
);
create index if not exists pg_offerings_term on public.pg_offerings(term_id, program_id);
create table if not exists public.pg_students (
  email text primary key,
  user_id uuid,
  full_name text not null,
  program_id text not null references public.pg_programs(id),
  student_no text,
  phone text,
  created_at timestamptz not null default now()
);
create table if not exists public.pg_regs (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.pg_offerings(id),
  email text not null references public.pg_students(email),
  active boolean not null default true,
  at timestamptz not null default now(),
  dropped_at timestamptz,
  dropped_by text
);
create unique index if not exists pg_regs_one on public.pg_regs(offering_id, email) where active;
create index if not exists pg_regs_email on public.pg_regs(email);
alter table public.pg_programs enable row level security;
alter table public.pg_courses enable row level security;
alter table public.pg_terms enable row level security;
alter table public.pg_offerings enable row level security;
alter table public.pg_students enable row level security;
alter table public.pg_regs enable row level security;

create or replace function public.pg_domain_ok() returns boolean
language sql stable as $$ select my_email() like '%@f-arts.capu.edu.eg' $$;
create or replace function public.pg_is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(staff_role() = 'admin', false) $$;

-- الاسم الرباعي بالعربي: أربع كلمات عربية على الأقل
create or replace function public.pg_name_ok(n text) returns boolean
language sql immutable as $$ select coalesce(trim(regexp_replace(n, '\s+', ' ', 'g')) ~ '^[ء-ي]+( [ء-ي]+){3,}$', false) $$;

-- مواد الترم ومقاعدها لبرنامج
create or replace function public.pg_offer_rows(tid uuid, pid text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', o.id, 'code', o.code, 'name', c.name, 'hours', c.hours, 'kind', c.kind, 'prereq', c.prereq,
      'professor', o.professor, 'capacity', o.capacity,
      'taken', (select count(*) from pg_regs r where r.offering_id = o.id and r.active)) order by c.sort, o.professor), '[]'::json)
  from pg_offerings o join pg_courses c on c.program_id = o.program_id and c.code = o.code
  where o.term_id = tid and o.program_id = pid and not o.removed
$$;

create or replace function public.pg_me() returns json
language plpgsql stable security definer set search_path = public as $$
declare me pg_students; p pg_programs; t pg_terms;
begin
  if not pg_domain_ok() then raise exception 'pg_domain'; end if;
  select * into me from pg_students where email = my_email();
  select * into t from pg_terms where status = 'open' order by created_at desc limit 1;
  if me.email is null then
    return json_build_object('email', my_email(), 'profile', null,
      'programs', (select json_agg(json_build_object('id', id, 'name', name, 'stage', stage, 'track', track) order by sort) from pg_programs));
  end if;
  select * into p from pg_programs where id = me.program_id;
  return json_build_object('email', me.email,
    'profile', json_build_object('full_name', me.full_name, 'program_id', me.program_id, 'student_no', me.student_no, 'phone', me.phone),
    'program', row_to_json(p),
    'programs', (select json_agg(json_build_object('id', id, 'name', name, 'stage', stage, 'track', track) order by sort) from pg_programs),
    'courses', (select json_agg(json_build_object('code', code, 'name', name, 'hours', hours, 'kind', kind, 'prereq', prereq) order by sort) from pg_courses where program_id = p.id),
    'term', case when t.id is null then null else json_build_object('id', t.id, 'name', t.name) end,
    'offerings', case when t.id is null then '[]'::json else pg_offer_rows(t.id, p.id) end,
    'regs', coalesce((select json_agg(json_build_object('id', r.id, 'offering_id', r.offering_id, 'term_id', o.term_id, 'term', tt.name, 'code', o.code,
        'name', c.name, 'hours', c.hours, 'kind', c.kind, 'professor', o.professor, 'at', r.at) order by tt.created_at, c.sort)
      from pg_regs r join pg_offerings o on o.id = r.offering_id join pg_terms tt on tt.id = o.term_id
      join pg_courses c on c.program_id = o.program_id and c.code = o.code
      where r.email = me.email and r.active), '[]'::json));
end $$;

create or replace function public.pg_save_profile(p_name text, p_program text, p_no text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); old pg_students;
begin
  if not pg_domain_ok() then raise exception 'pg_domain'; end if;
  if not pg_name_ok(nm) then raise exception 'pg_name'; end if;
  if not exists (select 1 from pg_programs where id = p_program) then raise exception 'not_found'; end if;
  select * into old from pg_students where email = my_email();
  if old.email is not null and old.program_id <> p_program and exists (select 1 from pg_regs where email = old.email and active) then raise exception 'pg_program_locked'; end if;
  insert into pg_students(email, user_id, full_name, program_id, student_no, phone)
    values (my_email(), auth.uid(), nm, p_program, nullif(left(trim(coalesce(p_no, '')), 30), ''), nullif(left(trim(coalesce(p_phone, '')), 30), ''))
  on conflict (email) do update set full_name = excluded.full_name, program_id = excluded.program_id, student_no = excluded.student_no, phone = excluded.phone, user_id = coalesce(pg_students.user_id, excluded.user_id);
end $$;

create or replace function public.pg_register(p_offering uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me pg_students; o pg_offerings; t pg_terms; c pg_courses; p pg_programs; cur int; ele int; n int; miss text;
begin
  if not pg_domain_ok() then raise exception 'pg_domain'; end if;
  select * into me from pg_students where email = my_email();
  if me.email is null then raise exception 'pg_no_profile'; end if;
  select * into o from pg_offerings where id = p_offering and not removed for update;   -- قفل الصف: أسبقية الحجز
  if o.id is null then raise exception 'not_found'; end if;
  select * into t from pg_terms where id = o.term_id;
  if t.status <> 'open' then raise exception 'pg_term_closed'; end if;
  if o.program_id <> me.program_id then raise exception 'pg_not_your_program'; end if;
  select * into c from pg_courses where program_id = o.program_id and code = o.code;
  select * into p from pg_programs where id = me.program_id;
  if exists (select 1 from pg_regs r join pg_offerings x on x.id = r.offering_id where r.email = me.email and r.active and x.code = o.code and x.program_id = o.program_id) then
    raise exception 'pg_already'; end if;
  if c.prereq is not null and not exists (select 1 from pg_regs r join pg_offerings x on x.id = r.offering_id join pg_terms tt on tt.id = x.term_id
      where r.email = me.email and r.active and x.code = c.prereq and tt.id <> t.id) then
    raise exception 'pg_prereq:%', (select name from pg_courses where program_id = c.program_id and code = c.prereq); end if;
  select coalesce(sum(cc.hours), 0) into cur from pg_regs r join pg_offerings x on x.id = r.offering_id join pg_courses cc on cc.program_id = x.program_id and cc.code = x.code
    where r.email = me.email and r.active and x.term_id = t.id;
  if cur + c.hours > p.load_max then raise exception 'pg_load_max:%', p.load_max; end if;
  if c.kind = 'elective' then
    select coalesce(sum(cc.hours), 0) into ele from pg_regs r join pg_offerings x on x.id = r.offering_id join pg_courses cc on cc.program_id = x.program_id and cc.code = x.code
      where r.email = me.email and r.active and cc.kind = 'elective';
    if ele + c.hours > p.elective_hours then raise exception 'pg_elective_full:%', p.elective_hours; end if;
    -- الإجباري أولًا: كل مادة إجبارية مفتوحة هذا الترم لبرنامجه ولم يسجلها (وفيها مقاعد) تمنع تسجيل الاختياري
    select string_agg(distinct cc.name, '، ') into miss from pg_offerings x join pg_courses cc on cc.program_id = x.program_id and cc.code = x.code
      where x.term_id = t.id and x.program_id = p.id and not x.removed and (cc.kind = 'mandatory' or (cc.kind = 'general' and p.stage = 'diploma'))
        and not exists (select 1 from pg_regs r join pg_offerings y on y.id = r.offering_id where r.email = me.email and r.active and y.code = x.code and y.program_id = x.program_id)
        and (cc.prereq is null or exists (select 1 from pg_regs r join pg_offerings y on y.id = r.offering_id where r.email = me.email and r.active and y.code = cc.prereq and y.term_id <> t.id))
        and exists (select 1 from pg_offerings z where z.term_id = t.id and z.program_id = x.program_id and z.code = x.code and not z.removed
                    and (select count(*) from pg_regs q where q.offering_id = z.id and q.active) < z.capacity);
    if miss is not null then raise exception 'pg_mandatory_first:%', miss; end if;
  end if;
  select count(*) into n from pg_regs where offering_id = o.id and active;
  if n >= o.capacity then raise exception 'pg_full'; end if;
  insert into pg_regs(offering_id, email) values (o.id, me.email);
  return json_build_object('ok', true, 'hours', cur + c.hours);
end $$;

create or replace function public.pg_unregister(p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r pg_regs; t pg_terms;
begin
  if not pg_domain_ok() then raise exception 'pg_domain'; end if;
  select * into r from pg_regs where id = p_reg and email = my_email() and active;
  if r.id is null then raise exception 'not_found'; end if;
  select tt.* into t from pg_offerings o join pg_terms tt on tt.id = o.term_id where o.id = r.offering_id;
  if t.status <> 'open' then raise exception 'pg_term_closed'; end if;
  update pg_regs set active = false, dropped_at = now(), dropped_by = my_email() where id = r.id;
end $$;

-- ---------- المسؤول ----------
create or replace function public.pg_admin_data() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  return json_build_object(
    'programs', (select json_agg(row_to_json(p) order by sort) from pg_programs p),
    'courses', (select json_agg(row_to_json(c) order by program_id, sort) from pg_courses c),
    'terms', coalesce((select json_agg(row_to_json(t) order by created_at desc) from pg_terms t), '[]'::json),
    'offerings', coalesce((select json_agg(json_build_object('id', o.id, 'term_id', o.term_id, 'program_id', o.program_id, 'code', o.code, 'professor', o.professor,
        'staff_email', o.staff_email, 'capacity', o.capacity, 'taken', (select count(*) from pg_regs r where r.offering_id = o.id and r.active)) order by o.created_at)
      from pg_offerings o where not o.removed), '[]'::json),
    'students', coalesce((select json_agg(json_build_object('email', s.email, 'full_name', s.full_name, 'program_id', s.program_id, 'student_no', s.student_no, 'phone', s.phone, 'created_at', s.created_at) order by s.full_name) from pg_students s), '[]'::json),
    'regs', coalesce((select json_agg(json_build_object('id', r.id, 'offering_id', r.offering_id, 'email', r.email, 'at', r.at) order by r.at)
      from pg_regs r join pg_offerings o on o.id = r.offering_id where r.active and not o.removed), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('email', email, 'name', name) order by name) from staff where status <> 'suspended' and role <> 'ta'), '[]'::json));
end $$;

create or replace function public.pg_save_term(p_id uuid, p_name text, p_status text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid := p_id;
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  if p_status not in ('draft', 'open', 'closed') then raise exception 'bad_status'; end if;
  if rid is null then insert into pg_terms(name, status) values (trim(p_name), p_status) returning id into rid;
  else update pg_terms set name = trim(p_name), status = p_status where id = rid; end if;
  -- ترم واحد مفتوح للتسجيل في الوقت نفسه
  if p_status = 'open' then update pg_terms set status = 'closed' where status = 'open' and id <> rid; end if;
  return rid;
end $$;

create or replace function public.pg_save_offering(p_id uuid, p_term uuid, p_program text, p_code text, p_professor text, p_staff text, p_capacity int) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid := p_id; n int;
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  if rid is null then
    insert into pg_offerings(term_id, program_id, code, professor, staff_email, capacity)
      values (p_term, p_program, p_code, trim(p_professor), nullif(lower(trim(coalesce(p_staff, ''))), ''), p_capacity) returning id into rid;
  else
    select count(*) into n from pg_regs where offering_id = rid and active;
    if p_capacity < n then raise exception 'pg_capacity_below:%', n; end if;
    update pg_offerings set professor = trim(p_professor), staff_email = nullif(lower(trim(coalesce(p_staff, ''))), ''), capacity = p_capacity where id = rid;
  end if;
  return rid;
end $$;

create or replace function public.pg_remove_offering(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  if exists (select 1 from pg_regs where offering_id = p_id and active) then raise exception 'pg_has_regs'; end if;
  update pg_offerings set removed = true where id = p_id;
end $$;

create or replace function public.pg_admin_drop(p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  update pg_regs set active = false, dropped_at = now(), dropped_by = my_email() where id = p_reg and active;
end $$;

create or replace function public.pg_set_limits(p_program text, p_min int, p_max int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pg_is_admin() then raise exception 'not_allowed'; end if;
  if p_min < 0 or p_max < p_min or p_max > 40 then raise exception 'bad_limits'; end if;
  update pg_programs set load_min = p_min, load_max = p_max where id = p_program;
end $$;

revoke execute on function public.pg_domain_ok(), public.pg_is_admin(), public.pg_offer_rows(uuid, text) from public, anon;
revoke execute on function public.pg_me(), public.pg_save_profile(text, text, text, text), public.pg_register(uuid), public.pg_unregister(uuid),
  public.pg_admin_data(), public.pg_save_term(uuid, text, text), public.pg_save_offering(uuid, uuid, text, text, text, text, int),
  public.pg_remove_offering(uuid), public.pg_admin_drop(uuid), public.pg_set_limits(text, int, int) from public, anon;
grant execute on function public.pg_me(), public.pg_save_profile(text, text, text, text), public.pg_register(uuid), public.pg_unregister(uuid),
  public.pg_admin_data(), public.pg_save_term(uuid, text, text), public.pg_save_offering(uuid, uuid, text, text, text, text, int),
  public.pg_remove_offering(uuid), public.pg_admin_drop(uuid), public.pg_set_limits(text, int, int) to authenticated;
insert into public.pg_programs(id,stage,track,name,total_hours,general_hours,mandatory_hours,elective_hours,thesis_hours,load_min,load_max,sort) values
('D-IA','diploma','IA','دبلوم الديكور · العمارة الداخلية',48,4,30,14,0,9,15,1),
('D-ST','diploma','ST','دبلوم الديكور · ديكور المسرح والسينما والتليفزيون',48,4,30,14,0,9,15,2),
('M-IA','master','IA','ماجستير الديكور · العمارة الداخلية',38,4,16,10,8,9,16,3),
('M-ST','master','ST','ماجستير الديكور · ديكور المسرح والسينما والتليفزيون',38,4,16,10,8,9,16,4),
('P-IA','phd','IA','دكتوراه الفلسفة في الديكور · العمارة الداخلية',36,0,0,14,22,0,14,5),
('P-ST','phd','ST','دكتوراه الفلسفة في الديكور · ديكور المسرح والسينما والتليفزيون',36,0,0,14,22,0,14,6)
on conflict (id) do nothing;
insert into public.pg_courses(program_id,code,name,hours,kind,practical,prereq,sort) values
('D-IA','ديك ع 6101','حاسب آلي',2,'general',true,null,1),
('D-IA','ديك ع 6102','لغة أجنبية متخصصة',2,'general',false,null,2),
('D-IA','ديك ع 6203','مادة التخصص (1)',8,'mandatory',true,null,3),
('D-IA','ديك ع 6204','مادة التخصص (2)',8,'mandatory',true,'ديك ع 6203',4),
('D-IA','ديك ع 6205','فنون الديكور المعاصرة',3,'mandatory',false,null,5),
('D-IA','ديك ع 6206','تشكيلات فنية',4,'mandatory',true,null,6),
('D-IA','ديك ع 6207','تكنولوجيا التخصص',3,'mandatory',false,null,7),
('D-IA','ديك ع 6208','طرز',4,'mandatory',true,null,8),
('D-IA','ديك ع 6309','تحليل ونقد فني في التخصص',2,'elective',false,null,9),
('D-IA','ديك ع 6310','الفنون الشعبية',2,'elective',false,null,10),
('D-IA','ديك ع 6311','التصميم والبيئة',2,'elective',true,null,11),
('D-IA','ديك ع 6312','إضاءة',2,'elective',false,null,12),
('D-IA','ديك ع 6313','صوتيات',2,'elective',false,null,13),
('D-IA','ديك ع 6314','أسس التنسيق الحضاري',2,'elective',false,null,14),
('D-IA','ديك ع 6315','اقتصاديات العمارة الداخلية',2,'elective',false,null,15),
('D-IA','ديك ع 6316','الثقافة البصرية',2,'elective',false,null,16),
('D-IA','ديك ع 6317','الخطوط العربية واللاتينية',2,'elective',false,null,17),
('D-IA','ديك ع 6318','علوم مرتبطة بالتخصص',2,'elective',false,null,18),
('D-ST','ديك س 6101','حاسب آلي',2,'general',true,null,1),
('D-ST','ديك س 6102','لغة أجنبية متخصصة',2,'general',false,null,2),
('D-ST','ديك س 6203','مادة التخصص (1)',8,'mandatory',true,null,3),
('D-ST','ديك س 6204','مادة التخصص (2)',8,'mandatory',true,'ديك س 6203',4),
('D-ST','ديك س 6205','فنون الديكور المعاصرة',3,'mandatory',false,null,5),
('D-ST','ديك س 6206','تشكيلات فنية',4,'mandatory',true,null,6),
('D-ST','ديك س 6207','تكنولوجيا التخصص',3,'mandatory',false,null,7),
('D-ST','ديك س 6208','طرز',4,'mandatory',true,null,8),
('D-ST','ديك س 6309','تحليل ونقد فني في التخصص',2,'elective',false,null,9),
('D-ST','ديك س 6310','الفنون الشعبية',2,'elective',false,null,10),
('D-ST','ديك س 6311','إنشاءات',2,'elective',true,null,11),
('D-ST','ديك س 6312','أزياء وإكسسوارات',2,'elective',false,null,12),
('D-ST','ديك س 6313','إضاءة',2,'elective',false,null,13),
('D-ST','ديك س 6314','مؤثرات خاصة',2,'elective',false,null,14),
('D-ST','ديك س 6315','الثقافة البصرية',2,'elective',false,null,15),
('D-ST','ديك س 6316','الخطوط العربية واللاتينية',2,'elective',false,null,16),
('D-ST','ديك س 6317','علوم مرتبطة بالتخصص',2,'elective',false,null,17),
('M-IA','ديك ع 7101','حاسب آلي',2,'general',true,null,1),
('M-IA','ديك ع 7102','لغة أجنبية متخصصة',2,'general',false,null,2),
('M-IA','ديك ع 7203','مادة التخصص',4,'mandatory',true,null,3),
('M-IA','ديك ع 7204','فنون تشكيلية للتخصص',2,'mandatory',true,null,4),
('M-IA','ديك ع 7205','طرز العمارة الداخلية',2,'mandatory',true,null,5),
('M-IA','ديك ع 7206','تكنولوجيا التخصص المتقدمة',2,'mandatory',false,null,6),
('M-IA','ديك ع 7207','تجهيزات فنية',2,'mandatory',true,null,7),
('M-IA','ديك ع 7208','أصول البحث الفني',2,'mandatory',false,null,8),
('M-IA','ديك ع 7209','الاتجاهات الحديثة للبحث في مجال التخصص',2,'mandatory',false,null,9),
('M-IA','ديك ع 7310','الإضاءة والصوت للتخصص',2,'elective',true,null,10),
('M-IA','ديك ع 7311','إدارة مشروعات',2,'elective',false,null,11),
('M-IA','ديك ع 7312','تصميم مواقع داخلية',2,'elective',true,null,12),
('M-IA','ديك ع 7313','دراسات بيئية',2,'elective',false,null,13),
('M-IA','ديك ع 7314','إنشاءات',2,'elective',true,null,14),
('M-IA','ديك ع 7315','نماذج مجسمة للتخصص',2,'elective',true,null,15),
('M-IA','ديك ع 7316','العمارة المصرية القديمة',2,'elective',false,null,16),
('M-IA','ديك ع 7317','العمارة الإسلامية',2,'elective',false,null,17),
('M-IA','ديك ع 7318','عناصر الأمان والسلامة في التصميم',2,'elective',false,null,18),
('M-IA','ديك ع 7319','الاستدامة',2,'elective',false,null,19),
('M-ST','ديك س 7101','حاسب آلي',2,'general',true,null,1),
('M-ST','ديك س 7102','لغة أجنبية متخصصة',2,'general',false,null,2),
('M-ST','ديك س 7203','مادة التخصص',4,'mandatory',true,null,3),
('M-ST','ديك س 7204','فنون تشكيلية للتخصص',2,'mandatory',true,null,4),
('M-ST','ديك س 7205','طرز العمارة الداخلية',2,'mandatory',true,null,5),
('M-ST','ديك س 7206','تكنولوجيا التخصص المتقدمة',2,'mandatory',false,null,6),
('M-ST','ديك س 7207','إنشاءات',2,'mandatory',true,null,7),
('M-ST','ديك س 7208','أصول البحث الفني',2,'mandatory',false,null,8),
('M-ST','ديك س 7209','الاتجاهات الحديثة للبحث في مجال التخصص',2,'mandatory',false,null,9),
('M-ST','ديك س 7310','الإضاءة والصوت للتخصص',2,'elective',true,null,10),
('M-ST','ديك س 7311','تذوق ونقد تشكيلي',2,'elective',false,null,11),
('M-ST','ديك س 7312','الفنون الشعبية',2,'elective',false,null,12),
('M-ST','ديك س 7313','أساطير',2,'elective',false,null,13),
('M-ST','ديك س 7314','دراسات بيئية',2,'elective',false,null,14),
('M-ST','ديك س 7315','نماذج مجسمة للتخصص',2,'elective',true,null,15),
('M-ST','ديك س 7316','تصميم مواقع داخلية',2,'elective',true,null,16),
('M-ST','ديك س 7317','العمارة المصرية القديمة',2,'elective',false,null,17),
('M-ST','ديك س 7318','العمارة الإسلامية',2,'elective',false,null,18),
('M-ST','ديك س 7319','قواعد الإخراج المسرحي والسينمائي والتليفزيوني',2,'elective',false,null,19),
('M-ST','ديك س 7320','عناصر الأمان والسلامة في التصميم',2,'elective',false,null,20),
('M-ST','ديك س 7321','الاستدامة',2,'elective',false,null,21),
('P-IA','ديك ع 8301','الإبداع وفلسفة الفنون',2,'elective',false,null,1),
('P-IA','ديك ع 8302','الفنون ودورها في المجتمع',2,'elective',false,null,2),
('P-IA','ديك ع 8303','بحوث في التخصص',4,'elective',false,null,3),
('P-IA','ديك ع 8304','قراءات في التخصص',2,'elective',false,null,4),
('P-IA','ديك ع 8305','دراسات في التراث',2,'elective',false,null,5),
('P-IA','ديك ع 8306','قضايا بحثية مرتبطة',2,'elective',false,null,6),
('P-IA','ديك ع 8307','تعدد النظم في مجال التخصص',4,'elective',false,null,7),
('P-ST','ديك س 8301','الإبداع وفلسفة الفنون',2,'elective',false,null,1),
('P-ST','ديك س 8302','الفنون ودورها في المجتمع',2,'elective',false,null,2),
('P-ST','ديك س 8303','بحوث في التخصص',4,'elective',false,null,3),
('P-ST','ديك س 8304','قراءات في التخصص',2,'elective',false,null,4),
('P-ST','ديك س 8305','دراسات في التراث',2,'elective',false,null,5),
('P-ST','ديك س 8306','قضايا بحثية مرتبطة',2,'elective',false,null,6),
('P-ST','ديك س 8307','تعدد النظم في مجال التخصص',4,'elective',false,null,7),
('P-ST','ديك س 8308','التقنيات الحديثة في مجالات المسرح والسينما والتليفزيون',4,'elective',false,null,8)
on conflict (program_id,code) do nothing;

-- تحديث 31: تنبيهات الطلبة: جرس داخل الموقع + إشعار على الهاتف (Web Push)
--   تُنشأ التنبيهات تلقائيًّا: بدء محاضرة، تكليف جديد، إعلان درجات، تسليم استثنائي.
--   بعد كل إضافة يُوقَظ «push» (دالة حافة) عبر pg_net لترسل الإشعارات المعلّقة، وتعلّمها مُرسلة.
--   (على الخادم: create extension if not exists pg_net with schema extensions;)
create table if not exists public.notifications (
  id bigserial primary key,
  student_code text not null,
  kind text not null,
  title text not null,
  body text not null default '',
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed boolean not null default false
);
create index if not exists notifications_code on public.notifications(student_code, id desc);
create index if not exists notifications_unpushed on public.notifications(id) where not pushed;
alter table public.notifications enable row level security;

create table if not exists public.push_subs (
  endpoint text primary key,
  student_code text not null,
  p256dh text not null,
  auth text not null,
  label text,
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
create index if not exists push_subs_code on public.push_subs(student_code);
alter table public.push_subs enable row level security;

create or replace function public.push_url() returns text language sql immutable as $$ select 'https://bzurzvcfxlpfhcnuksyd.supabase.co/functions/v1/push' $$;

create or replace function public.notify_wake() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') and exists (select 1 from push_subs limit 1) then
    begin execute 'select net.http_post(url := $1, body := $2::jsonb, headers := $3::jsonb)' using push_url(), '{}', '{"Content-Type":"application/json"}';
    exception when others then null; end;
  end if;
  return null;
end $$;
create or replace trigger notifications_wake after insert on public.notifications for each statement execute function public.notify_wake();

-- طلبة مجموعة (أو كل المادة)
create or replace function public.notify_course(cid uuid, g text, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into notifications(student_code, kind, title, body, url)
  select e.student_code, p_kind, p_title, p_body, 'https://elrashdan.github.io/classmate/'
  from enrollments e join students s on s.student_code = e.student_code
  where e.course_id = cid and (g is null or e.grp = g)
$$;

create or replace function public.trg_notify_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.ended and new.started_at > now() - interval '15 minutes' then
    perform notify_course(new.course_id, new.grp, 'session', 'بدأت محاضرة ' || (select name from courses where id = new.course_id),
      'سجّل حضورك الآن من Hadro' || case when new.kind = 'hall' then ' وأنت في القاعة.' else '.' end);
  end if;
  return null;
end $$;
create or replace trigger sessions_notify after insert on public.sessions for each row execute function public.trg_notify_session();

create or replace function public.trg_notify_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare cn text := (select name from courses where id = new.course_id);
begin
  if tg_op = 'INSERT' and new.mode = 'submit' then
    perform notify_course(new.course_id, new.grp, 'task', 'تكليف جديد في ' || cn, '«' || new.title || '» · آخر موعد للتسليم ' || to_char(new.due_at at time zone 'Africa/Cairo', 'YYYY/MM/DD HH24:MI'));
  elsif tg_op = 'UPDATE' and new.released and not old.released then
    insert into notifications(student_code, kind, title, body, url)
    select s.student_code, 'grades', 'أُعلنت درجات «' || new.title || '»',
      cn || ' · درجتك ' || trim_scale(s.grade + coalesce(s.bonus, 0)) || ' من ' || trim_scale(new.max_grade), 'https://elrashdan.github.io/classmate/'
    from submissions s join students st on st.student_code = s.student_code where s.task_id = new.id and s.grade is not null;
  end if;
  return null;
end $$;
create or replace trigger tasks_notify after insert or update of released on public.tasks for each row execute function public.trg_notify_task();

create or replace function public.trg_notify_ext() returns trigger
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if new.active and (tg_op = 'INSERT' or not old.active or old.until <> new.until) then
    select * into t from tasks where id = new.task_id;
    insert into notifications(student_code, kind, title, body, url)
      select new.student_code, 'extension', 'فُتح لك تسليم استثنائي', '«' || t.title || '» حتى ' || to_char(new.until at time zone 'Africa/Cairo', 'YYYY/MM/DD HH24:MI'), 'https://elrashdan.github.io/classmate/'
      where exists (select 1 from students where student_code = new.student_code);
  end if;
  return null;
end $$;
create or replace trigger task_extensions_notify after insert or update on public.task_extensions for each row execute function public.trg_notify_ext();

-- الطالب: قائمة التنبيهات، وتعليمها مقروءة، والاشتراك في الإشعارات
create or replace function public.student_notifications(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return json_build_object('unread', (select count(*) from notifications where student_code = code and read_at is null),
    'push', (select count(*) from push_subs where student_code = code),
    'items', coalesce((select json_agg(x) from (select id, kind, title, body, created_at, read_at from notifications where student_code = code order by id desc limit 40) x), '[]'::json));
end $$;
create or replace function public.student_notifications_read(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  update notifications set read_at = now() where student_code = code and read_at is null;
end $$;
create or replace function public.student_push_subscribe(p_token text, p_sub jsonb, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); ep text := p_sub->>'endpoint';
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if ep !~ '^https://' or length(ep) > 1000 or coalesce(p_sub->'keys'->>'p256dh', '') = '' or coalesce(p_sub->'keys'->>'auth', '') = '' then raise exception 'bad_subscription'; end if;
  if (select count(*) from push_subs where student_code = code) >= 6 then
    update push_subs set student_code = '~' where endpoint = (select endpoint from push_subs where student_code = code order by created_at limit 1);
  end if;
  insert into push_subs(endpoint, student_code, p256dh, auth, label) values (ep, code, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth', clean_label(p_label))
  on conflict (endpoint) do update set student_code = excluded.student_code, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label;
end $$;
create or replace function public.student_push_unsubscribe(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  update push_subs set student_code = '~' where endpoint = p_endpoint and student_code = code;
end $$;

-- لدالة الحافة فقط: الإشعارات المعلّقة مع اشتراكات أصحابها (وتُعلَّم مُرسلة)
create or replace function public.push_take(p_limit int) returns json
language plpgsql security definer set search_path = public as $$
declare ids bigint[];
begin
  select array_agg(id) into ids from (select id from notifications where not pushed and created_at > now() - interval '1 day' order by id limit least(coalesce(p_limit, 300), 1000) for update skip locked) x;
  if ids is null then return '[]'::json; end if;
  update notifications set pushed = true where id = any(ids);
  return coalesce((select json_agg(json_build_object('id', n.id, 'title', n.title, 'body', n.body, 'url', n.url, 'kind', n.kind,
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
    from notifications n join push_subs s on s.student_code = n.student_code where n.id = any(ids)), '[]'::json);
end $$;
create or replace function public.push_result(p_ok text[], p_dead text[]) returns void
language sql security definer set search_path = public as $$
  update push_subs set last_ok = now() where endpoint = any(coalesce(p_ok, '{}'));
  update push_subs set student_code = '~' where endpoint = any(coalesce(p_dead, '{}'));
$$;

revoke execute on function public.notify_course(uuid, text, text, text, text), public.push_take(int), public.push_result(text[], text[]) from public, anon, authenticated;
grant execute on function public.push_take(int), public.push_result(text[], text[]) to service_role;
revoke execute on function public.student_notifications(text), public.student_notifications_read(text), public.student_push_subscribe(text, jsonb, text), public.student_push_unsubscribe(text, text) from public;
grant execute on function public.student_notifications(text), public.student_notifications_read(text), public.student_push_subscribe(text, jsonb, text), public.student_push_unsubscribe(text, text) to anon, authenticated;

-- تحديث 32: الملف الشخصي للمحاضر والمعيد (الاسم، الدرجة العلمية، التخصص، الهاتف)
alter table public.staff add column if not exists title text;
alter table public.staff add column if not exists specialty text;
alter table public.staff add column if not exists phone text;

create or replace function public.staff_update_me(p_name text, p_title text, p_specialty text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if staff_role() is null then raise exception 'not_allowed'; end if;
  if length(nm) < 3 or length(nm) > 80 then raise exception 'name_required'; end if;
  update staff set name = nm, title = nullif(left(trim(coalesce(p_title, '')), 60), ''), specialty = nullif(left(trim(coalesce(p_specialty, '')), 120), ''),
    phone = nullif(left(trim(coalesce(p_phone, '')), 30), '') where email = my_email();
end $$;
revoke execute on function public.staff_update_me(text, text, text, text) from public, anon;
grant execute on function public.staff_update_me(text, text, text, text) to authenticated;


-- مفتاح إشعارات الهاتف (VAPID) الخاص: في جدول مقفول لا يقرؤه إلا مفتاح دالة الحافة «push» (القيمة تُدخل على الخادم فقط)
create table if not exists public.app_secrets (name text primary key, value jsonb not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
create or replace function public.push_vapid() returns jsonb language sql stable security definer set search_path = public as $$ select value from app_secrets where name = 'vapid' $$;
revoke execute on function public.push_vapid() from public, anon, authenticated;
grant execute on function public.push_vapid() to service_role;

-- تحديث 33: كلمة سر مؤقتة يعطيها المسؤول لمحاضر أو معيد (بديل لا يعتمد على البريد)
--   تولّدها دالة الحافة «staffpass» عشوائيًّا وتظهر للمسؤول مرة واحدة، ويُطلب من صاحب الحساب تغييرها عند أول دخول.
alter table public.staff add column if not exists must_change_pw boolean not null default false;

create or replace function public.staff_me() returns json
language plpgsql security definer set search_path = public as $$
declare r staff;
begin
  if staff_role() is null then return null; end if;
  select * into r from staff where email = my_email();
  if r.status = 'invited' then
    update staff set status = 'active' where email = r.email;
    perform log_audit(null, r.name || ' فعّل حسابه');
    r.status := 'active';
  end if;
  return json_build_object('email', r.email, 'name', r.name, 'role', r.role, 'status', r.status, 'must_change_pw', r.must_change_pw);
end $$;

-- صاحب الحساب غيّر كلمة السر المؤقتة
create or replace function public.staff_pw_changed() returns void
language sql security definer set search_path = public as $$
  update staff set must_change_pw = false where email = my_email() and must_change_pw;
$$;
revoke execute on function public.staff_pw_changed() from public;
grant execute on function public.staff_pw_changed() to authenticated;

-- لدالة الحافة فقط: يتحقق أن الطالب مسؤول نشط وأن الحساب المقصود محاضر أو معيد غير موقوف، ويعيد معرّف حسابه في Auth إن وُجد
create or replace function public.staff_temp_pw_check(p_admin text, p_email text) returns json
language plpgsql security definer set search_path = public, auth as $$
declare a staff; t staff; uid uuid;
begin
  select * into a from staff where email = lower(p_admin) and role = 'admin' and status <> 'suspended';
  if a.email is null then raise exception 'not_admin'; end if;
  select * into t from staff where email = lower(trim(p_email));
  if t.email is null then raise exception 'not_staff'; end if;
  if t.status = 'suspended' then raise exception 'suspended'; end if;
  if t.email = a.email then raise exception 'self'; end if;
  select id into uid from auth.users where lower(email) = t.email limit 1;
  return json_build_object('uid', uid, 'email', t.email, 'name', t.name, 'admin_name', a.name);
end $$;
create or replace function public.staff_temp_pw_done(p_admin text, p_email text) returns void
language sql security definer set search_path = public as $$
  update staff set must_change_pw = true where email = lower(p_email);
  insert into audit(actor, action) select lower(p_admin), a.name || ' أعطى ' || t.name || ' كلمة سر مؤقتة' from staff a, staff t where a.email = lower(p_admin) and t.email = lower(p_email);
$$;
revoke execute on function public.staff_temp_pw_check(text, text), public.staff_temp_pw_done(text, text) from public, anon, authenticated;
grant execute on function public.staff_temp_pw_check(text, text), public.staff_temp_pw_done(text, text) to service_role;

-- حساب المسؤول الأول — غيّر الإيميل والاسم قبل التشغيل
-- ---------------------------------------------------------------------
insert into public.staff(email, name, role, status)
values (lower('ahmed.rashed@f-arts.capu.edu.eg'), 'أحمد', 'admin', 'active');
-- تحديث 34: تشديد الصلاحيات
--  - لا يصل الزائر (anon) إلى أي جدول مباشرة؛ كل شيء عبر الدوال التي تتحقق من الهوية.
--  - المستخدم المسجَّل (authenticated) يقرأ فقط الجداول التي لها سياسة قراءة، ولا يكتب في أي جدول مباشرة.
--  - الجداول الجديدة لا تأخذ صلاحيات تلقائيًّا.
--  - دوال المحفّزات الداخلية لا تُستدعى من الخارج، وتثبيت search_path لكل الدوال.
do $$
declare r record; has_pol boolean;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated', r.relname);
    select exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.relname and p.cmd in ('SELECT', 'ALL') and 'authenticated' = any(p.roles)) into has_pol;
    if not has_pol then execute format('revoke select on table public.%I from authenticated', r.relname); end if;
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.prorettype = 'trigger'::regtype or p.proname in ('notify_wake')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('alter function %s set search_path = public, extensions', r.f);
  end loop;
end $$;
revoke execute on function public.staff_pw_changed() from anon;
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on sequences from anon;
-- تحديث 35: التظلم على درجة تكليف
--   الطالب: يختار السبب (سلّمت ولم تُرصد / الدرجة مرصودة خطأ / سبب آخر) ويرفع صورة المشروع إلى Drive الخاص به (إلزامية).
--   المحاضر أو المعيد: يقبل ويكتب الدرجة الجديدة (تُرصد في الكشف مباشرة) أو يرفض ويكتب السبب، ويصل الطالب تنبيه بالقرار.
create table if not exists public.grade_appeals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_code text not null,
  reason text not null check (reason in ('not_graded', 'wrong_grade', 'other')),
  note text not null default '',
  file_id text, file_url text not null, file_name text, mime text, size bigint,
  old_grade numeric,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  new_grade numeric, reply text not null default '',
  decided_by text, decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists grade_appeals_one_open on public.grade_appeals(task_id, student_code) where status = 'pending';
create index if not exists grade_appeals_task on public.grade_appeals(task_id, status);
create index if not exists grade_appeals_student on public.grade_appeals(student_code, created_at desc);
alter table public.grade_appeals enable row level security;
revoke all on public.grade_appeals from anon, authenticated;

-- الطالب: تقديم تظلم
create or replace function public.student_appeal(p_token text, tid uuid, p_reason text, p_note text, p_file_id text, p_url text, p_name text, p_mime text, p_size bigint)
returns json language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); t tasks; s submissions; a grade_appeals; n int;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tasks where id = tid;
  if t.id is null or not exists (select 1 from enrollments where course_id = t.course_id and student_code = code) then raise exception 'not_found'; end if;
  if not t.released then raise exception 'appeal_not_released'; end if;
  if p_reason not in ('not_graded', 'wrong_grade', 'other') then raise exception 'bad_reason'; end if;
  if p_reason = 'other' and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'appeal_note'; end if;
  if coalesce(p_url, '') !~ '^https://' or length(p_url) > 600 then raise exception 'appeal_photo'; end if;
  if exists (select 1 from grade_appeals where task_id = tid and student_code = code and status = 'pending') then raise exception 'appeal_open'; end if;
  select count(*) into n from grade_appeals where task_id = tid and student_code = code;
  if n >= 3 then raise exception 'appeal_limit'; end if;
  select * into s from submissions where task_id = tid and student_code = code;
  insert into grade_appeals(task_id, student_code, reason, note, file_id, file_url, file_name, mime, size, old_grade)
    values (tid, code, p_reason, left(trim(coalesce(p_note, '')), 1000), nullif(p_file_id, ''), p_url, left(coalesce(p_name, ''), 200), left(coalesce(p_mime, ''), 100), p_size, s.grade + coalesce(s.bonus, 0))
    returning * into a;
  insert into audit(actor, course_id, action) values (coalesce((select name from enrollments where course_id = t.course_id and student_code = code), code), t.course_id, 'قدّم تظلمًا على درجة «' || t.title || '»');
  return json_build_object('id', a.id);
end $$;

-- الطالب: تظلماته (لعرض الحالة في كل تكليف)
create or replace function public.student_appeals(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return coalesce((select json_agg(json_build_object('id', a.id, 'task_id', a.task_id, 'reason', a.reason, 'note', a.note, 'status', a.status, 'new_grade', a.new_grade, 'reply', a.reply, 'created_at', a.created_at, 'decided_at', a.decided_at) order by a.created_at desc)
    from grade_appeals a where a.student_code = code and a.created_at > now() - interval '200 days'), '[]'::json);
end $$;

-- الطالب: سحب تظلم لم يُبت فيه
create or replace function public.student_appeal_withdraw(p_token text, aid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  update grade_appeals set status = 'withdrawn', decided_at = now() where id = aid and student_code = code and status = 'pending';
end $$;

-- فريق المادة: تظلمات المادة
create or replace function public.course_appeals(cid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if course_role(cid) is null then raise exception 'not_allowed'; end if;
  return coalesce((select json_agg(json_build_object('id', a.id, 'task_id', a.task_id, 'task', t.title, 'max', t.max_grade, 'student_code', a.student_code,
      'name', e.name, 'grp', e.grp, 'reason', a.reason, 'note', a.note, 'file_url', a.file_url, 'file_id', a.file_id, 'file_name', a.file_name,
      'old_grade', a.old_grade, 'cur_grade', s.grade, 'cur_bonus', s.bonus, 'status', a.status, 'new_grade', a.new_grade, 'reply', a.reply,
      'decided_by', staff_name(a.decided_by), 'decided_at', a.decided_at, 'created_at', a.created_at) order by (a.status = 'pending') desc, a.created_at desc)
    from grade_appeals a join tasks t on t.id = a.task_id
    left join enrollments e on e.course_id = t.course_id and e.student_code = a.student_code
    left join submissions s on s.task_id = a.task_id and s.student_code = a.student_code
    where t.course_id = cid and (a.status = 'pending' or a.created_at > now() - interval '120 days') and a.status <> 'withdrawn'), '[]'::json);
end $$;

-- فريق المادة: قبول (بدرجة جديدة) أو رفض (بسبب)
create or replace function public.appeal_decide(aid uuid, p_accept boolean, p_grade numeric, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare a grade_appeals; t tasks; nm text;
begin
  select * into a from grade_appeals where id = aid for update;
  if a.id is null then raise exception 'not_found'; end if;
  select * into t from tasks where id = a.task_id;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if a.status <> 'pending' then raise exception 'appeal_decided'; end if;
  nm := coalesce((select name from enrollments where course_id = t.course_id and student_code = a.student_code), a.student_code);
  if p_accept then
    if p_grade is null or p_grade < 0 or p_grade > t.max_grade then raise exception 'grade_range'; end if;
    insert into submissions(task_id, student_code, grade, bonus, feedback, graded_by, graded_at)
      values (t.id, a.student_code, p_grade, 0, '', my_email(), now())
    on conflict (task_id, student_code) do update set grade = excluded.grade, parts = null, graded_by = excluded.graded_by, graded_at = excluded.graded_at;
    update grade_appeals set status = 'accepted', new_grade = p_grade, reply = left(trim(coalesce(p_reply, '')), 1000), decided_by = my_email(), decided_at = now() where id = aid;
    perform log_audit(t.course_id, 'قبول تظلم ' || nm || ' في «' || t.title || '»: الدرجة الجديدة ' || trim_scale(p_grade) || coalesce(' (كانت ' || trim_scale(a.old_grade) || ')', ''));
    insert into notifications(student_code, kind, title, body, url)
      values (a.student_code, 'appeal', 'قُبل تظلمك في «' || t.title || '»', (select name from courses where id = t.course_id) || ' · درجتك الجديدة ' || trim_scale(p_grade) || ' من ' || trim_scale(t.max_grade) || coalesce(' · ' || nullif(trim(p_reply), ''), ''), 'https://elrashdan.github.io/classmate/');
  else
    if length(trim(coalesce(p_reply, ''))) < 3 then raise exception 'appeal_reply'; end if;
    update grade_appeals set status = 'rejected', reply = left(trim(p_reply), 1000), decided_by = my_email(), decided_at = now() where id = aid;
    perform log_audit(t.course_id, 'رفض تظلم ' || nm || ' في «' || t.title || '»');
    insert into notifications(student_code, kind, title, body, url)
      values (a.student_code, 'appeal', 'رُفض تظلمك في «' || t.title || '»', 'السبب: ' || trim(p_reply), 'https://elrashdan.github.io/classmate/');
  end if;
end $$;

-- عدد التظلمات المعلّقة لكل مادة من مواد المستخدم (للتنبيه في الصفحة الرئيسية)
create or replace function public.my_open_appeals() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(course_id, n), '{}'::json) from (
    select t.course_id, count(*) n from grade_appeals a join tasks t on t.id = a.task_id
    where a.status = 'pending' and course_role(t.course_id) is not null group by t.course_id) x;
$$;

revoke execute on function public.student_appeal(text, uuid, text, text, text, text, text, text, bigint), public.student_appeals(text), public.student_appeal_withdraw(text, uuid), public.course_appeals(uuid), public.appeal_decide(uuid, boolean, numeric, text), public.my_open_appeals() from public;
grant execute on function public.student_appeal(text, uuid, text, text, text, text, text, text, bigint), public.student_appeals(text), public.student_appeal_withdraw(text, uuid) to anon, authenticated;
grant execute on function public.course_appeals(uuid), public.appeal_decide(uuid, boolean, numeric, text), public.my_open_appeals() to authenticated;
-- update-36: تقسيم طلبة المادة غير الموزَّعين على مجموعات تلقائيًا
create or replace function public.split_groups(cid uuid, p_names text[], p_order text default 'name') returns json
language plpgsql security definer set search_path = public as $$
declare k int; n int; nm text; res json;
begin
  if course_role(cid) is null or course_role(cid) not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  k := coalesce(array_length(p_names, 1), 0);
  if k < 2 or k > 12 then raise exception 'bad_groups'; end if;
  foreach nm in array p_names loop
    if nm is null or length(trim(nm)) = 0 or length(trim(nm)) > 30 then raise exception 'bad_groups'; end if;
  end loop;
  if (select count(distinct trim(x)) from unnest(p_names) x) <> k then raise exception 'bad_groups'; end if;
  select count(*) into n from enrollments where course_id = cid and coalesce(grp, '') = '';
  if n = 0 then raise exception 'no_ungrouped'; end if;
  with u as (
    select student_code, ntile(k) over (order by case when p_order = 'code' then student_code else name end, student_code) b
    from enrollments where course_id = cid and coalesce(grp, '') = ''
  )
  update enrollments e set grp = trim(p_names[u.b]) from u
   where e.course_id = cid and e.student_code = u.student_code;
  select json_object_agg(g, c) into res from (
    select grp g, count(*) c from enrollments where course_id = cid and grp = any (select trim(x) from unnest(p_names) x) group by grp) s;
  perform log_audit(cid, 'تقسيم ' || n || ' طالب دون مجموعة تلقائيًا على ' || k || ' مجموعات: ' || array_to_string(p_names, '، '));
  return json_build_object('moved', n, 'groups', res);
end $$;
revoke all on function public.split_groups(uuid, text[], text) from public, anon;
grant execute on function public.split_groups(uuid, text[], text) to authenticated;
-- update-37: تنبيه فريق المادة بالطلبة الذين وصلوا إلى إنذار جديد ولم يُبلَّغوا بعد
create table if not exists public.warning_announced (
  course_id uuid not null references public.courses(id) on delete cascade,
  student_code text not null,
  level int not null check (level between 1 and 4),
  announced_at timestamptz not null default now(),
  announced_by text,
  primary key (course_id, student_code, level)
);
alter table public.warning_announced enable row level security;
drop policy if exists announced_read on public.warning_announced;
create policy announced_read on public.warning_announced for select to authenticated using (course_role(course_id) is not null);
revoke all on public.warning_announced from anon, authenticated;
grant select on public.warning_announced to authenticated;

-- الفريق يسجّل أنه أبلغ هؤلاء الطلبة بإنذارهم الحالي (وما قبله)
create or replace function public.warning_mark_announced(cid uuid, p_codes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare code text; l int; n int := 0;
begin
  if course_role(cid) is null or course_role(cid) not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if coalesce(array_length(p_codes, 1), 0) > 2000 then raise exception 'too_many'; end if;
  foreach code in array coalesce(p_codes, '{}') loop
    if not exists (select 1 from enrollments where course_id = cid and student_code = code) then continue; end if;
    l := warn_level(course_absences(cid, code));
    if l > 0 then
      insert into warning_announced(course_id, student_code, level, announced_by)
        select cid, code, g, my_email() from generate_series(1, l) g on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform log_audit(cid, 'إبلاغ ' || n || ' طالب بإنذارات الغياب'); end if;
  return n;
end $$;
revoke all on function public.warning_mark_announced(uuid, text[]) from public, anon;
grant execute on function public.warning_mark_announced(uuid, text[]) to authenticated;

-- ملخص لكل مواد عضو الفريق: كم طالبًا وصل إلى مستوى إنذار لم يطّلع عليه ولم يُبلَّغ به
create or replace function public.my_warning_alerts() returns json
language sql stable security definer set search_path = public as $$
  with my as (
    select c.id, c.name from courses c where not c.archived and course_role(c.id) is not null
  ), lv as (
    select m.id cid, m.name, e.student_code, warn_level(course_absences(m.id, e.student_code)) l
    from my m join enrollments e on e.course_id = m.id
  ), pend as (
    select * from lv where l > 0
      and not exists (select 1 from warning_notices w where w.course_id = lv.cid and w.student_code = lv.student_code and w.level = lv.l)
      and not exists (select 1 from warning_announced a where a.course_id = lv.cid and a.student_code = lv.student_code and a.level = lv.l)
  )
  select coalesce(json_agg(json_build_object('course_id', cid, 'name', name, 'n', n, 'levels', levels) order by n desc), '[]'::json)
  from (select cid, name, sum(k)::int n, json_object_agg(l, k) levels
        from (select cid, name, l, count(*)::int k from pend group by cid, name, l) x group by cid, name) y
$$;
revoke all on function public.my_warning_alerts() from public, anon;
grant execute on function public.my_warning_alerts() to authenticated;
-- update-38: دوال الفريق لا يستدعيها الزائر غير المسجَّل
do $$ declare r record; begin
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('appeal_decide','course_appeals','my_open_appeals','course_bindings','create_course','create_task','grade_many','update_course_info','split_groups','warning_mark_announced','my_warning_alerts')
  loop execute format('revoke execute on function %s from anon, public', r.f); execute format('grant execute on function %s to authenticated', r.f); end loop;
end $$;
alter default privileges in schema public revoke execute on functions from anon;
-- update-39: فهارس للمفاتيح الأجنبية (أسرع مع زيادة عدد المعيدين والطلبة)
create index if not exists course_tas_email on public.course_tas(email);
create index if not exists courses_owner_email on public.courses(owner_email);
create index if not exists student_tokens_code on public.student_tokens(student_code);
create index if not exists pg_students_program on public.pg_students(program_id);
create index if not exists pg_offerings_prog_code on public.pg_offerings(program_id, code);
-- update-40: المحاضر يتحكم في مهلة التظلم لكل تكليف (مفتوح دائمًا بعد الإعلان / مغلق / من وقت إلى وقت)
alter table public.tasks add column if not exists appeal_mode text not null default 'auto';
alter table public.tasks add column if not exists appeal_from timestamptz;
alter table public.tasks add column if not exists appeal_until timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_appeal_mode_chk') then
    alter table public.tasks add constraint tasks_appeal_mode_chk check (appeal_mode in ('auto', 'closed', 'window'));
  end if;
end $$;

create or replace function public.appeal_is_open(t public.tasks) returns boolean
language sql stable set search_path = public as $$
  select coalesce(t.released, false) and case t.appeal_mode
    when 'closed' then false
    when 'window' then (t.appeal_from is null or now() >= t.appeal_from) and (t.appeal_until is null or now() < t.appeal_until)
    else true end
$$;

create or replace function public.set_task_appeals(tid uuid, p_mode text, p_from timestamptz, p_until timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks; msg text; fmt text := 'YYYY/MM/DD HH24:MI';
begin
  select * into t from tasks where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if p_mode not in ('auto', 'closed', 'window') then raise exception 'bad_mode'; end if;
  if p_mode = 'window' then
    p_from := coalesce(p_from, now());
    if p_until is null or p_until <= p_from or p_until > p_from + interval '120 days' then raise exception 'bad_window'; end if;
  else p_from := null; p_until := null; end if;
  update tasks set appeal_mode = p_mode, appeal_from = p_from, appeal_until = p_until where id = tid;
  msg := case p_mode when 'closed' then 'إغلاق باب التظلم' when 'auto' then 'فتح باب التظلم دون موعد إغلاق'
    else 'فتح باب التظلم من ' || to_char(p_from at time zone 'Africa/Cairo', fmt) || ' حتى ' || to_char(p_until at time zone 'Africa/Cairo', fmt) end;
  perform log_audit(t.course_id, msg || ' في «' || t.title || '»');
  -- تنبيه الطلبة عند فتح باب التظلم لتكليف أُعلنت درجاته
  if t.released and p_mode <> 'closed' then
    perform notify_course(t.course_id, t.grp, 'appeal', 'باب التظلم مفتوح في «' || t.title || '»',
      (select name from courses where id = t.course_id) || case when p_mode = 'window'
        then case when p_from > now() + interval '5 minutes' then ' · يُفتح ' || to_char(p_from at time zone 'Africa/Cairo', fmt) else '' end
             || ' · حتى ' || to_char(p_until at time zone 'Africa/Cairo', fmt) else '' end);
  end if;
end $$;
revoke all on function public.set_task_appeals(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_task_appeals(uuid, text, timestamptz, timestamptz) to authenticated;

-- حالة باب التظلم لكل تكليف أُعلنت درجاته في مواد الطالب
create or replace function public.student_appeal_windows(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return coalesce((select json_object_agg(t.id, json_build_object('open', appeal_is_open(t), 'mode', t.appeal_mode, 'from', t.appeal_from, 'until', t.appeal_until))
    from tasks t join enrollments e on e.course_id = t.course_id and e.student_code = code
    where t.released), '{}'::json);
end $$;
revoke all on function public.student_appeal_windows(text) from public;
grant execute on function public.student_appeal_windows(text) to anon, authenticated;

-- التظلم لا يُقبل إلا وباب التظلم مفتوح
create or replace function public.student_appeal(p_token text, tid uuid, p_reason text, p_note text, p_file_id text, p_url text, p_name text, p_mime text, p_size bigint)
returns json language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); t tasks; s submissions; a grade_appeals; n int;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tasks where id = tid;
  if t.id is null or not exists (select 1 from enrollments where course_id = t.course_id and student_code = code) then raise exception 'not_found'; end if;
  if not t.released then raise exception 'appeal_not_released'; end if;
  if not appeal_is_open(t) then raise exception 'appeal_closed'; end if;
  if p_reason not in ('not_graded', 'wrong_grade', 'other') then raise exception 'bad_reason'; end if;
  if p_reason = 'other' and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'appeal_note'; end if;
  if coalesce(p_url, '') !~ '^https://' or length(p_url) > 600 then raise exception 'appeal_photo'; end if;
  if exists (select 1 from grade_appeals where task_id = tid and student_code = code and status = 'pending') then raise exception 'appeal_open'; end if;
  select count(*) into n from grade_appeals where task_id = tid and student_code = code;
  if n >= 3 then raise exception 'appeal_limit'; end if;
  select * into s from submissions where task_id = tid and student_code = code;
  insert into grade_appeals(task_id, student_code, reason, note, file_id, file_url, file_name, mime, size, old_grade)
    values (tid, code, p_reason, left(trim(coalesce(p_note, '')), 1000), nullif(p_file_id, ''), p_url, left(coalesce(p_name, ''), 200), left(coalesce(p_mime, ''), 100), p_size, s.grade + coalesce(s.bonus, 0))
    returning * into a;
  insert into audit(actor, course_id, action) values (coalesce((select name from enrollments where course_id = t.course_id and student_code = code), code), t.course_id, 'قدّم تظلمًا على درجة «' || t.title || '»');
  return json_build_object('id', a.id);
end $$;
-- update-41: إشعار على هاتف الطالب لحظة وصوله إلى مستوى إنذار جديد + متابعة الفريق لمن فعّل الإشعارات
create table if not exists public.warning_pushed (
  course_id uuid not null references public.courses(id) on delete cascade,
  student_code text not null,
  level int not null check (level between 1 and 4),
  at timestamptz not null default now(),
  primary key (course_id, student_code, level)
);
alter table public.warning_pushed enable row level security;
revoke all on public.warning_pushed from anon, authenticated;

-- المستويات الحالية تُعتبر مُرسلة (حتى لا تصل إشعارات قديمة دفعة واحدة)، ويُرسل فقط ما يستجد
insert into public.warning_pushed(course_id, student_code, level)
select e.course_id, e.student_code, g from public.enrollments e
  cross join lateral generate_series(1, public.warn_level(public.course_absences(e.course_id, e.student_code))) g
on conflict do nothing;

create or replace function public.warn_push(cid uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare ab int; l int; prev int; cn text; ttl text;
begin
  ab := course_absences(cid, code); l := warn_level(ab);
  if l = 0 then return; end if;
  select coalesce(max(level), 0) into prev from warning_pushed where course_id = cid and student_code = code;
  if l <= prev then return; end if;
  insert into warning_pushed(course_id, student_code, level) select cid, code, g from generate_series(prev + 1, l) g on conflict do nothing;
  cn := (select name from courses where id = cid);
  ttl := case l when 1 then 'إنذار أول' when 2 then 'إنذار ثانٍ' when 3 then 'إنذار ثالث ونهائي' else 'انسحاب إجباري' end;
  insert into notifications(student_code, kind, title, body, url)
    values (code, 'warning', ttl || ' في ' || cn,
      'غبت ' || ab || case when ab between 3 and 10 then ' مرات' else ' مرة' end || '. ' ||
      case when l >= 4 then 'تجاوزت الحد المسموح به للغياب. راجع المحاضر.' when l = 3 then 'غياب آخر يعني الانسحاب الإجباري من المادة.' else 'افتح Hadro لتعرف تفاصيل غيابك.' end,
      'https://elrashdan.github.io/classmate/');
exception when others then null; -- لا يعطّل أبدًا العملية الأصلية
end $$;
revoke all on function public.warn_push(uuid, text) from public, anon, authenticated;

-- عند انتهاء محاضرة أو إغلاق تسجيلها: افحص طلبة مجموعتها
create or replace function public.trg_warn_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (new.ended and not coalesce(old.ended, false)) or (new.closed_at is not null and old.closed_at is null) then
    for r in select student_code from enrollments where course_id = new.course_id and (new.grp is null or grp = new.grp) loop
      perform warn_push(new.course_id, r.student_code);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists sessions_warn on public.sessions;
create trigger sessions_warn after update on public.sessions for each row execute function public.trg_warn_session();

-- عند تعديل الحضور (إلغاء أو رفض) في محاضرة منتهية: افحص الطالب نفسه
create or replace function public.trg_warn_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare s sessions; code text := coalesce(new.student_code, old.student_code);
begin
  select * into s from sessions where id = coalesce(new.session_id, old.session_id);
  if s.id is not null and (s.ended or s.closed_at is not null or now() >= s.ends_at) then perform warn_push(s.course_id, code); end if;
  return null;
end $$;
drop trigger if exists attendance_warn on public.attendance;
create trigger attendance_warn after update or delete on public.attendance for each row execute function public.trg_warn_attendance();
revoke execute on function public.trg_warn_session(), public.trg_warn_attendance() from public, anon, authenticated;

-- الفريق: من فعّل الإشعارات من طلبة المادة
create or replace function public.course_push_status(cid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if course_role(cid) is null then raise exception 'not_allowed'; end if;
  return coalesce((select json_agg(distinct p.student_code) from push_subs p join enrollments e on e.course_id = cid and e.student_code = p.student_code), '[]'::json);
end $$;
revoke all on function public.course_push_status(uuid) from public, anon;
grant execute on function public.course_push_status(uuid) to authenticated;
-- update-42: إعادة تقسيم كل طلبة المادة من الأول (اختياري)، مع الإبقاء على التقسيم الجزئي
create or replace function public.split_groups(cid uuid, p_names text[], p_order text default 'name', p_all boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare k int; n int; nm text; res json;
begin
  if course_role(cid) is null or course_role(cid) not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  k := coalesce(array_length(p_names, 1), 0);
  if k < 2 or k > 12 then raise exception 'bad_groups'; end if;
  foreach nm in array p_names loop
    if nm is null or length(trim(nm)) = 0 or length(trim(nm)) > 30 then raise exception 'bad_groups'; end if;
  end loop;
  if (select count(distinct trim(x)) from unnest(p_names) x) <> k then raise exception 'bad_groups'; end if;
  select count(*) into n from enrollments where course_id = cid and (p_all or coalesce(grp, '') = '');
  if n = 0 then raise exception 'no_ungrouped'; end if;
  if n < k then raise exception 'bad_groups'; end if;
  with u as (
    select student_code, ntile(k) over (order by case when p_order = 'code' then student_code else name end, student_code) b
    from enrollments where course_id = cid and (p_all or coalesce(grp, '') = '')
  )
  update enrollments e set grp = trim(p_names[u.b]) from u
   where e.course_id = cid and e.student_code = u.student_code;
  select json_object_agg(g, c) into res from (
    select grp g, count(*) c from enrollments where course_id = cid and grp = any (select trim(x) from unnest(p_names) x) group by grp) s;
  perform log_audit(cid, case when p_all then 'إعادة تقسيم كل طلبة المادة (' || n || ') من الأول على ' else 'تقسيم ' || n || ' طالب دون مجموعة تلقائيًا على ' end
    || k || ' مجموعات: ' || array_to_string(p_names, '، '));
  return json_build_object('moved', n, 'groups', res);
end $$;
drop function if exists public.split_groups(uuid, text[], text);
revoke all on function public.split_groups(uuid, text[], text, boolean) from public, anon;
grant execute on function public.split_groups(uuid, text[], text, boolean) to authenticated;
-- update-43: فريق المادة يرسل تنبيهًا مباشرًا (إشعار على الهاتف) للطلبة الذين وصلوا إلى إنذار، ويُسجَّلون «مُبلَّغين»
create or replace function public.warning_notify(cid uuid, p_codes text[], p_note text default '') returns json
language plpgsql security definer set search_path = public as $$
declare code text; ab int; l int; n int := 0; ph int := 0; cn text; ttl text; who text;
begin
  if course_role(cid) is null or course_role(cid) not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if coalesce(array_length(p_codes, 1), 0) > 2000 then raise exception 'too_many'; end if;
  cn := (select name from courses where id = cid);
  who := coalesce(staff_name(my_email()), 'فريق المادة');
  foreach code in array coalesce(p_codes, '{}') loop
    if not exists (select 1 from enrollments where course_id = cid and student_code = code) then continue; end if;
    ab := course_absences(cid, code); l := warn_level(ab);
    if l = 0 then continue; end if;
    ttl := case l when 1 then 'إنذار أول' when 2 then 'إنذار ثانٍ' when 3 then 'إنذار ثالث ونهائي' else 'انسحاب إجباري' end;
    insert into notifications(student_code, kind, title, body, url)
      values (code, 'warning', 'تنبيه من ' || who || ': ' || ttl || ' في ' || cn,
        'غبت ' || ab || case when ab between 3 and 10 then ' مرات' else ' مرة' end || '.' ||
        coalesce(' ' || nullif(left(trim(coalesce(p_note, '')), 300), ''), case when l >= 3 then ' التزم بالحضور، فالغياب القادم له عواقب على المادة.' else ' التزم بالحضور.' end),
        'https://elrashdan.github.io/classmate/');
    insert into warning_announced(course_id, student_code, level, announced_by)
      select cid, code, g, my_email() from generate_series(1, l) g on conflict do nothing;
    insert into warning_pushed(course_id, student_code, level)
      select cid, code, g from generate_series(1, l) g on conflict do nothing;
    n := n + 1;
    if exists (select 1 from push_subs where student_code = code) then ph := ph + 1; end if;
  end loop;
  if n > 0 then perform log_audit(cid, 'إرسال تنبيه غياب إلى ' || n || ' طالب'); end if;
  return json_build_object('sent', n, 'phones', ph);
end $$;
revoke all on function public.warning_notify(uuid, text[], text) from public, anon;
grant execute on function public.warning_notify(uuid, text[], text) to authenticated;
-- update-44: الخادم يرفض UPDATE بدون WHERE (حماية safeupdate)، فإعدادات القسم صارت بـ where true
create or replace function public.admin_set_domain(p_domain text) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(trim(both '@ ' from coalesce(p_domain, '')));
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  if d <> '' and my_email() not like '%@' || d then raise exception 'domain_locks_you_out'; end if;
  update settings set domain = d where true;
  perform log_audit(null, 'غيّر نطاق بريد الجامعة إلى ' || case when d = '' then '(أي نطاق)' else d end);
end $$;
create or replace function public.admin_set_ta_create(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  update settings set ta_can_create = coalesce(p_on, false) where true;
  perform log_audit(null, case when p_on then 'سمح للمعيدين بإنشاء مواد' else 'منع المعيدين من إنشاء مواد' end);
end $$;
-- update-45: طلبات تسجيل المعيدين والمحاضرين + إشعارات الهاتف لأعضاء هيئة التدريس
create table if not exists public.staff_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  name text not null,
  role text not null default 'ta' check (role in ('ta', 'lecturer')),
  phone text not null default '',
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  token_hash text not null,
  push boolean not null default false,
  reply text not null default '',
  decided_by text, decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_requests_one_pending on public.staff_requests(email) where status = 'pending';
create index if not exists staff_requests_status on public.staff_requests(status, created_at desc);
alter table public.staff_requests enable row level security;
revoke all on public.staff_requests from anon, authenticated;

-- اشتراك إشعارات بمفتاح عام (staff:<email> أو req:<id>) — داخلي
create or replace function public.push_save(p_key text, p_sub jsonb, p_label text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ep text := p_sub->>'endpoint';
begin
  if ep !~ '^https://' or length(ep) > 1000 or coalesce(p_sub->'keys'->>'p256dh', '') = '' or coalesce(p_sub->'keys'->>'auth', '') = '' then raise exception 'bad_subscription'; end if;
  if (select count(*) from push_subs where student_code = p_key) >= 6 then
    update push_subs set student_code = '~' where endpoint = (select endpoint from push_subs where student_code = p_key order by created_at limit 1);
  end if;
  insert into push_subs(endpoint, student_code, p256dh, auth, label) values (ep, p_key, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth', clean_label(p_label))
  on conflict (endpoint) do update set student_code = excluded.student_code, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label;
end $$;
revoke all on function public.push_save(text, jsonb, text) from public, anon, authenticated;

-- إشعار لكل المسؤولين
create or replace function public.notify_admins(p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into notifications(student_code, kind, title, body, url)
  select 'staff:' || email, p_kind, p_title, p_body, 'https://elrashdan.github.io/classmate/staff.html' from staff where role = 'admin' and status <> 'suspended';
$$;
revoke all on function public.notify_admins(text, text, text) from public, anon, authenticated;

create or replace function public.staff_request_create(p_email text, p_name text, p_role text, p_phone text, p_note text, p_sub jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare e text := lower(trim(coalesce(p_email, ''))); nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  d text; t text := encode(gen_random_bytes(24), 'hex'); r staff_requests;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 120 then raise exception 'bad_email'; end if;
  select domain into d from settings limit 1;
  if coalesce(d, '') <> '' and e not like '%@' || d then raise exception 'wrong_domain'; end if;
  if coalesce(d, '') = '' and e !~ '\.edu\.eg$' then raise exception 'uni_email'; end if;
  if array_length(regexp_split_to_array(nm, ' '), 1) < 3 or length(nm) > 80 or nm ~ '[0-9@<>]' then raise exception 'name_3'; end if;
  if p_role not in ('ta', 'lecturer') then raise exception 'bad_role'; end if;
  if exists (select 1 from staff where email = e and status <> 'suspended') then raise exception 'already_staff'; end if;
  if (select count(*) from staff_requests where email = e and created_at > now() - interval '1 day') >= 3 then raise exception 'too_many_requests'; end if;
  if (select count(*) from staff_requests where created_at > now() - interval '1 hour') >= 60 then raise exception 'too_many_requests'; end if;
  update staff_requests set status = 'cancelled' where email = e and status = 'pending';
  insert into staff_requests(email, name, role, phone, note, token_hash)
    values (e, nm, p_role, left(regexp_replace(coalesce(p_phone, ''), '[^0-9+ ]', '', 'g'), 20), left(trim(coalesce(p_note, '')), 300), encode(digest(t, 'sha256'), 'hex'))
    returning * into r;
  if p_sub is not null and p_sub ? 'endpoint' then
    perform push_save('req:' || r.id, p_sub, 'طلب تسجيل');
    update staff_requests set push = true where id = r.id;
  end if;
  perform notify_admins('staff_request', 'طلب تسجيل جديد', nm || ' (' || case p_role when 'ta' then 'معيد' else 'محاضر' end || ') · ' || e);
  return json_build_object('id', r.id, 'token', t);
end $$;

create or replace function public.staff_request_status(p_id uuid, p_token text) returns json
language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('status', status, 'reply', reply, 'email', email, 'name', name, 'role', role, 'push', push, 'created_at', created_at, 'decided_at', decided_at)
  from staff_requests where id = p_id and token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.staff_request_push(p_id uuid, p_token text, p_sub jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from staff_requests where id = p_id and token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')) then raise exception 'not_found'; end if;
  perform push_save('req:' || p_id, p_sub, 'طلب تسجيل');
  update staff_requests set push = true where id = p_id;
end $$;

create or replace function public.admin_staff_requests() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'email', email, 'name', name, 'role', role, 'phone', phone, 'note', note, 'status', status,
      'push', push, 'reply', reply, 'decided_by', staff_name(decided_by), 'decided_at', decided_at, 'created_at', created_at) order by (status = 'pending') desc, created_at desc)
    from staff_requests where status = 'pending' or created_at > now() - interval '30 days'), '[]'::json);
end $$;

create or replace function public.admin_decide_request(p_id uuid, p_ok boolean, p_role text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare r staff_requests; rl text := coalesce(nullif(p_role, ''), 'ta');
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  select * into r from staff_requests where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'request_decided'; end if;
  if p_ok then
    if rl not in ('ta', 'lecturer') then raise exception 'bad_role'; end if;
    insert into staff(email, name, role, phone) values (r.email, r.name, rl, r.phone)
      on conflict (email) do update set name = excluded.name, role = case when staff.role = 'admin' then 'admin' else excluded.role end, status = 'invited', phone = coalesce(nullif(excluded.phone, ''), staff.phone);
    update staff_requests set status = 'approved', role = rl, reply = left(trim(coalesce(p_reply, '')), 300), decided_by = my_email(), decided_at = now() where id = p_id;
    perform log_audit(null, 'وافق على طلب تسجيل ' || r.name || ' بصفة ' || case rl when 'ta' then 'معيد' else 'محاضر' end);
    insert into notifications(student_code, kind, title, body, url)
      values ('req:' || r.id, 'staff_request', 'تمت الموافقة على حسابك في Hadro', 'ادخل الآن ببريدك الجامعي واختر كلمة السر.', 'https://elrashdan.github.io/classmate/staff.html');
  else
    if length(trim(coalesce(p_reply, ''))) < 3 then raise exception 'reply_required'; end if;
    update staff_requests set status = 'rejected', reply = left(trim(p_reply), 300), decided_by = my_email(), decided_at = now() where id = p_id;
    perform log_audit(null, 'رفض طلب تسجيل ' || r.name);
    insert into notifications(student_code, kind, title, body, url)
      values ('req:' || r.id, 'staff_request', 'لم تتم الموافقة على طلب حسابك', 'السبب: ' || trim(p_reply), 'https://elrashdan.github.io/classmate/staff.html');
  end if;
end $$;

-- إشعارات الهاتف لعضو هيئة التدريس المسجّل
create or replace function public.staff_push_subscribe(p_sub jsonb, p_label text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is null then raise exception 'not_allowed'; end if;
  perform push_save('staff:' || my_email(), p_sub, p_label);
end $$;
create or replace function public.staff_push_status() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from push_subs where student_code = 'staff:' || my_email());
$$;

revoke all on function public.staff_request_create(text, text, text, text, text, jsonb), public.staff_request_status(uuid, text), public.staff_request_push(uuid, text, jsonb),
  public.admin_staff_requests(), public.admin_decide_request(uuid, boolean, text, text), public.staff_push_subscribe(jsonb, text), public.staff_push_status() from public;
grant execute on function public.staff_request_create(text, text, text, text, text, jsonb), public.staff_request_status(uuid, text), public.staff_request_push(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.admin_staff_requests(), public.admin_decide_request(uuid, boolean, text, text), public.staff_push_subscribe(jsonb, text), public.staff_push_status() to authenticated;
-- update-46: الاستفسارات والشكاوى والمقترحات (من الطالب أو عضو هيئة التدريس إلى المسؤول)
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  sender_kind text not null check (sender_kind in ('student', 'staff')),
  sender text not null,
  sender_name text not null default '',
  course_id uuid references public.courses(id) on delete set null,
  category text not null check (category in ('question', 'problem', 'complaint', 'suggestion')),
  subject text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_unread boolean not null default true,
  user_unread boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ticket_msgs (
  id bigserial primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  from_admin boolean not null default false,
  author text not null default '',
  body text not null,
  at timestamptz not null default now()
);
create index if not exists tickets_sender on public.tickets(sender_kind, sender, updated_at desc);
create index if not exists tickets_status on public.tickets(status, updated_at desc);
create index if not exists ticket_msgs_t on public.ticket_msgs(ticket_id, id);
alter table public.tickets enable row level security;
alter table public.ticket_msgs enable row level security;
revoke all on public.tickets, public.ticket_msgs from anon, authenticated;
revoke all on sequence public.ticket_msgs_id_seq from anon, authenticated;

create or replace function public.ticket_json(t public.tickets, admin boolean) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', t.id, 'kind', t.sender_kind, 'sender', case when admin then t.sender end, 'name', case when admin then t.sender_name end,
    'course', (select name from courses where id = t.course_id), 'course_id', t.course_id, 'category', t.category, 'subject', t.subject, 'status', t.status,
    'unread', case when admin then t.admin_unread else t.user_unread end, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'msgs', coalesce((select json_agg(json_build_object('id', m.id, 'admin', m.from_admin, 'author', case when m.from_admin then coalesce(staff_name(m.author), 'المسؤول') else t.sender_name end, 'body', m.body, 'at', m.at) order by m.id) from ticket_msgs m where m.ticket_id = t.id), '[]'::json))
$$;
revoke all on function public.ticket_json(public.tickets, boolean) from public, anon, authenticated;

create or replace function public.ticket_open(p_kind text, p_sender text, p_name text, p_cat text, p_subject text, p_body text, p_course uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t tickets; cat text := case p_cat when 'question' then 'استفسار' when 'problem' then 'مشكلة' when 'complaint' then 'شكوى' else 'اقتراح' end;
begin
  if p_cat not in ('question', 'problem', 'complaint', 'suggestion') then raise exception 'bad_category'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 then raise exception 'ticket_subject'; end if;
  if length(trim(coalesce(p_body, ''))) < 10 then raise exception 'ticket_body'; end if;
  if (select count(*) from tickets where sender_kind = p_kind and sender = p_sender and created_at > now() - interval '1 day') >= 5 then raise exception 'too_many_requests'; end if;
  insert into tickets(sender_kind, sender, sender_name, course_id, category, subject)
    values (p_kind, p_sender, coalesce(p_name, ''), p_course, p_cat, left(trim(p_subject), 120)) returning * into t;
  insert into ticket_msgs(ticket_id, from_admin, author, body) values (t.id, false, p_sender, left(trim(p_body), 3000));
  perform notify_admins('ticket', cat || ' جديد: ' || t.subject, coalesce(nullif(p_name, ''), p_sender) || case when p_kind = 'student' then ' (طالب)' else ' (هيئة التدريس)' end);
  return t.id;
end $$;
create or replace function public.ticket_add(t public.tickets, p_admin boolean, p_author text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_body, ''))) < 2 then raise exception 'ticket_body'; end if;
  if t.status = 'closed' and not p_admin then raise exception 'ticket_closed'; end if;
  if (select count(*) from ticket_msgs where ticket_id = t.id) >= 60 then raise exception 'too_many_requests'; end if;
  insert into ticket_msgs(ticket_id, from_admin, author, body) values (t.id, p_admin, p_author, left(trim(p_body), 3000));
  if p_admin then
    update tickets set status = case when status = 'closed' then 'closed' else 'answered' end, user_unread = true, updated_at = now() where id = t.id;
    insert into notifications(student_code, kind, title, body, url)
      values (case when t.sender_kind = 'student' then t.sender else 'staff:' || t.sender end, 'ticket', 'رد على رسالتك: ' || t.subject, left(trim(p_body), 140),
        case when t.sender_kind = 'student' then 'https://elrashdan.github.io/classmate/#help' else 'https://elrashdan.github.io/classmate/staff.html' end);
  else
    update tickets set status = 'open', admin_unread = true, updated_at = now() where id = t.id;
    perform notify_admins('ticket', 'رد جديد: ' || t.subject, t.sender_name);
  end if;
end $$;
revoke all on function public.ticket_open(text, text, text, text, text, text, uuid), public.ticket_add(public.tickets, boolean, text, text) from public, anon, authenticated;

-- الطالب
create or replace function public.student_ticket_create(p_token text, p_cat text, p_subject text, p_body text, p_course uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); nm text;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  if p_course is not null and not exists (select 1 from enrollments where course_id = p_course and student_code = code) then p_course := null; end if;
  nm := coalesce((select name from enrollments where student_code = code order by (course_id = p_course) desc nulls last limit 1), code);
  return ticket_open('student', code, nm || ' · ' || code, p_cat, p_subject, p_body, p_course);
end $$;
create or replace function public.student_tickets(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); res json;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select coalesce(json_agg(ticket_json(t, false) order by t.updated_at desc), '[]'::json) into res from tickets t where sender_kind = 'student' and sender = code;
  update tickets set user_unread = false where sender_kind = 'student' and sender = code and user_unread;
  return res;
end $$;
create or replace function public.student_ticket_reply(p_token text, tid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare code text := student_from_token(p_token); t tickets;
begin
  if code is null then raise exception 'not_signed_in'; end if;
  select * into t from tickets where id = tid and sender_kind = 'student' and sender = code;
  if t.id is null then raise exception 'not_found'; end if;
  perform ticket_add(t, false, code, p_body);
end $$;
create or replace function public.student_ticket_unread(p_token text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from tickets where sender_kind = 'student' and sender = student_from_token(p_token) and user_unread;
$$;

-- عضو هيئة التدريس
create or replace function public.staff_ticket_create(p_cat text, p_subject text, p_body text, p_course uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is null then raise exception 'not_allowed'; end if;
  if p_course is not null and course_role(p_course) is null then p_course := null; end if;
  return ticket_open('staff', my_email(), coalesce(staff_name(my_email()), my_email()), p_cat, p_subject, p_body, p_course);
end $$;
create or replace function public.staff_tickets() returns json
language plpgsql security definer set search_path = public as $$
declare res json;
begin
  if staff_role() is null then raise exception 'not_allowed'; end if;
  select coalesce(json_agg(ticket_json(t, false) order by t.updated_at desc), '[]'::json) into res from tickets t where sender_kind = 'staff' and sender = my_email();
  update tickets set user_unread = false where sender_kind = 'staff' and sender = my_email() and user_unread;
  return res;
end $$;
create or replace function public.staff_ticket_reply(tid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  select * into t from tickets where id = tid and sender_kind = 'staff' and sender = my_email();
  if t.id is null then raise exception 'not_found'; end if;
  perform ticket_add(t, false, my_email(), p_body);
end $$;

-- المسؤول
create or replace function public.admin_tickets(p_status text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  return coalesce((select json_agg(ticket_json(t, true) order by t.admin_unread desc, t.updated_at desc)
    from (select * from tickets where (coalesce(p_status, 'all') = 'all' or status = p_status) order by updated_at desc limit 300) t), '[]'::json);
end $$;
create or replace function public.admin_ticket_reply(tid uuid, p_body text, p_close boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  select * into t from tickets where id = tid;
  if t.id is null then raise exception 'not_found'; end if;
  if length(trim(coalesce(p_body, ''))) > 0 then perform ticket_add(t, true, my_email(), p_body); end if;
  update tickets set admin_unread = false, status = case when p_close then 'closed' when status = 'closed' and not p_close then 'answered' else status end, updated_at = now() where id = tid;
end $$;
create or replace function public.admin_ticket_seen(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  update tickets set admin_unread = false where id = tid;
end $$;
create or replace function public.admin_inbox_counts() returns json
language sql stable security definer set search_path = public as $$
  select case when staff_role() = 'admin' then json_build_object(
    'requests', (select count(*) from staff_requests where status = 'pending'),
    'tickets', (select count(*) from tickets where status = 'open'),
    'unread', (select count(*) from tickets where admin_unread)) else '{}'::json end;
$$;

revoke all on function public.student_ticket_create(text, text, text, text, uuid), public.student_tickets(text), public.student_ticket_reply(text, uuid, text), public.student_ticket_unread(text),
  public.staff_ticket_create(text, text, text, uuid), public.staff_tickets(), public.staff_ticket_reply(uuid, text),
  public.admin_tickets(text), public.admin_ticket_reply(uuid, text, boolean), public.admin_ticket_seen(uuid), public.admin_inbox_counts() from public;
grant execute on function public.student_ticket_create(text, text, text, text, uuid), public.student_tickets(text), public.student_ticket_reply(text, uuid, text), public.student_ticket_unread(text) to anon, authenticated;
grant execute on function public.staff_ticket_create(text, text, text, uuid), public.staff_tickets(), public.staff_ticket_reply(uuid, text),
  public.admin_tickets(text), public.admin_ticket_reply(uuid, text, boolean), public.admin_ticket_seen(uuid), public.admin_inbox_counts() to authenticated;
-- update-47: تسجيل أسئلة «مساعد Hadro» لمعرفة نسبة ما يجيب عنه وما ينقصه
create table if not exists public.faq_log (
  id bigserial primary key,
  who text not null check (who in ('student', 'staff')),
  q text not null,
  hits int not null default 0,
  top text not null default '',
  escalated boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists faq_log_at on public.faq_log(at desc);
alter table public.faq_log enable row level security;
revoke all on public.faq_log from anon, authenticated;
revoke all on sequence public.faq_log_id_seq from anon, authenticated;

create or replace function public.faq_log_add(p_who text, p_q text, p_hits int, p_top text, p_escalated boolean) returns void
language plpgsql security definer set search_path = public as $$
declare q text := left(regexp_replace(trim(coalesce(p_q, '')), '\s+', ' ', 'g'), 200);
begin
  if p_who not in ('student', 'staff') or length(q) < 3 then return; end if;
  if (select count(*) from faq_log where at > now() - interval '1 minute') > 120 then return; end if;
  insert into faq_log(who, q, hits, top, escalated) values (p_who, q, greatest(0, least(coalesce(p_hits, 0), 10)), left(coalesce(p_top, ''), 120), coalesce(p_escalated, false));
end $$;

create or replace function public.admin_faq_stats(p_days int) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if;
  return json_build_object(
    'total', (select count(*) from faq_log where at > since),
    'answered', (select count(*) from faq_log where at > since and hits > 0 and not escalated),
    'nohit', (select count(*) from faq_log where at > since and hits = 0),
    'escalated', (select count(*) from faq_log where at > since and escalated),
    'top', coalesce((select json_agg(x) from (select top q, count(*) n from faq_log where at > since and hits > 0 and top <> '' group by top order by 2 desc limit 8) x), '[]'::json),
    'missing', coalesce((select json_agg(x) from (select q, who, count(*) n, max(at) last from faq_log where at > since and (hits = 0 or escalated) group by q, who order by 3 desc, 4 desc limit 40) x), '[]'::json));
end $$;

revoke all on function public.faq_log_add(text, text, int, text, boolean), public.admin_faq_stats(int) from public;
grant execute on function public.faq_log_add(text, text, int, text, boolean) to anon, authenticated;
grant execute on function public.admin_faq_stats(int) to authenticated;
-- update-48: الجدول الدراسي وتوزيع العمل (أيام × فترات، الفرق والشعب والمجموعات، فريق كل مجموعة، والمكان)
create table if not exists public.timetables (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  term int not null check (term between 1 and 3),
  title text not null default 'جدول الدراسة وتوزيع العمل على أعضاء هيئة التدريس والأساتذة المنتدبين والمعيدين بالقسم',
  periods jsonb not null default '[{"n":1,"from":"09:00","to":"10:30"},{"n":2,"from":"10:40","to":"12:10"},{"n":3,"from":"12:20","to":"13:50"},{"n":4,"from":"14:00","to":"15:30"},{"n":5,"from":"15:40","to":"17:10"},{"n":6,"from":"17:20","to":"18:50"}]'::jsonb,
  days int[] not null default '{6,0,1,2,3,4}',          -- 6=السبت 0=الأحد ... 4=الخميس
  rooms text[] not null default '{"أتيليه 1","أتيليه 2","أتيليه 3","قاعة المحاضرات","معمل الحاسب","خارجي"}',
  signer text not null default 'رئيس مجلس القسم',
  published boolean not null default false,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (academic_year, term)
);
create table if not exists public.tt_cohorts (
  id uuid primary key default gen_random_uuid(),
  tt_id uuid not null references public.timetables(id) on delete cascade,
  level int not null check (level between 1 and 6),
  track text not null default '',
  students int,
  groups text[] not null default '{1,2,3,4}',
  off_days int[] not null default '{}',
  sort int not null default 0
);
create index if not exists tt_cohorts_tt on public.tt_cohorts(tt_id, sort);
create table if not exists public.tt_slots (
  id uuid primary key default gen_random_uuid(),
  tt_id uuid not null references public.timetables(id) on delete cascade,
  cohort_id uuid not null references public.tt_cohorts(id) on delete cascade,
  day int not null check (day between 0 and 6),
  p_from int not null check (p_from between 1 and 8),
  p_to int not null check (p_to between 1 and 8),
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  groups text[] not null default '{}',                   -- فارغ = كل مجموعات الفرقة
  room text not null default '',
  team jsonb not null default '[]'::jsonb,               -- [{g:"1", room:"", staff:[{n:"د.سليمان", e:"email|null", k:"lec|ta"}]}]
  note text not null default '',
  check (p_to >= p_from)
);
create index if not exists tt_slots_tt on public.tt_slots(tt_id, cohort_id, day, p_from);
create index if not exists tt_slots_course on public.tt_slots(course_id);
alter table public.timetables enable row level security;
alter table public.tt_cohorts enable row level security;
alter table public.tt_slots enable row level security;
revoke all on public.timetables, public.tt_cohorts, public.tt_slots from anon, authenticated;

-- توحيد اسم المجموعة: 1 = أ = الأولى = ١
create or replace function public.tt_gkey(g text) returns text
language plpgsql immutable set search_path = public as $$
declare x text := trim(coalesce(g, '')); i int;
  letters text[] := array['أ','ب','ج','د','ه','و','ز','ح','ط','ي','ك','ل'];
  ords text[] := array['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة','الثامنة','التاسعة','العاشرة','الحادية عشرة','الثانية عشرة'];
begin
  x := translate(x, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  x := regexp_replace(x, '^(المجموعة|مجموعة|م)\s*', '');
  x := replace(replace(replace(x, 'هـ', 'ه'), 'إ', 'ا'), 'آ', 'ا');
  if x ~ '^[0-9]+$' then return (x::int)::text; end if;
  for i in 1 .. array_length(letters, 1) loop
    if x = letters[i] or (i = 1 and x = 'ا') then return i::text; end if;
    if x = ords[i] or x = replace(ords[i], 'أ', 'ا') then return i::text; end if;
  end loop;
  return x;
end $$;

create or replace function public.tt_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin if staff_role() is distinct from 'admin' then raise exception 'not_allowed'; end if; end $$;

create or replace function public.tt_list() returns json
language sql stable security definer set search_path = public as $$
  select case when staff_role() is null then '[]'::json else coalesce(json_agg(json_build_object('id', id, 'academic_year', academic_year, 'term', term, 'published', published, 'updated_at', updated_at,
    'slots', (select count(*) from tt_slots s where s.tt_id = t.id)) order by academic_year desc, term desc), '[]'::json) end from timetables t;
$$;

create or replace function public.tt_get(tid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if staff_role() is null then raise exception 'not_allowed'; end if;
  return (select json_build_object('tt', to_json(t),
    'cohorts', coalesce((select json_agg(to_json(c) order by c.sort, c.level, c.track) from tt_cohorts c where c.tt_id = t.id), '[]'::json),
    'slots', coalesce((select json_agg(to_json(s) order by s.day, s.p_from) from tt_slots s where s.tt_id = t.id), '[]'::json))
    from timetables t where t.id = tid);
end $$;

create or replace function public.default_periods() returns jsonb language sql immutable as $$
  select '[{"n":1,"from":"09:00","to":"10:30"},{"n":2,"from":"10:40","to":"12:10"},{"n":3,"from":"12:20","to":"13:50"},{"n":4,"from":"14:00","to":"15:30"},{"n":5,"from":"15:40","to":"17:10"},{"n":6,"from":"17:20","to":"18:50"}]'::jsonb $$;

-- إنشاء جدول لفصل دراسي، مع فرق تلقائية من مواد هذا الفصل (أو نسخ فرق جدول سابق)
create or replace function public.tt_create(p_year text, p_term int, p_copy uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; src timetables; r record; m jsonb := '{}'::jsonb; ncid uuid;
begin
  perform tt_admin();
  if coalesce(p_year, '') !~ '^[0-9]{4}/[0-9]{4}$' or p_term not between 1 and 3 then raise exception 'bad_term'; end if;
  if exists (select 1 from timetables where academic_year = p_year and term = p_term) then raise exception 'tt_exists'; end if;
  if p_copy is not null then select * into src from timetables where id = p_copy; end if;
  insert into timetables(academic_year, term, created_by, periods, days, rooms, title, signer)
    values (p_year, p_term, my_email(), coalesce(src.periods, default_periods()), coalesce(src.days, '{6,0,1,2,3,4}'), coalesce(src.rooms, '{"أتيليه 1","أتيليه 2","أتيليه 3","قاعة المحاضرات","معمل الحاسب","خارجي"}'),
      coalesce(src.title, 'جدول الدراسة وتوزيع العمل على أعضاء هيئة التدريس والأساتذة المنتدبين والمعيدين بالقسم'), coalesce(src.signer, 'رئيس مجلس القسم'))
    returning id into nid;
  if src.id is not null then
    for r in select * from tt_cohorts where tt_id = src.id order by sort loop
      insert into tt_cohorts(tt_id, level, track, students, groups, off_days, sort) values (nid, r.level, r.track, r.students, r.groups, r.off_days, r.sort) returning id into ncid;
      m := m || jsonb_build_object(r.id::text, ncid);
    end loop;
    insert into tt_slots(tt_id, cohort_id, day, p_from, p_to, course_id, title, groups, room, team, note)
      select nid, (m->>s.cohort_id::text)::uuid, s.day, s.p_from, s.p_to,
        (select c2.id from courses c1 join courses c2 on c2.name = c1.name and c2.level is not distinct from c1.level and coalesce(c2.track, '') = coalesce(c1.track, '') and c2.academic_year = p_year and c2.term = p_term and not c2.archived where c1.id = s.course_id limit 1),
        s.title, s.groups, s.room, s.team, s.note from tt_slots s where s.tt_id = src.id;
  else
    insert into tt_cohorts(tt_id, level, track, students, groups, sort)
      select nid, x.level, x.track, x.n, case when x.g = '{}' then '{1,2,3,4}' else x.g end, row_number() over (order by x.level, x.track)
      from (select c.level, coalesce(c.track, '') track, count(distinct e.student_code)::int n,
              coalesce(array_agg(distinct tt_gkey(e.grp) order by tt_gkey(e.grp)) filter (where coalesce(e.grp, '') <> ''), '{}') g
            from courses c left join enrollments e on e.course_id = c.id
            where c.academic_year = p_year and c.term = p_term and not c.archived and c.level is not null group by c.level, coalesce(c.track, '')) x;
  end if;
  perform log_audit(null, 'أنشأ الجدول الدراسي ' || p_year || ' الفصل ' || p_term);
  return nid;
end $$;

create or replace function public.tt_update(tid uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform tt_admin();
  update timetables set
    title = coalesce(nullif(left(trim(p->>'title'), 300), ''), title),
    signer = coalesce(left(trim(p->>'signer'), 120), signer),
    periods = case when jsonb_typeof(p->'periods') = 'array' and jsonb_array_length(p->'periods') between 1 and 8 then p->'periods' else periods end,
    days = case when jsonb_typeof(p->'days') = 'array' then array(select (jsonb_array_elements_text(p->'days'))::int) else days end,
    rooms = case when jsonb_typeof(p->'rooms') = 'array' then array(select left(trim(x), 60) from jsonb_array_elements_text(p->'rooms') x where trim(x) <> '') else rooms end,
    published = coalesce((p->>'published')::boolean, published),
    updated_at = now()
  where id = tid;
  if p ? 'published' then perform log_audit(null, case when (p->>'published')::boolean then 'نشر الجدول الدراسي للطلبة' else 'أخفى الجدول الدراسي عن الطلبة' end); end if;
end $$;

create or replace function public.tt_delete(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform tt_admin(); delete from timetables where id = tid; perform log_audit(null, 'حذف جدولًا دراسيًا'); end $$;

create or replace function public.tt_cohort_save(tid uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid := nullif(p->>'id', '')::uuid; g text[];
begin
  perform tt_admin();
  g := array(select left(trim(x), 20) from jsonb_array_elements_text(coalesce(p->'groups', '[]'::jsonb)) x where trim(x) <> '');
  if coalesce(array_length(g, 1), 0) = 0 or array_length(g, 1) > 20 then raise exception 'bad_groups'; end if;
  if cid is null then
    insert into tt_cohorts(tt_id, level, track, students, groups, off_days, sort)
      values (tid, (p->>'level')::int, left(trim(coalesce(p->>'track', '')), 60), nullif(p->>'students', '')::int, g,
        array(select (jsonb_array_elements_text(coalesce(p->'off_days', '[]'::jsonb)))::int), coalesce((select max(sort) + 1 from tt_cohorts where tt_id = tid), 1))
      returning id into cid;
  else
    update tt_cohorts set level = (p->>'level')::int, track = left(trim(coalesce(p->>'track', '')), 60), students = nullif(p->>'students', '')::int, groups = g,
      off_days = array(select (jsonb_array_elements_text(coalesce(p->'off_days', '[]'::jsonb)))::int),
      sort = coalesce((p->>'sort')::int, sort) where id = cid and tt_id = tid;
  end if;
  update timetables set updated_at = now() where id = tid;
  return cid;
end $$;

create or replace function public.tt_cohort_delete(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform tt_admin(); delete from tt_cohorts where id = cid; end $$;

create or replace function public.tt_slot_save(tid uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid := nullif(p->>'id', '')::uuid; c tt_cohorts; t timetables; d int := (p->>'day')::int; a int := (p->>'p_from')::int; b int := (p->>'p_to')::int;
  g text[] := array(select left(trim(x), 20) from jsonb_array_elements_text(coalesce(p->'groups', '[]'::jsonb)) x where trim(x) <> '');
  ttl text := left(trim(coalesce(p->>'title', '')), 120); crs uuid := nullif(p->>'course_id', '')::uuid; clash text;
begin
  perform tt_admin();
  select * into t from timetables where id = tid;
  select * into c from tt_cohorts where id = (p->>'cohort_id')::uuid and tt_id = tid;
  if t.id is null or c.id is null then raise exception 'not_found'; end if;
  if not (d = any(t.days)) or a < 1 or b < a or b > jsonb_array_length(t.periods) then raise exception 'bad_slot'; end if;
  if crs is not null and ttl = '' then ttl := (select name from courses where id = crs); end if;
  if ttl = '' then raise exception 'slot_title'; end if;
  -- نفس المجموعة لا تكون في مادتين في نفس الوقت
  select s.title into clash from tt_slots s where s.cohort_id = c.id and s.day = d and s.p_from <= b and s.p_to >= a and s.id is distinct from sid
    and (cardinality(s.groups) = 0 or cardinality(g) = 0 or s.groups && g) limit 1;
  if clash is not null then raise exception 'slot_overlap:%', clash; end if;
  if sid is null then
    insert into tt_slots(tt_id, cohort_id, day, p_from, p_to, course_id, title, groups, room, team, note)
      values (tid, c.id, d, a, b, crs, ttl, g, left(trim(coalesce(p->>'room', '')), 60), coalesce(p->'team', '[]'::jsonb), left(trim(coalesce(p->>'note', '')), 200)) returning id into sid;
  else
    update tt_slots set cohort_id = c.id, day = d, p_from = a, p_to = b, course_id = crs, title = ttl, groups = g, room = left(trim(coalesce(p->>'room', '')), 60),
      team = coalesce(p->'team', '[]'::jsonb), note = left(trim(coalesce(p->>'note', '')), 200) where id = sid and tt_id = tid;
  end if;
  update timetables set updated_at = now() where id = tid;
  return sid;
end $$;

create or replace function public.tt_slot_delete(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform tt_admin(); delete from tt_slots where id = sid; end $$;

-- جدول الطالب: مواد مسجّل فيها من الجدول المنشور، بفريق مجموعته ومكانها
create or replace function public.student_timetable(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare code text := student_from_token(p_token);
begin
  if code is null then raise exception 'not_signed_in'; end if;
  return coalesce((select json_agg(json_build_object('tt', t.id, 'year', t.academic_year, 'term', t.term, 'periods', t.periods, 'days', t.days,
      'slots', (select coalesce(json_agg(json_build_object('day', s.day, 'p_from', s.p_from, 'p_to', s.p_to, 'title', s.title, 'course_id', s.course_id, 'grp', e.grp,
          'room', coalesce(nullif((select tm->>'room' from jsonb_array_elements(s.team) tm where tt_gkey(tm->>'g') = tt_gkey(e.grp) limit 1), ''), s.room),
          'staff', coalesce((select tm->'staff' from jsonb_array_elements(s.team) tm where tt_gkey(tm->>'g') = tt_gkey(e.grp) limit 1),
                            (select tm->'staff' from jsonb_array_elements(s.team) tm where coalesce(tm->>'g', '') = '' limit 1), '[]'::json::jsonb),
          'note', s.note) order by s.day, s.p_from), '[]'::json)
        from tt_slots s join enrollments e on e.course_id = s.course_id and e.student_code = code
        where s.tt_id = t.id and (cardinality(s.groups) = 0 or coalesce(e.grp, '') = '' or tt_gkey(e.grp) = any (array(select tt_gkey(x) from unnest(s.groups) x))))
    ) order by t.academic_year desc, t.term desc)
    from timetables t where t.published and exists (select 1 from tt_slots s join enrollments e on e.course_id = s.course_id and e.student_code = code where s.tt_id = t.id)), '[]'::json);
end $$;

revoke all on function public.tt_gkey(text), public.default_periods() from public;
grant execute on function public.tt_gkey(text), public.default_periods() to authenticated, anon;
revoke all on function public.tt_admin(), public.tt_list(), public.tt_get(uuid), public.tt_create(text, int, uuid), public.tt_update(uuid, jsonb), public.tt_delete(uuid),
  public.tt_cohort_save(uuid, jsonb), public.tt_cohort_delete(uuid), public.tt_slot_save(uuid, jsonb), public.tt_slot_delete(uuid), public.student_timetable(text) from public, anon;
grant execute on function public.tt_list(), public.tt_get(uuid), public.tt_create(text, int, uuid), public.tt_update(uuid, jsonb), public.tt_delete(uuid),
  public.tt_cohort_save(uuid, jsonb), public.tt_cohort_delete(uuid), public.tt_slot_save(uuid, jsonb), public.tt_slot_delete(uuid) to authenticated;
grant execute on function public.student_timetable(text) to anon, authenticated;

-- تحديث 49: ربط أسماء الجدول الدراسي بحسابات أعضاء هيئة التدريس تلقائيًا
--   لما عضو يتسجل (أو يتعدّل اسمه/لقبه) نلاقي اسمه المختصر في الجدول (مثل «م.خلود» أو «م.مريم الساعي»)،
--   نربطه بإيميله، ونكتب اسمه كما في الحساب (أول اسمين) مع اللقب. الاسم الأصلي يتحفظ في المفتاح "o".
--   لو الاسم المختصر ينطبق على أكتر من حساب، ما بنربطش (علشان ما نغلطش).

create or replace function public.tt_norm(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(translate(coalesce(t, ''), 'أإآةىـ', 'اااهي'), '[\s\.\-]', '', 'g');
$$;

-- يشيل اللقب من أول الاسم: أ.م.د. / أ.د. / م.م. / م. / د. / أ.
create or replace function public.tt_strip(n text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(coalesce(n, ''), '^\s*(([أا]\s*\.\s*م\s*\.\s*د)|([أا]\s*\.\s*د)|(م\s*\.?\s*م)|م|د|[أا])\s*\.\s*', ''));
$$;

create or replace function public.tt_words(n text) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(regexp_split_to_array(regexp_replace(translate(trim(coalesce(n, '')), 'أإآةىـ', 'اااهي'), 'عبد\s+', 'عبد', 'g'), '\s+'), '');
$$;

-- اسم الجدول (بعد شيل اللقب) ينطبق على اسم الحساب لو كلماته هي أول كلمات اسم الحساب بالترتيب
create or replace function public.tt_name_match(tbl text, acct text) returns boolean
language plpgsql immutable set search_path = public as $$
declare tw text[] := tt_words(tt_strip(tbl)); aw text[] := tt_words(acct); i int;
begin
  if coalesce(array_length(tw, 1), 0) = 0 or coalesce(array_length(aw, 1), 0) < array_length(tw, 1) then return false; end if;
  for i in 1 .. array_length(tw, 1) loop
    if tt_norm(tw[i]) <> tt_norm(aw[i]) then return false; end if;
  end loop;
  return true;
end $$;

-- نوع العضو من لقبه في الحساب (معيد/مدرس مساعد = ta ، غير كده lec ، ولو مش معروف null)
create or replace function public.tt_kind(title text) returns text
language sql immutable set search_path = public as $$
  select case when title ~ '(معيد|مدرس مساعد)' then 'ta' when title ~ '(أستاذ|استاذ|مدرس|دكتور)' then 'lec' else null end;
$$;

create or replace function public.tt_prefix(title text, old_n text) returns text
language sql immutable set search_path = public as $$
  select case
    when title ~ 'مدرس مساعد' then 'م.م.'
    when title ~ 'معيد' then 'م.'
    when title ~ '(أستاذ|استاذ) مساعد' then 'أ.م.د.'
    when title ~ '(أستاذ|استاذ)' then 'أ.د.'
    when title ~ '(مدرس|دكتور)' then 'د.'
    else coalesce(substring(coalesce(old_n, '') from '^\s*((?:[أا]\s*\.\s*م\s*\.\s*د|[أا]\s*\.\s*د|م\s*\.?\s*م|م|د|[أا])\s*\.)'), '') end;
$$;

-- الاسم المعروض: أول اسمين من اسم الحساب («عبد ...» تتحسب كلمة واحدة)
create or replace function public.tt_short(acct text) returns text
language sql immutable set search_path = public as $$
  select array_to_string((array_remove(regexp_split_to_array(regexp_replace(trim(coalesce(acct, '')), 'عبد\s+', 'عبد', 'g'), '\s+'), ''))[1:2], ' ');
$$;

create or replace function public.tt_link_staff(p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare st staff; s record; nt jsonb; k text; sh text; n int := 0;
begin
  select * into st from staff where email = p_email;
  if st.email is null or coalesce(st.status, '') in ('disabled', 'removed', 'rejected') or length(trim(coalesce(st.name, ''))) < 2 then return 0; end if;
  k := tt_kind(st.title); sh := tt_short(st.name);
  for s in select id, team from tt_slots where jsonb_array_length(team) > 0 loop
    select coalesce(jsonb_agg(
             jsonb_set(t, '{staff}', coalesce((
               select jsonb_agg(case
                 when p->>'e' = p_email
                   or ((p->>'e') is null and (k is null or p->>'k' = k) and tt_name_match(p->>'n', st.name)
                       and not exists (select 1 from staff o where o.email <> p_email and coalesce(o.status, '') not in ('disabled', 'removed', 'rejected')
                                        and (tt_kind(o.title) is null or p->>'k' = tt_kind(o.title)) and tt_name_match(p->>'n', o.name)))
                 then p || jsonb_build_object('e', p_email, 'n', tt_prefix(st.title, coalesce(p->>'o', p->>'n')) || sh, 'o', coalesce(p->>'o', p->>'n'))
                 else p end order by o2)
               from jsonb_array_elements(t->'staff') with ordinality z(p, o2)), '[]'::jsonb))
             order by o1), '[]'::jsonb)
      into nt from jsonb_array_elements(s.team) with ordinality y(t, o1);
    if nt is distinct from s.team then update tt_slots set team = nt where id = s.id; n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.tt_staff_link_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform tt_link_staff(new.email);
  return new;
end $$;

drop trigger if exists staff_tt_link on public.staff;
create trigger staff_tt_link after insert or update of name, title, status on public.staff
  for each row execute function public.tt_staff_link_trg();

revoke execute on function public.tt_link_staff(text), public.tt_staff_link_trg() from public, anon, authenticated;

-- ربط الحسابات الموجودة حاليًا
do $$ declare r record; begin
  for r in select email from staff loop perform public.tt_link_staff(r.email); end loop;
end $$;

-- تحديث 50: جرس التنبيهات لأعضاء هيئة التدريس + «متابعة القسم» للمسؤول
--   تنبيهاتي: ما ينتظر ردّي في موادي (تظلمات، طلبات حضور معلّقة، إنذارات لم تُبلَّغ، تسليمات لم تُصحَّح) + سجل إشعاراتي.
--   متابعة القسم (للمسؤول): نفس العناصر في مواد باقي الزملاء، بعمرها وفريقها، مع «تذكير الفريق».
--   وتظلم جديد يرسل إشعارًا (وإشعار هاتف) لفريق المادة.

create table if not exists public.staff_reminders (
  id bigserial primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  item text not null,
  by_email text not null,
  at timestamptz not null default now()
);
create index if not exists staff_reminders_item on public.staff_reminders(course_id, item, at desc);
alter table public.staff_reminders enable row level security;
revoke all on public.staff_reminders from anon, authenticated;

-- العناصر المعلّقة في مادة (داخلي)
create or replace function public.feed_course_items(cid uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', 'appeal', 'course_id', cid, 'ref', t.id::text, 'title', 'تظلمات بانتظار الرد · «' || t.title || '»', 'n', count(*), 'since', min(a.created_at))
    from grade_appeals a join tasks t on t.id = a.task_id
    where t.course_id = cid and a.status = 'pending' group by t.id, t.title
  union all
  select jsonb_build_object('kind', 'att', 'course_id', cid, 'ref', s.id::text, 'title', 'طلبات حضور معلّقة · المحاضرة ' || s.n || coalesce(' · مجموعة ' || nullif(s.grp, ''), ''), 'n', count(*), 'since', min(a.at), 'live', not s.ended)
    from attendance a join sessions s on s.id = a.session_id
    where s.course_id = cid and a.status = 'pending' group by s.id, s.n, s.grp, s.ended
  union all
  select jsonb_build_object('kind', 'warn', 'course_id', cid, 'ref', '', 'title', 'طلبة وصلوا إلى إنذار غياب جديد ولم يُبلَّغوا', 'n', count(*), 'since',
           (select max(coalesce(s.closed_at, s.ends_at)) from sessions s where s.course_id = cid and s.ended))
    from (select e.student_code, warn_level(course_absences(cid, e.student_code)) l from enrollments e where e.course_id = cid) x
    where x.l > 0
      and not exists (select 1 from warning_notices w where w.course_id = cid and w.student_code = x.student_code and w.level = x.l)
      and not exists (select 1 from warning_announced a where a.course_id = cid and a.student_code = x.student_code and a.level = x.l)
    having count(*) > 0
  union all
  select jsonb_build_object('kind', 'grade', 'course_id', cid, 'ref', t.id::text, 'title', 'تسليمات لم تُصحَّح · «' || t.title || '»', 'n', count(*), 'since', t.due_at)
    from tasks t join submissions s on s.task_id = t.id
    where t.course_id = cid and t.mode = 'submit' and t.due_at < now() - interval '1 day' and s.submitted_at is not null and s.grade is null
    group by t.id, t.title, t.due_at
$$;
revoke all on function public.feed_course_items(uuid) from public, anon, authenticated;

create or replace function public.staff_feed() returns json
language plpgsql stable security definer set search_path = public as $$
declare me text := my_email(); r text := staff_role(); mine json; dept json := '[]'; adm json := '{}'; notes json; unread int;
begin
  if r is null then raise exception 'not_allowed'; end if;
  select coalesce(json_agg(i || jsonb_build_object('course', c.name) order by (i->>'since') nulls last), '[]') into mine
    from courses c, lateral feed_course_items(c.id) i
    where not c.archived and (c.owner_email = me or exists (select 1 from course_tas t where t.course_id = c.id and t.email = me));
  if r = 'admin' then
    select coalesce(json_agg(i || jsonb_build_object('course', c.name,
             'team', (select json_agg(json_build_object('name', staff_name(x.email), 'k', x.k) order by x.o) from (
                        select c.owner_email email, 'owner' k, 0 o union all select t.email, t.kind, 1 from course_tas t where t.course_id = c.id) x),
             'reminded', (select max(m.at) from staff_reminders m where m.course_id = c.id and m.item = (i->>'kind') || ':' || (i->>'ref')))
           order by (i->>'since') nulls last), '[]') into dept
      from courses c, lateral feed_course_items(c.id) i
      where not c.archived and not (c.owner_email = me or exists (select 1 from course_tas t where t.course_id = c.id and t.email = me));
    adm := admin_inbox_counts();
  end if;
  select coalesce(json_agg(json_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null) order by n.id desc), '[]') into notes
    from (select * from notifications where student_code = 'staff:' || me order by id desc limit 40) n;
  select count(*) into unread from notifications where student_code = 'staff:' || me and read_at is null;
  return json_build_object('mine', mine, 'dept', dept, 'admin', adm, 'notes', notes, 'unread', unread, 'at', now());
end $$;

create or replace function public.staff_notes_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where student_code = 'staff:' || my_email() and read_at is null and staff_role() is not null;
$$;

-- المسؤول يذكّر فريق مادة بعنصر متأخر (مرة كل 6 ساعات لنفس العنصر)
create or replace function public.staff_remind(cid uuid, p_kind text, p_ref text) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; cname text; k text := p_kind || ':' || coalesce(p_ref, ''); n int;
begin
  if coalesce(staff_role(), '') <> 'admin' then raise exception 'not_allowed'; end if;
  select name into cname from courses where id = cid;
  if cname is null then raise exception 'not_found'; end if;
  select x into it from feed_course_items(cid) x where x->>'kind' = p_kind and x->>'ref' = coalesce(p_ref, '') limit 1;
  if it is null then raise exception 'remind_done'; end if;
  if exists (select 1 from staff_reminders where course_id = cid and item = k and at > now() - interval '6 hours') then raise exception 'remind_wait'; end if;
  insert into notifications(student_code, kind, title, body, url)
    select 'staff:' || e, 'remind', 'تذكير من مسؤول القسم · ' || cname,
           (it->>'title') || ' (' || (it->>'n') || ')' || coalesce(' · بانتظار الرد من ' || to_char(((it->>'since')::timestamptz) at time zone 'Africa/Cairo', 'DD/MM'), '') || '. برجاء المتابعة والرد.',
           'https://elrashdan.github.io/classmate/staff.html'
    from (select owner_email e from courses where id = cid union select email from course_tas where course_id = cid) t
    where e <> my_email();
  get diagnostics n = row_count;
  insert into staff_reminders(course_id, item, by_email) values (cid, k, my_email());
  perform log_audit(cid, 'ذكّر فريق المادة: ' || (it->>'title'));
  return n;
end $$;

-- تظلم جديد ← إشعار لفريق المادة
create or replace function public.appeal_notify_team() returns trigger
language plpgsql security definer set search_path = public as $$
declare t tasks; cname text; nm text;
begin
  select * into t from tasks where id = new.task_id;
  select name into cname from courses where id = t.course_id;
  nm := coalesce((select name from enrollments where course_id = t.course_id and student_code = new.student_code), new.student_code);
  insert into notifications(student_code, kind, title, body, url)
    select 'staff:' || e, 'appeal', 'تظلم جديد · «' || t.title || '»', nm || ' · ' || cname, 'https://elrashdan.github.io/classmate/staff.html'
    from (select owner_email e from courses where id = t.course_id union select email from course_tas where course_id = t.course_id) x;
  return null;
end $$;
create or replace trigger grade_appeals_notify after insert on public.grade_appeals for each row execute function public.appeal_notify_team();

revoke all on function public.staff_feed(), public.staff_notes_read(), public.staff_remind(uuid, text, text), public.appeal_notify_team() from public, anon;
grant execute on function public.staff_feed(), public.staff_notes_read(), public.staff_remind(uuid, text, text) to authenticated;
-- تحديث 51: «تسليمات لم تُصحَّح» ما تحسبش تكليف التسليم اللي اتعمل لجمع الملفات بس:
--   لو مفيش فيه ولا درجة، واترصدت الدرجات في تكليف تاني (يدوي) في نفس المادة ميعاده بعده أو في نفس اليوم.
create or replace function public.feed_course_items(cid uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', 'appeal', 'course_id', cid, 'ref', t.id::text, 'title', 'تظلمات بانتظار الرد · «' || t.title || '»', 'n', count(*), 'since', min(a.created_at))
    from grade_appeals a join tasks t on t.id = a.task_id
    where t.course_id = cid and a.status = 'pending' group by t.id, t.title
  union all
  select jsonb_build_object('kind', 'att', 'course_id', cid, 'ref', s.id::text, 'title', 'طلبات حضور معلّقة · المحاضرة ' || s.n || coalesce(' · مجموعة ' || nullif(s.grp, ''), ''), 'n', count(*), 'since', min(a.at), 'live', not s.ended)
    from attendance a join sessions s on s.id = a.session_id
    where s.course_id = cid and a.status = 'pending' group by s.id, s.n, s.grp, s.ended
  union all
  select jsonb_build_object('kind', 'warn', 'course_id', cid, 'ref', '', 'title', 'طلبة وصلوا إلى إنذار غياب جديد ولم يُبلَّغوا', 'n', count(*), 'since',
           (select max(coalesce(s.closed_at, s.ends_at)) from sessions s where s.course_id = cid and s.ended))
    from (select e.student_code, warn_level(course_absences(cid, e.student_code)) l from enrollments e where e.course_id = cid) x
    where x.l > 0
      and not exists (select 1 from warning_notices w where w.course_id = cid and w.student_code = x.student_code and w.level = x.l)
      and not exists (select 1 from warning_announced a where a.course_id = cid and a.student_code = x.student_code and a.level = x.l)
    having count(*) > 0
  union all
  select jsonb_build_object('kind', 'grade', 'course_id', cid, 'ref', t.id::text, 'title', 'تسليمات لم تُصحَّح · «' || t.title || '»', 'n', count(*), 'since', t.due_at)
    from tasks t join submissions s on s.task_id = t.id
    where t.course_id = cid and t.mode = 'submit' and t.due_at < now() - interval '1 day' and s.submitted_at is not null and s.grade is null
      and not (
        not exists (select 1 from submissions g where g.task_id = t.id and g.grade is not null)
        and exists (select 1 from tasks m where m.course_id = cid and m.id <> t.id and m.mode <> 'submit' and m.due_at >= t.due_at
                      and exists (select 1 from submissions g where g.task_id = m.id and g.grade is not null)))
    group by t.id, t.title, t.due_at
$$;
revoke all on function public.feed_course_items(uuid) from public, anon, authenticated;
-- تحديث 52: كلمة سر الطالب بتتقبل لو اتكتبت بأرقام عربي (١٢٣) أو إنجليزي (123) أو فارسي (۱۲۳)،
--   أو فيها مسافة في الأول/الآخر، أو علامات اتجاه مخفية بيحطها كيبورد الموبايل. (كتير من الطلبة بيسجّلوا
--   بكيبورد عربي ويدخلوا بكيبورد إنجليزي أو العكس، فكانت كلمة السر بتطلع «غلط» وهما فاكرينها صح.)
create or replace function public.pw_variants(p text) returns text[]
language sql immutable as $$
  with c as (select coalesce(p, '') raw, regexp_replace(coalesce(p, ''), '[​-‏‪-‮⁦-⁩﻿ ]', '', 'g') cl),
       d as (select raw, cl, btrim(cl) tr from c)
  select array(select distinct v from d, unnest(array[raw, cl, tr,
      translate(tr, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      translate(tr, '0123456789۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨٩'),
      translate(tr, '0123456789٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹')]) v where v <> '' or raw = '')
$$;
create or replace function public.pw_ok(p text, h text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select h is not null and exists (select 1 from unnest(pw_variants(p)) v where crypt(v, h) = h)
$$;
revoke all on function public.pw_ok(text, text) from public, anon, authenticated;
do $$ declare f record; d text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('student_login', 'student_login_web', 'student_move_device', 'student_change_password') loop
    d := pg_get_functiondef(f.oid);
    d := replace(d, 'crypt(coalesce(p_password, ''''), st.pass_hash) <> st.pass_hash', 'not pw_ok(p_password, st.pass_hash)');
    d := replace(d, 'crypt(coalesce(p_old, ''''), st.pass_hash) <> st.pass_hash', 'not pw_ok(p_old, st.pass_hash)');
    execute d;
  end loop;
end $$;
-- تحديث 53: دور جديد «رئيس القسم» (head)
--   له صلاحيات صاحب المادة في كل المواد (الحضور والغياب والدرجات والتكليفات والطلبة والفريق)، والجدول الدراسي كامل،
--   و«متابعة القسم» (الجرس + تذكير الفرق + نظرة عامة على المواد + تقرير الإنذارات + السجل)، وإنشاء مواد.
--   من غير: إدارة حسابات المحاضرين والمعيدين وأدوارهم، وطلبات التسجيل، والرسائل، والإعدادات، وحذف المواد، والدراسات العليا. دي للمسؤول بس.
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('admin', 'head', 'lecturer', 'ta'));

do $$
declare f record; d text; o text;
  reps text[][] := array[
    ['course_role',      'when staff_role() = ''admin'' then ''owner''', 'when staff_role() in (''admin'', ''head'') then ''owner'''],
    ['course_owner',     'staff_role() = ''admin''', 'staff_role() in (''admin'', ''head'')'],
    ['tt_admin',         'staff_role() is distinct from ''admin''', 'coalesce(staff_role(), '''') not in (''admin'', ''head'')'],
    ['create_course',    'not in (''admin'', ''lecturer'')', 'not in (''admin'', ''head'', ''lecturer'')'],
    ['staff_feed',       'if r = ''admin'' then', 'if r in (''admin'', ''head'') then'],
    ['staff_feed',       'adm := admin_inbox_counts();', 'if r = ''admin'' then adm := admin_inbox_counts(); end if;'],
    ['staff_remind',     'coalesce(staff_role(), '''') <> ''admin''', 'coalesce(staff_role(), '''') not in (''admin'', ''head'')'],
    ['admin_save_staff', '(''admin'',''lecturer'',''ta'')', '(''admin'',''head'',''lecturer'',''ta'')'],
    ['admin_save_staff', 'when ''admin'' then ''مسؤول'' when ''lecturer''', 'when ''admin'' then ''مسؤول'' when ''head'' then ''رئيس القسم'' when ''lecturer'''],
    ['admin_set_role',   '(''admin'', ''lecturer'', ''ta'')', '(''admin'', ''head'', ''lecturer'', ''ta'')'],
    ['admin_set_role',   'when ''admin'' then ''مسؤول'' when ''lecturer''', 'when ''admin'' then ''مسؤول'' when ''head'' then ''رئيس القسم'' when ''lecturer'''],
    ['delete_course',    'if not course_owner(cid) and staff_role() is distinct from ''admin'' then', 'if not exists (select 1 from courses x where x.id = cid and x.owner_email = my_email()) and staff_role() is distinct from ''admin'' then']];
  i int; hit boolean;
begin
  for i in 1 .. array_length(reps, 1) loop
    hit := false;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = reps[i][1] loop
      d := pg_get_functiondef(f.oid); o := d;
      d := replace(d, reps[i][2], reps[i][3]);
      if d <> o then execute d; hit := true; elsif position(reps[i][3] in o) > 0 then hit := true; end if;
    end loop;
    if not hit then raise exception 'update53: لم يتغيّر % (%)', reps[i][1], reps[i][2]; end if;
  end loop;
end $$;

-- نظرة عامة على مواد القسم (للمسؤول ورئيس القسم): مين بياخد الغياب، وآخر محاضرة، ومتوسط الحضور، والتكليفات اللي اترصد فيها درجات
create or replace function public.dept_overview() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(staff_role(), '') not in ('admin', 'head') then raise exception 'not_allowed'; end if;
  return coalesce((select json_agg(x) from (
    select c.id course_id,
      (select count(*) from enrollments e where e.course_id = c.id) students,
      (select count(*) from sessions s where s.course_id = c.id and s.ended) lectures,
      (select max(s.started_at) from sessions s where s.course_id = c.id) last_at,
      exists (select 1 from sessions s where s.course_id = c.id and not s.ended) live,
      (select round(100.0 * sum(q.p) / nullif(sum(q.d), 0)) from (
         select (select count(*) from attendance a where a.session_id = s.id and a.status <> 'pending') p,
                (select count(*) from enrollments e where e.course_id = c.id and (coalesce(s.grp, '') = '' or e.grp = s.grp)) d
         from sessions s where s.course_id = c.id and s.ended) q) avg_pct,
      (select count(*) from tasks t where t.course_id = c.id) tasks,
      (select count(*) from tasks t where t.course_id = c.id and exists (select 1 from submissions su where su.task_id = t.id and su.grade is not null)) graded_tasks
    from courses c where not c.archived) x), '[]');
end $$;
revoke all on function public.dept_overview() from public, anon;
grant execute on function public.dept_overview() to authenticated;
-- تحديث 54: «مرفوض» في رصد الدرجات (بالإملاء الصوتي أو من الكشف)
--   المحاضر يقول «اسم الطالب … مرفوض»، فيظهر للطالب فورًا (حتى قبل إعلان الدرجات): «مشروعك مرفوض. توجّه لأستاذ المادة»،
--   ويوصله إشعار. رصد درجة له بعد كده بيلغي الرفض تلقائيًا.
alter table public.submissions add column if not exists rejected_at timestamptz;
alter table public.submissions add column if not exists rejected_by text;

create or replace function public.task_reject(tid uuid, codes text[], p_on boolean, p_source text) returns int
language plpgsql security definer set search_path = public as $$
declare t tasks; cname text; code text; n int := 0;
begin
  select * into t from tasks where id = tid;
  if t.id is null or coalesce(course_role(t.course_id), '') not in ('owner', 'ta') then raise exception 'not_allowed'; end if;
  if coalesce(array_length(codes, 1), 0) > 2000 then raise exception 'bad_rows'; end if;
  select name into cname from courses where id = t.course_id;
  foreach code in array coalesce(codes, '{}') loop
    code := trim(code);
    if not exists (select 1 from enrollments where course_id = t.course_id and student_code = code) then raise exception 'not_found'; end if;
    if coalesce(p_on, true) then
      if exists (select 1 from submissions where task_id = tid and student_code = code and rejected_at is not null and grade is null) then continue; end if;
      insert into submissions(task_id, student_code, rejected_at, rejected_by, grade, parts, bonus, graded_by, graded_at)
        values (tid, code, now(), my_email(), null, null, 0, my_email(), now())
      on conflict (task_id, student_code) do update set rejected_at = now(), rejected_by = my_email(), grade = null, parts = null, bonus = 0, graded_by = my_email(), graded_at = now();
      insert into notifications(student_code, kind, title, body, url)
        values (code, 'reject', 'مشروعك مرفوض · «' || t.title || '»', 'توجّه لأستاذ المادة (' || cname || ').', 'https://elrashdan.github.io/classmate/');
    else
      update submissions set rejected_at = null, rejected_by = null where task_id = tid and student_code = code and rejected_at is not null;
      if not found then continue; end if;
    end if;
    n := n + 1;
  end loop;
  if n > 0 then perform log_audit(t.course_id, case when coalesce(p_on, true) then 'رفض مشروع ' else 'ألغى رفض مشروع ' end || n || ' طالب في التكليف «' || t.title || '»' || coalesce(' · ' || nullif(trim(p_source), ''), '')); end if;
  return n;
end $$;
revoke all on function public.task_reject(uuid, text[], boolean, text) from public, anon;
grant execute on function public.task_reject(uuid, text[], boolean, text) to authenticated;

-- درجة جديدة للطالب = إلغاء الرفض
create or replace function public.submissions_unreject() returns trigger
language plpgsql as $$
begin
  if new.rejected_at is not null and new.grade is not null and new.grade is distinct from old.grade then new.rejected_at := null; new.rejected_by := null; end if;
  return new;
end $$;
create or replace trigger submissions_unreject before update on public.submissions for each row execute function public.submissions_unreject();

-- الطالب يشوف الرفض فورًا، والتكليف اليدوي بيظهر له لو اترفض حتى لو الدرجات لسه ما اتعلنتش
do $$ declare d text; o text; begin
  d := pg_get_functiondef('public.student_tasks(text)'::regprocedure); o := d;
  d := replace(d, '''graded'', s.grade is not null,', '''graded'', s.grade is not null, ''rejected'', s.rejected_at is not null,');
  d := replace(d, 'and (t.mode = ''submit'' or t.released)', 'and (t.mode = ''submit'' or t.released or exists (select 1 from submissions r where r.task_id = t.id and r.student_code = code and r.rejected_at is not null))');
  if d = o or position('rejected_at is not null))' in d) = 0 or position('''rejected''' in d) = 0 then raise exception 'update54: student_tasks لم يتغيّر'; end if;
  execute d;
end $$;
