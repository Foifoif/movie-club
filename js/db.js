// ─── DB HELPERS ──────────────────────────────────────────────────────────────
function rowToMovie(row) {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    description: row.description,
    poster: row.poster,
    streaming: Array.isArray(row.streaming) ? row.streaming : [],
    accent: row.accent || ACCENT_COLORS[0],
    ratingScale: row.rating_scale || '',
    sessionTheme: row.session_theme || '',
    shownMonth: row.shown_month || '',
    tmdbId: row.tmdb_id || null,
    trailerUrl: row.trailer_url || null,
    // Derive type from movie_type column if it exists, else fall back to accent color:
    // gold (#f5c518) = impromptu, anything else = official
    movieType: row.movie_type || (row.accent === '#f5c518' ? 'impromptu' : 'official'),
  };
}

async function loadAll() {
  const [moviesRes, ratingsRes, bracketRes, membersRes] = await Promise.all([
    sb.from('movies').select('*').order('id'),
    sb.from('ratings').select('*'),
    sb.from('bracket').select('data').eq('id', 1).maybeSingle(),
    sb.from('members').select('id, name, sort_order').order('sort_order').order('name'),
  ]);

  const allMovies = moviesRes.data || [];
  const currentMovies = allMovies.filter(m => !m.archived).map(rowToMovie);
  // Attach theme/month by insertion order (sorted by id asc = same order as load_data.py)
  const alltimeOrdered = allMovies
    .filter(m => m.archived)
    .sort((a, b) => a.id - b.id)
    .map((row, i) => {
      const meta = HISTORY_META[i];
      return {
        id: row.id,
        title: row.title,
        year: row.year,
        ratingScale: row.rating_scale || '',
        avgScore: row.avg_score,
        poster: row.poster || null,
        tmdbId: row.tmdb_id || null,
        trailerUrl: row.trailer_url || null,
        // For HISTORY_META movies: theme = the per-movie theme label
        // For new movies: use ratingScale as the label
        theme: meta?.theme || row.rating_scale || '',
        month: meta?.month || row.shown_month || '',
        // sessionTheme only populated for new (non-HISTORY_META) movies
        sessionTheme: meta ? '' : (row.session_theme || ''),
        movieType: row.movie_type || (row.accent === '#f5c518' ? 'impromptu' : 'official'),
      };
    });
  const alltimeMovies = [...alltimeOrdered].sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

  const ratingsData = {};
  for (const row of (ratingsRes.data || [])) {
    if (!ratingsData[row.movie_id]) ratingsData[row.movie_id] = {};
    ratingsData[row.movie_id][row.member_name] = row.score;
  }

  const bracketData = bracketRes.data ? bracketRes.data.data : null;
  const membersData = (membersRes.data || []).map(r => r.name);
  const memberObjectsData = (membersRes.data || []).map(r => ({ id: r.id, name: r.name }));
  const pollsData = await dbLoadPolls().catch(() => []);
  const bracketHistoryData = await dbLoadBracketHistory().catch(() => []);
  const currentMonthlyEvent = await dbLoadMonthlyEvents({ isCurrent: true }).catch(() => null);

  return { currentMovies, ratingsData, bracketData, membersData, memberObjectsData, alltimeMovies, pollsData, bracketHistoryData, currentMonthlyEvent };
}

async function dbSaveMovies(existingMovies, newMovieData) {
  const saved = [];
  for (let i = 0; i < newMovieData.length; i++) {
    const m = newMovieData[i];
    const row = {
      title: m.title,
      year: m.year || null,
      description: m.description || null,
      poster: m.poster || null,
      streaming: m.streaming || [],
      accent: m.accent || null,
      rating_scale: m.ratingScale || '',
      session_theme: m.sessionTheme || null,
      tmdb_id: m.tmdbId || null,
      trailer_url: m.trailerUrl || null,
      archived: false,
    };
    const existing = existingMovies[i];
    if (existing && existing.id) {
      const { data, error } = await sb.from('movies').update(row).eq('id', existing.id).select().single();
      if (error) throw error;
      saved.push(rowToMovie(data));
    } else {
      const { data, error } = await sb.from('movies').insert(row).select().single();
      if (error) throw error;
      saved.push(rowToMovie(data));
    }
  }
  return saved;
}

async function dbSaveRating(movieId, memberName, score) {
  if (score === 0) {
    const { error } = await sb.from('ratings').delete()
      .eq('movie_id', movieId).eq('member_name', memberName);
    if (error) throw error;
    return;
  }
  const { error } = await sb.from('ratings').upsert(
    { movie_id: movieId, member_name: memberName, score },
    { onConflict: 'movie_id,member_name' }
  );
  if (error) throw error;
}

async function dbSaveBracket(bracketData) {
  if (!bracketData) {
    await sb.from('bracket').delete().eq('id', 1);
    return;
  }
  const { error } = await sb.from('bracket').upsert({ id: 1, data: bracketData });
  if (error) throw error;
}

async function dbSaveBracketHistory(bracketData) {
  const { data, error } = await sb.from('bracket_history').insert({ data: bracketData }).select('id, finished_at').single();
  if (error) throw error;
  return data;
}

async function dbLoadBracketHistory() {
  const { data, error } = await sb.from('bracket_history').select('id, data, finished_at').order('finished_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbSaveMembers(members) {
  await sb.from('members').delete().not('name', 'is', null);
  if (!members.length) return;
  const rows = members.map((name, i) => ({ name, sort_order: i }));
  const { error } = await sb.from('members').insert(rows);
  if (error) throw error;
}

// ─── POLL DB ──────────────────────────────────────────────────────────────────
// Run once in Supabase SQL editor to enable polls:
//
// create table polls (
//   id bigint generated by default as identity primary key,
//   question text not null,
//   created_by text,
//   created_at timestamptz default now() not null,
//   closed_at timestamptz,
//   is_active boolean default true not null
// );
// create table poll_options (
//   id bigint generated by default as identity primary key,
//   poll_id bigint references polls(id) on delete cascade,
//   text text not null,
//   image_url text,
//   created_at timestamptz default now() not null
// );
// -- if table already exists: alter table poll_options add column if not exists image_url text;
// create table poll_votes (
//   id bigint generated by default as identity primary key,
//   poll_id bigint references polls(id) on delete cascade,
//   option_id bigint references poll_options(id) on delete cascade,
//   member_name text not null,
//   created_at timestamptz default now() not null,
//   unique(poll_id, member_name)
// );
// alter table polls        enable row level security;
// alter table poll_options enable row level security;
// alter table poll_votes   enable row level security;
// create policy "anon_all" on polls        for all to anon using (true) with check (true);
// create policy "anon_all" on poll_options for all to anon using (true) with check (true);
// create policy "anon_all" on poll_votes   for all to anon using (true) with check (true);

async function dbLoadPolls() {
  try {
    const { data: pollsData, error } = await sb.from('polls').select('*').order('created_at', { ascending: false });
    if (error || !pollsData || pollsData.length === 0) return [];
    const pollIds = pollsData.map(p => p.id);
    const [{ data: optData }, { data: voteData }] = await Promise.all([
      sb.from('poll_options').select('*').in('poll_id', pollIds).order('created_at'),
      sb.from('poll_votes').select('*').in('poll_id', pollIds),
    ]);
    return pollsData.map(poll => ({
      ...poll,
      options: (optData || []).filter(o => o.poll_id === poll.id),
      votes: (voteData || []).filter(v => v.poll_id === poll.id),
    }));
  } catch(e) { return []; }
}

async function dbCreatePoll(question, createdBy) {
  const { data, error } = await sb.from('polls').insert({ question, created_by: createdBy || null, is_active: true }).select().single();
  if (error) {
    if (error.message && (error.message.includes('schema cache') || error.message.includes("table 'public.polls'"))) {
      throw new Error("Polls aren't set up yet — run the SQL setup in Supabase first (see code comments).");
    }
    throw error;
  }
  return { ...data, options: [], votes: [] };
}

async function dbUpdatePollQuestion(pollId, newQuestion) {
  const { error } = await sb.from('polls').update({ question: newQuestion }).eq('id', pollId);
  if (error) throw error;
}

async function dbUpdatePollOption(optionId, newText) {
  const { error } = await sb.from('poll_options').update({ text: newText }).eq('id', optionId);
  if (error) throw error;
}

async function dbClosePoll(pollId) {
  const { error } = await sb.from('polls')
    .update({ is_active: false, closed_at: new Date().toISOString() })
    .eq('id', pollId);
  if (error) throw error;
}

async function dbDeletePoll(pollId) {
  const { error } = await sb.from('polls').delete().eq('id', pollId);
  if (error) throw error;
}

async function dbVoteForOption(pollId, optionId, memberName) {
  const { error } = await sb.from('poll_votes').upsert(
    { poll_id: pollId, option_id: optionId, member_name: memberName },
    { onConflict: 'poll_id,member_name' }
  );
  if (error) throw error;
}

async function dbAddOptionAndVote(pollId, text, memberName, currentPoll, imageUrl) {
  const trimmed = text.trim();
  const existing = (currentPoll.options || []).find(o => o.text.toLowerCase() === trimmed.toLowerCase());
  let optionId;
  let newOptions = [...(currentPoll.options || [])];

  if (existing) {
    optionId = existing.id;
  } else {
    // Try with image_url first; fall back without it if the column doesn't exist yet
    let insertPayload = { poll_id: pollId, text: trimmed, image_url: imageUrl || null };
    let { data: newOpt, error } = await sb.from('poll_options').insert(insertPayload).select().single();
    if (error && error.message && error.message.includes('image_url')) {
      const fallback = await sb.from('poll_options').insert({ poll_id: pollId, text: trimmed }).select().single();
      if (fallback.error) throw fallback.error;
      newOpt = fallback.data;
    } else if (error) {
      throw error;
    }
    optionId = newOpt.id;
    newOptions = [...newOptions, newOpt];
  }

  await dbVoteForOption(pollId, optionId, memberName);

  const newVotes = (currentPoll.votes || []).filter(v => v.member_name !== memberName);
  newVotes.push({ poll_id: pollId, option_id: optionId, member_name: memberName });
  return { optionId, updatedPoll: { ...currentPoll, options: newOptions, votes: newVotes } };
}

async function dbArchiveMovies(movies, ratingsData) {
  const now = new Date();
  const shownMonth = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const archived = [];
  for (const m of movies) {
    const scores = Object.values(ratingsData[m.id] || {}).filter(v => v > 0);
    if (!scores.length) continue;
    const average = parseFloat(avg(scores));
    const { error } = await sb.from('movies')
      .update({ archived: true, avg_score: average, shown_month: shownMonth })
      .eq('id', m.id);
    if (error) throw error;
    archived.push({
      id: m.id, title: m.title, year: m.year,
      ratingScale: m.ratingScale, sessionTheme: m.sessionTheme || '',
      avgScore: average, month: shownMonth, theme: m.ratingScale || '',
    });
  }
  return archived;
}

async function dbRecalcAvg(movieId) {
  const { data } = await sb.from('ratings').select('score').eq('movie_id', movieId);
  if (!data || !data.length) return null;
  const sum = data.reduce((s, r) => s + parseFloat(r.score), 0);
  const rounded = Math.round((sum / data.length) * 100) / 100;
  await sb.from('movies').update({ avg_score: rounded }).eq('id', movieId);
  return rounded;
}

async function dbAddHistoryMovie({ title, year, description, poster, movieType, sessionTheme, tmdbId, trailerUrl }) {
  const now = new Date();
  const shownMonth = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  // Use accent color to encode type — no extra DB column needed:
  //   '#f5c518' (gold)  = impromptu
  //   '#8ec5e6' (blue)  = official
  const accent = movieType === 'impromptu' ? '#f5c518' : '#8ec5e6';
  const row = {
    title, year: year || null, description: description || null,
    poster: poster || null, streaming: [], accent,
    rating_scale: '', archived: true, avg_score: null,
    session_theme: sessionTheme || null,
    tmdb_id: tmdbId || null,
    trailer_url: trailerUrl || null,
  };
  row.shown_month = shownMonth;
  const { data, error } = await sb.from('movies').insert(row).select().single();
  if (error) throw error;
  return { ...data, shownMonth, movieType };
}

async function dbDeleteMovie(movieId) {
  await sb.from('ratings').delete().eq('movie_id', movieId);
  const { error } = await sb.from('movies').delete().eq('id', movieId);
  if (error) throw error;
}

async function dbUpdateHistoryMovie(movieId, updates) {
  const { error } = await sb.from('movies').update(updates).eq('id', movieId);
  if (error) throw error;
}

// ─── MOVIE NIGHT DB HELPERS ──────────────────────────────────────────────────
async function dbLoadOverride() {
  try {
    const { data } = await sb.from('settings').select('value').eq('key','movie_night_override').maybeSingle();
    return data?.value || null;
  } catch { return null; }
}
async function dbSaveOverride(val) {
  await sb.from('settings').upsert({ key:'movie_night_override', value: val });
}
async function dbClearOverride() {
  await sb.from('settings').delete().eq('key','movie_night_override');
}
async function dbLoadRSVPs(dateStr) {
  try {
    const { data } = await sb.from('rsvps').select('member_name,status').eq('event_date', dateStr);
    return data || [];
  } catch { return []; }
}
async function dbSaveRSVP(memberName, status, dateStr) {
  await sb.from('rsvps').delete().eq('member_name', memberName).eq('event_date', dateStr);
  await sb.from('rsvps').insert({ member_name: memberName, status, event_date: dateStr });
}
async function dbLoadJoinUrl() {
  try {
    const { data } = await sb.from('settings').select('value').eq('key','movie_night_join_url').maybeSingle();
    return data?.value || null;
  } catch { return null; }
}
async function dbSaveJoinUrl(url) {
  await sb.from('settings').upsert({ key:'movie_night_join_url', value: url });
}

// ─── WATCHLIST DB ─────────────────────────────────────────────────────────────
// Run once in Supabase SQL editor:
//
// create table watchlist (
//   id bigint generated by default as identity primary key,
//   member_name text not null,
//   title text not null,
//   year int,
//   poster text,
//   urgency text not null default 'want',
//   watched boolean not null default false,
//   added_at timestamptz not null default now()
// );
// alter table watchlist enable row level security;
// create policy "anon_all" on watchlist for all to anon using (true) with check (true);

async function dbLoadWatchlist() {
  const { data, error } = await sb.from('watchlist').select('*').order('added_at');
  if (error) throw error;
  return data || [];
}

async function dbAddToWatchlist({ memberName, title, year, poster, urgency }) {
  const yr = year ? (parseInt(year, 10) || null) : null;
  const { data, error } = await sb.from('watchlist')
    .insert({ member_name: memberName, title, year: yr, poster: poster || null, urgency: urgency || 'want' })
    .select().single();
  if (error) throw error;
  return data;
}

async function dbMarkWatchlistWatched(id) {
  const { error } = await sb.from('watchlist').update({ watched: true }).eq('id', id);
  if (error) throw error;
}

async function dbRemoveFromWatchlist(id) {
  const { error } = await sb.from('watchlist').delete().eq('id', id);
  if (error) throw error;
}

// ─── MONTHLY EVENTS DB ───────────────────────────────────────────────────────
// Run once in Supabase SQL editor to enable monthly events:
//
// create table monthly_events (
//   id               bigint primary key generated always as identity,
//   month            date not null,          -- first day of club month, e.g. 2026-07-01
//   theme            text,
//   movie_id_1       bigint references movies(id),
//   movie_id_2       bigint references movies(id),
//   is_current       boolean not null default false,
//   meeting_datetime timestamptz,            -- actual meeting time; may fall outside club month
//   meeting_link     text,
//   trivia           text
// );
// alter table monthly_events enable row level security;
// create policy "anon_all" on monthly_events for all to anon using (true) with check (true);

// Pass { isCurrent: true } to fetch only the active event (used by loadAll).
// No args returns all events ordered by month desc (used by admin tab).
async function dbLoadMonthlyEvents({ isCurrent } = {}) {
  if (isCurrent) {
    const { data, error } = await sb.from('monthly_events')
      .select('*')
      .eq('is_current', true)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
  const { data, error } = await sb.from('monthly_events')
    .select('*')
    .order('month', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbSaveMonthlyEvent(eventData) {
  const row = {
    month: eventData.month,
    theme: eventData.theme || null,
    movie_id_1: eventData.movieId1 || null,
    movie_id_2: eventData.movieId2 || null,
    is_current: eventData.isCurrent || false,
    meeting_datetime: eventData.meetingDatetime || null,
    meeting_link: eventData.meetingLink || null,
    trivia: eventData.trivia || null,
  };
  if (eventData.id) {
    const { data, error } = await sb.from('monthly_events').update(row).eq('id', eventData.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from('monthly_events').insert(row).select().single();
  if (error) throw error;
  return data;
}

async function dbDeleteMonthlyEvent(id) {
  const { error } = await sb.from('monthly_events').delete().eq('id', id);
  if (error) throw error;
}

// Sets the given event as current and clears is_current on all others.
async function dbSetCurrentMonthlyEvent(id) {
  const { error: clearErr } = await sb.from('monthly_events')
    .update({ is_current: false })
    .neq('id', id);
  if (clearErr) throw clearErr;
  const { data, error } = await sb.from('monthly_events')
    .update({ is_current: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── MOVIE NIGHT HELPERS ─────────────────────────────────────────────────────
function getFourthSunday(year, month) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === 0 && ++count === 4) return dt;
  }
  return null;
}

function getNextMovieNight(override) {
  const now = Date.now();
  if (override) {
    const ov = new Date(override).getTime();
    if (ov > now) return new Date(override); // still in the future
  }
  const d = new Date(now);
  let year = d.getFullYear(), month = d.getMonth();
  for (let i = 0; i < 3; i++) {
    const sun = getFourthSunday(year, month);
    if (sun) {
      // 9 AM PST = 17:00 UTC
      const ev = new Date(Date.UTC(sun.getFullYear(), sun.getMonth(), sun.getDate(), 17, 0, 0));
      if (ev.getTime() > now) return ev;
    }
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return new Date(now);
}

function fmtEventDate(d) {
  const datePart = d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  return `${datePart} · ${timePart}`;
}

function calcCountdown(target) {
  const diff = target - Date.now();
  if (diff <= 0) return { days:0, hours:0, minutes:0, done:true };
  return {
    days:    Math.floor(diff / 86400000),
    hours:   Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000)  / 60000),
    done: false
  };
}
