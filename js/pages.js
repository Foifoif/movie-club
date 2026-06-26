// ─── TIMEZONE HELPERS ────────────────────────────────────────────────────────
// Converts a UTC ISO string from Supabase to "YYYY-MM-DDTHH:mm" in the
// browser's local timezone, suitable for populating a datetime-local input.
function isoToLocalDatetimeLocal(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── SHARED RATE HANDLER ─────────────────────────────────────────────────────
// Returns an async handleRate(movieId, member, score) function.
// Pass onAfterSave(movieId) for any post-save side effects (e.g. recalc avg, reveal).
function makeHandleRate(localRatings, setLocalRatings, setRatings, { onAfterSave } = {}) {
  return async function handleRate(movieId, member, score) {
    try {
      await dbSaveRating(movieId, member, score);
      let updated;
      if (score === 0) {
        const mr = { ...(localRatings[movieId] || {}) };
        delete mr[member];
        updated = { ...localRatings, [movieId]: mr };
      } else {
        updated = { ...localRatings, [movieId]: { ...(localRatings[movieId] || {}), [member]: score } };
      }
      setLocalRatings(updated);
      if (setRatings) setRatings(updated);
      if (onAfterSave) onAfterSave(movieId);
    } catch(e) { console.error('Failed to save rating:', e); }
  };
}

// ─── HOME PAGE ───────────────────────────────────────────────────────────────
function HomePage({ movies, ratings, setRatings, members, activePoll, onPollClick, bracket, onBracketClick, currentEvent, onThisMonthClick }) {
  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const [localRatings, setLocalRatings] = useState(ratings || {});

  useEffect(() => { setLocalRatings(ratings || {}); }, [ratings]);

  const handleRate = makeHandleRate(localRatings, setLocalRatings, setRatings);

  if (!movies || movies.length === 0) {
    return (
      <div className="main">
        <ThisMonthCard currentEvent={currentEvent} movies={movies} onNavigate={onThisMonthClick} />
        {activePoll && (
          <a className="poll-card" href={`/poll/${slugify(activePoll.question)}`}
            onClick={e => { e.preventDefault(); onPollClick(activePoll.question); }}>
            <div className="poll-card-label">Today's Poll</div>
            <div className="poll-card-question">{activePoll.question}</div>
            {activePoll.created_by && <div className="poll-card-asker">asked by {activePoll.created_by}</div>}
          </a>
        )}
        {bracket && (
          <a className="poll-card" style={{cursor:'pointer'}}
            onClick={e => { e.preventDefault(); if (onBracketClick) onBracketClick(); }}>
            <div className="poll-card-label">Bracket · Round {(bracket.currentRound||0)+1}{bracket.finished?' — Final':''}</div>
            <div className="poll-card-question">
              {bracket.finished ? `Winner: ${bracket.winner}` : 'Vote for this month\'s pick →'}
            </div>
          </a>
        )}
        <div className="page-title">🎬 Movie Club</div>
        <div className="page-subtitle">No movies set yet this month.</div>
        <div className="empty-state">
          <div className="empty-icon">🎞️</div>
          <div>The admin hasn't picked this month's films yet.<br/>Check back soon!</div>
        </div>
      </div>
    );
  }

  return (
    <div className="main">
      <ThisMonthCard currentEvent={currentEvent} movies={movies} onNavigate={onThisMonthClick} />
      {activePoll && (
        <a className="poll-card" href={`/poll/${slugify(activePoll.question)}`}
          onClick={e => { e.preventDefault(); onPollClick(activePoll.question); }}>
          <div className="poll-card-label">Today's Poll</div>
          <div className="poll-card-question">{activePoll.question}</div>
          {activePoll.created_by && <div className="poll-card-asker">asked by {activePoll.created_by}</div>}
        </a>
      )}
      {bracket && (
        <a className="poll-card" style={{cursor:'pointer'}}
          onClick={e => { e.preventDefault(); if (onBracketClick) onBracketClick(); }}>
          <div className="poll-card-label">Bracket · Round {(bracket.currentRound||0)+1}{bracket.finished?' — Final':''}</div>
          <div className="poll-card-question">
            {bracket.finished ? `Winner: ${bracket.winner}` : 'Vote for this month\'s pick →'}
          </div>
        </a>
      )}
    </div>
  );
}

// ─── THIS MONTH'S MOVIES PAGE ────────────────────────────────────────────────
function ThisMonthPage({ currentEvent, movies }) {
  const ACCENT = 'var(--yellow)';
  const ink = 'var(--ink)';

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!currentEvent) {
    return (
      <div className="main">
        <div className="page-title">This Month's Movies</div>
        <div className="page-subtitle">Nothing set yet — check back soon.</div>
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div>The admin hasn't configured this month's event yet.</div>
        </div>
      </div>
    );
  }

  const monthLabel = currentEvent.month
    ? new Date(currentEvent.month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const movie1 = movies.find(m => m.id === currentEvent.movie_id_1) || null;
  const movie2 = movies.find(m => m.id === currentEvent.movie_id_2) || null;
  const lineup = [movie1, movie2].filter(Boolean);

  const joinUrl   = currentEvent.meeting_link || '';
  const eventDate = currentEvent.meeting_datetime ? new Date(currentEvent.meeting_datetime) : null;

  const diff = eventDate ? eventDate.getTime() - now : null;
  const done = diff !== null && diff <= 0;
  const days = diff !== null ? Math.max(0, Math.floor(diff / 86400000)) : 0;
  const hrs  = diff !== null ? Math.max(0, Math.floor((diff % 86400000) / 3600000)) : 0;
  const min  = diff !== null ? Math.max(0, Math.floor((diff % 3600000)  / 60000)) : 0;
  const pad  = n => String(n).padStart(2, '0');
  const goTime = eventDate && (done || days === 0);

  const dateLine = eventDate
    ? eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;
  const lineupStr = lineup.map(m => m.title).join(' · ');

  return (
    <div className="main" style={{ maxWidth: 600, margin: '0 auto' }}>

      {/* HEADER CARD */}
      <div style={{ background: '#fff', border: `3px solid ${ink}`, borderRadius: 10, boxShadow: `8px 8px 0 ${ACCENT}`, overflow: 'hidden', marginBottom: 24 }}>

        {/* eyebrow bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 16px', background: ACCENT }}>
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: ink }}>🎬 This Month at Movie Club</span>
          {lineup.length === 2 && (
            <span style={{ fontSize: '.6rem', fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: ACCENT, background: ink, padding: '4px 9px', borderRadius: 3, whiteSpace: 'nowrap' }}>Double Feature</span>
          )}
        </div>

        {/* theme headline + meta */}
        <div style={{ padding: '20px 20px 18px' }}>
          {monthLabel && <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--blue-dark)' }}>{monthLabel}</div>}
          {currentEvent.theme && <div style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.02, letterSpacing: '-.6px', color: ink, marginTop: 6 }}>{currentEvent.theme}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {dateLine && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', fontWeight: 700, color: ink, background: ACCENT, border: `1.5px solid ${ink}`, padding: '5px 12px', borderRadius: 5, whiteSpace: 'nowrap' }}>📅 {dateLine}</span>}
            {lineupStr && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', fontWeight: 700, color: ink, background: '#fff', border: `1.5px solid ${ink}`, padding: '5px 12px', borderRadius: 5, whiteSpace: 'nowrap' }}>🎞️ {lineupStr}</span>}
          </div>
        </div>

        {/* countdown OR go-time */}
        {eventDate && (goTime ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 20, background: 'var(--cream)', borderTop: `3px solid ${ink}` }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--green)' }}>It's happening — grab the popcorn 🍿</div>
            {joinUrl && (
              <a href={joinUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', fontSize: '1rem', fontWeight: 700, padding: '12px 32px', background: 'var(--green)', color: '#fff', border: `2px solid ${ink}`, borderRadius: 999, boxShadow: `3px 3px 0 ${ink}`, textDecoration: 'none' }}>🎬 Join Movie Night</a>
            )}
          </div>
        ) : (
          <div style={{ padding: '18px 16px 20px', background: 'var(--cream)', borderTop: `3px solid ${ink}` }}>
            <div style={{ textAlign: 'center', fontSize: '.55rem', fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: 'var(--blue-dark)', marginBottom: 12 }}>Countdown to showtime</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              {[{ v: String(days), l: 'days' }, { v: pad(hrs), l: 'hrs' }, { v: pad(min), l: 'min' }].map((u, i) => (
                <React.Fragment key={u.l}>
                  {i > 0 && <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--blue-mid)' }}>:</span>}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 62, fontSize: '2rem', fontWeight: 700, color: ink, background: '#fff', border: `2px solid ${ink}`, borderRadius: 6, boxShadow: `2px 2px 0 ${ACCENT}`, padding: '7px 10px', fontVariantNumeric: 'tabular-nums' }}>{u.v}</span>
                    <span style={{ fontSize: '.55rem', fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--blue-dark)' }}>{u.l}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>
            {joinUrl && (
              <a href={joinUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '16px auto 0', maxWidth: 280, fontSize: '.92rem', fontWeight: 700, padding: '11px 24px', background: '#fff', color: ink, border: `2px solid ${ink}`, borderRadius: 999, boxShadow: `3px 3px 0 ${ink}`, textDecoration: 'none' }}>🔗 Meeting link</a>
            )}
          </div>
        ))}
      </div>

      {/* LINEUP HEADING */}
      {lineup.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 4px 16px' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: .4, color: ink }}>The Lineup</span>
          <span style={{ flex: 1, height: 3, background: ink, borderRadius: 2 }}></span>
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--blue-dark)' }}>{lineup.length} {lineup.length === 1 ? 'film' : 'films'}</span>
        </div>
      )}

      {/* MOVIE BLOCKS */}
      {lineup.map((m, i) => (
        <MovieLineupCard key={m.id} movie={m} index={i} accent={ACCENT} />
      ))}

      {/* DID YOU KNOW */}
      {currentEvent.trivia && (
        <div style={{ background: '#fff', border: `2px solid ${ACCENT}`, borderRadius: 6, padding: '16px 18px', boxShadow: `3px 3px 0 ${ACCENT}`, marginTop: 8 }}>
          <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--blue-dark)', marginBottom: 9 }}>🎬 Did You Know?</div>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '.92rem', lineHeight: 1.65, color: ink }}>{currentEvent.trivia}</div>
        </div>
      )}
    </div>
  );
}

// ─── PAST SCREENINGS ─────────────────────────────────────────────────────────
const NOW_MONTH = new Date().toLocaleString('en-US', { month:'long' }) + ' ' + new Date().getFullYear();

function PastScreenings({ alltime, ratings, setRatings, setAlltime, members, adminAuthed, filter }) {
  const [localRatings, setLocalRatings] = useState(ratings || {});
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingMovieId, setEditingMovieId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [revealedMonths, setRevealedMonths] = useState(new Set());
  const [revealedMovies, setRevealedMovies] = useState(new Set());

  function toggleRevealMonth(month) {
    setRevealedMonths(prev => {
      const next = new Set(prev);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  }

  function revealMovie(movieId) {
    setRevealedMovies(prev => new Set([...prev, movieId]));
  }

  useEffect(() => { setLocalRatings(ratings || {}); }, [ratings]);

  const handleRate = makeHandleRate(localRatings, setLocalRatings, setRatings, {
    onAfterSave: (movieId) => { dbRecalcAvg(movieId).catch(console.error); revealMovie(movieId); }
  });

  function handleMovieAdded(movie) {
    if (setAlltime) setAlltime(prev => [...prev, movie]);
    setShowAddForm(false);
  }

  function handleEditSaved(movieId, updates) {
    if (setAlltime) setAlltime(prev => prev.map(m => m.id === movieId ? { ...m, ...updates } : m));
    setEditingMovieId(null);
  }

  function handleDelete(movieId, title) {
    setConfirmDelete({ id: movieId, title });
  }

  async function executeDelete() {
    const { id, title } = confirmDelete;
    setConfirmDelete(null);
    try {
      await dbDeleteMovie(id);
      if (setAlltime) setAlltime(prev => prev.filter(m => m.id !== id));
      setLocalRatings(prev => { const n = {...prev}; delete n[id]; return n; });
    } catch(e) { console.error('Failed to delete:', e); }
  }

  // Group by month, sort newest-first using parsed month values
  const monthOrder = [];
  const byMonth = {};
  for (const movie of alltime) {
    const m = movie.month || 'Unknown';
    if (!byMonth[m]) { byMonth[m] = []; monthOrder.push(m); }
    byMonth[m].push(movie);
  }
  monthOrder.sort((a, b) => parseMonthYear(b) - parseMonthYear(a));
  // Within each month: official first (insertion order), then impromptu (newest first)
  for (const month of monthOrder) {
    byMonth[month].sort((a, b) => {
      const aOff = (a.movieType || 'official') !== 'impromptu';
      const bOff = (b.movieType || 'official') !== 'impromptu';
      if (aOff !== bOff) return aOff ? -1 : 1;
      return aOff ? (a.id||0) - (b.id||0) : (b.id||0) - (a.id||0);
    });
  }

  return (
    <>
      {showAddForm
        ? <AddHistoryMovieForm onAdd={handleMovieAdded} onCancel={() => setShowAddForm(false)} />
        : <button className="add-history-btn" onClick={() => setShowAddForm(true)}>＋ Add a movie to history</button>
      }

      {monthOrder.length === 0 && (
        <div className="empty-state"><div className="empty-icon">📽️</div><div>No history yet.</div></div>
      )}

      {monthOrder.map(month => {
        const monthMovies = filter && filter !== 'all'
          ? byMonth[month].filter(m => (m.movieType || 'official') === filter)
          : byMonth[month];
        if (!monthMovies.length) return null;
        const sessionTheme = byMonth[month].find(m => m.sessionTheme)?.sessionTheme;
        const isCurrentMonth = month === NOW_MONTH;
        const monthRevealed = revealedMonths.has(month);
        return (
          <div key={month} className="history-month">
            <div className="history-month-header">
              <div>
                {month}
                {sessionTheme && <span className="history-session-theme"> · {sessionTheme}</span>}
              </div>
              {isCurrentMonth && (
                <button className="reveal-btn" onClick={() => toggleRevealMonth(month)}>
                  {monthRevealed ? 'Hide' : 'Reveal'}
                </button>
              )}
            </div>
            {monthMovies.map(movie => {
              const movieRatings = localRatings[movie.id] || {};
              const scores = Object.values(movieRatings).filter(v => v > 0);
              const average = scores.length
                ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2).replace(/\.?0+$/, '')
                : null;
              const ratedMembers = members.filter(m => movieRatings[m] !== undefined);
              const isImpromptu = movie.movieType === 'impromptu';

              if (editingMovieId === movie.id) {
                return (
                  <EditHistoryMovieForm key={movie.id} movie={movie}
                    onSave={updates => handleEditSaved(movie.id, updates)}
                    onCancel={() => setEditingMovieId(null)} />
                );
              }

              return (
                <div key={movie.id}
                  className={`history-movie ${isImpromptu ? 'history-movie-impromptu' : 'history-movie-official'}`}>
                  {adminAuthed && (
                    <>
                      <button className="history-edit-btn" title="Edit"
                        onClick={() => setEditingMovieId(movie.id)}>✎</button>
                      <button className="history-delete-btn" title="Delete"
                        onClick={() => handleDelete(movie.id, movie.title)}>✕</button>
                    </>
                  )}
                  <div className="history-movie-head">
                    {movie.poster
                      ? <img src={movie.poster} className="mini-poster" alt="" />
                      : <div className="mini-poster-placeholder">🎬</div>
                    }
                    <div style={{flex:1, minWidth:0}}>
                      <div className="history-movie-title">{movie.title}</div>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        {(movie.theme || movie.ratingScale) && (
                          <div className="history-theme">{movie.theme || movie.ratingScale}</div>
                        )}
                        <span className={`type-badge ${isImpromptu ? 'type-badge-impromptu' : 'type-badge-official'}`}>
                          {isImpromptu ? 'Impromptu' : 'Official'}
                        </span>
                        {movie.trailerUrl && (
                          <TrailerButton trailerUrl={movie.trailerUrl} title={movie.title} />
                        )}
                      </div>
                    </div>
                    {(() => { const show = !isCurrentMonth || monthRevealed || revealedMovies.has(movie.id); return (
                      <div className={`history-avg${show ? '' : ' score-hidden'}`}>{average || '—'}</div>
                    ); })()}
                  </div>
                  <div className="history-ratings-grid">
                    {ratedMembers.map(m => {
                      const show = !isCurrentMonth || monthRevealed || revealedMovies.has(movie.id);
                      return (
                        <div key={m} className="history-rating-row">
                          <span className="history-member-name">{m}</span>
                          <span className={`history-member-score${show ? '' : ' score-hidden'}`}>{movieRatings[m]}</span>
                        </div>
                      );
                    })}
                  </div>
                  <HomeRatingArea
                    movieId={movie.id}
                    movieRatings={movieRatings}
                    onSave={(member, score) => handleRate(movie.id, member, score)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {confirmDelete && (
        <div className="confirm-overlay" onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="confirm-card">
            <div className="confirm-card-title">Delete movie?</div>
            <div className="confirm-card-body">
              This will permanently remove <strong>"{confirmDelete.title}"</strong> and all its ratings. This can't be undone.
            </div>
            <div className="confirm-actions">
              <button className="confirm-cancel-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="confirm-delete-btn" onClick={executeDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── RATINGS PAGE URL HELPERS ────────────────────────────────────────────────
function parseRatingsUrl() {
  const parts = window.location.pathname.replace(/^\//, '').split('/');
  if (parts[0] === 'watchlist' || parts[1] === 'watchlist') return { tab: 'watchlist', topFilter: 'movies', movieSubFilter: 'all' };
  if (parts[1] !== 'top') return { tab: 'history', topFilter: 'movies', movieSubFilter: 'all' };
  const seg = parts[2] || '';
  if (seg === 'leaderboard') return { tab: 'alltime', topFilter: 'leaderboard', movieSubFilter: 'all' };
  if (seg === 'personal')    return { tab: 'alltime', topFilter: 'personal',    movieSubFilter: 'all' };
  if (seg === 'official')    return { tab: 'alltime', topFilter: 'movies',      movieSubFilter: 'official' };
  if (seg === 'impromptu')   return { tab: 'alltime', topFilter: 'movies',      movieSubFilter: 'impromptu' };
  return { tab: 'alltime', topFilter: 'movies', movieSubFilter: 'all' };
}

function buildRatingsUrl(tab, topFilter, movieSubFilter) {
  if (tab === 'watchlist') return '/ratings/watchlist';
  if (tab !== 'alltime') return '/ratings';
  if (topFilter === 'leaderboard') return '/ratings/top/leaderboard';
  if (topFilter === 'personal')    return '/ratings/top/personal';
  if (movieSubFilter === 'official')  return '/ratings/top/official';
  if (movieSubFilter === 'impromptu') return '/ratings/top/impromptu';
  return '/ratings/top';
}

// ─── RATINGS PAGE ────────────────────────────────────────────────────────────
function RatingsPage({ movies, ratings, setRatings, alltime, setAlltime, members, adminAuthed }) {
  const { currentUser } = React.useContext(UserContext);
  const init = parseRatingsUrl();
  const [tab,           _setTab]           = useState(init.tab);
  const [topFilter,     _setTopFilter]     = useState(init.topFilter);
  const [movieSubFilter,_setMovieSubFilter] = useState(init.movieSubFilter);
  const [selectedMember, setSelectedMember] = useState(() => currentUser?.id ? currentUser.name : '');
  const [historyFilter, setHistoryFilter]   = useState('all');

  function setTab(t) {
    _setTab(t);
    window.history.pushState(null, '', buildRatingsUrl(t, topFilter, movieSubFilter));
  }
  function switchTop(f) {
    const sub = f === 'movies' ? movieSubFilter : 'all';
    _setTopFilter(f);
    _setMovieSubFilter(sub);
    if (f !== 'personal') setSelectedMember('');
    window.history.pushState(null, '', buildRatingsUrl(tab, f, sub));
  }
  function changeSub(s) {
    _setMovieSubFilter(s);
    window.history.pushState(null, '', buildRatingsUrl(tab, topFilter, s));
  }

  useEffect(() => {
    const onPop = () => {
      const u = parseRatingsUrl();
      _setTab(u.tab);
      _setTopFilter(u.topFilter);
      _setMovieSubFilter(u.movieSubFilter);
      setSelectedMember('');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const tabBar = (
    <div className="ratings-tabs">
      <button className={`ratings-tab ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>Ratings</button>
      <button className={`ratings-tab ${tab==='watchlist'?'active':''}`} onClick={()=>setTab('watchlist')}>Watchlist</button>
      <button className={`ratings-tab ${tab==='alltime'?'active':''}`} onClick={()=>setTab('alltime')}>Top</button>
    </div>
  );

  if (tab === 'watchlist') {
    return (
      <div className="main">
        <div className="page-title">Movies</div>
        <div className="page-subtitle">What to watch next</div>
        {tabBar}
        <WatchListPage members={members} alltime={alltime} ratings={ratings} embedded />
      </div>
    );
  }

  if (tab === 'history') {
    return (
      <div className="main">
        <div className="page-title">Movies</div>
        <div className="page-subtitle">Every screening, every score</div>
        {tabBar}
        <div className="type-filter">
          <button className={`type-filter-btn ${historyFilter==='all'?'active-all':''}`} onClick={()=>setHistoryFilter('all')}>All</button>
          <button className={`type-filter-btn ${historyFilter==='official'?'active-official':''}`} onClick={()=>setHistoryFilter('official')}>Official</button>
          <button className={`type-filter-btn ${historyFilter==='impromptu'?'active-impromptu':''}`} onClick={()=>setHistoryFilter('impromptu')}>Impromptu</button>
        </div>
        <TriviaOfTheWeek />
        <PastScreenings alltime={alltime} ratings={ratings} setRatings={setRatings}
          setAlltime={setAlltime} members={members} adminAuthed={adminAuthed} filter={historyFilter} />
      </div>
    );
  }

  const allSorted = [...(alltime || [])].sort((a,b) => (b.avgScore||0) - (a.avgScore||0));
  const filteredMovies = movieSubFilter === 'all' ? allSorted
    : allSorted.filter(m => (m.movieType || 'official') === movieSubFilter);

  const officialByDate = [...(alltime || [])]
    .filter(m => (m.movieType || 'official') !== 'impromptu')
    .sort((a, b) => parseMonthYear(a.month || '') - parseMonthYear(b.month || ''));
  const leaderboard = (members || [])
    .map(member => {
      const firstIdx = officialByDate.findIndex(m => ratings[m.id]?.[member] !== undefined);
      if (firstIdx === -1) return null;
      const eligible = officialByDate.slice(firstIdx);
      const watched = eligible.filter(m => ratings[m.id]?.[member] !== undefined).length;
      const pct = Math.round((watched / eligible.length) * 100);
      return { member, pct, watched, eligible: eligible.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct || b.watched - a.watched);

  let personalStats = null;
  if (topFilter === 'personal' && selectedMember) {
    const scored = (alltime || [])
      .filter(m => ratings[m.id]?.[selectedMember] !== undefined)
      .map(m => ({ movie: m, score: Number(ratings[m.id][selectedMember]) }))
      .sort((a, b) => b.score - a.score);
    const personalAvg = scored.length
      ? (scored.reduce((s, x) => s + x.score, 0) / scored.length).toFixed(2).replace(/\.?0+$/, '')
      : null;
    personalStats = { avg: personalAvg, top3: scored.slice(0, 3) };
  }

  return (
    <div className="main">
      <div className="page-title">Movies</div>
      <div className="page-subtitle">The hall of fame</div>
      {tabBar}

      <div className="type-filter">
        <button className={`type-filter-btn ${topFilter==='movies'?'active-movies':''}`} onClick={()=>switchTop('movies')}>Movies</button>
        <button className={`type-filter-btn ${topFilter==='leaderboard'?'active-leaderboard':''}`} onClick={()=>switchTop('leaderboard')}>Leaderboard</button>
        <button className={`type-filter-btn ${topFilter==='personal'?'active-personal':''}`} onClick={()=>switchTop('personal')}>It's Personal</button>
      </div>

      {topFilter === 'movies' && (
        <div className="sub-filter">
          <button className={`sub-filter-btn ${movieSubFilter==='all'?'active-sub-all':''}`} onClick={()=>changeSub('all')}>All</button>
          <button className={`sub-filter-btn ${movieSubFilter==='official'?'active-sub-official':''}`} onClick={()=>changeSub('official')}>🔵 Official</button>
          <button className={`sub-filter-btn ${movieSubFilter==='impromptu'?'active-sub-impromptu':''}`} onClick={()=>changeSub('impromptu')}>🟡 Impromptu</button>
        </div>
      )}

      {topFilter === 'movies' && (
        <>
          {filteredMovies.length === 0 && (
            <div className="empty-state"><div className="empty-icon">🏆</div><div>No movies here yet.</div></div>
          )}
          {filteredMovies.map((movie, i) => (
            <div key={movie.id || i} className="alltime-item">
              <div className={`rank-num ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}`}>#{i+1}</div>
              {movie.poster
                ? <img src={movie.poster} className="mini-poster" alt="" />
                : <div className="mini-poster-placeholder">🎬</div>
              }
              <div className="alltime-info">
                <div className="alltime-title">{movie.title}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:2}}>
                  {(movie.theme || movie.ratingScale) && (
                    <div className="alltime-meta">{movie.theme || movie.ratingScale}</div>
                  )}
                  <span className={`type-badge ${movie.movieType==='impromptu'?'type-badge-impromptu':'type-badge-official'}`}>
                    {movie.movieType==='impromptu'?'Impromptu':'Official'}
                  </span>
                  {movie.trailerUrl && (
                    <TrailerButton trailerUrl={movie.trailerUrl} title={movie.title} />
                  )}
                </div>
              </div>
              <div className="alltime-score">{movie.avgScore}</div>
            </div>
          ))}
        </>
      )}

      {topFilter === 'leaderboard' && (
        <>
          {leaderboard.map(({ member, pct, watched, eligible }, i) => (
            <div key={member} className="leaderboard-item">
              <div className={`rank-num ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}`}>#{i+1}</div>
              <div className="leaderboard-name">{member}</div>
              <div className="leaderboard-count">
                <strong>{pct}%</strong>
                <span style={{fontSize:'0.78rem',color:'#aaa',marginLeft:4}}>({watched}/{eligible})</span>
              </div>
            </div>
          ))}
        </>
      )}

      {topFilter === 'personal' && (
        <div>
          <div className="personal-member-grid">
            {(members || []).map(m => (
              <button key={m}
                className={`personal-member-btn ${selectedMember === m ? 'active' : ''}`}
                onClick={() => setSelectedMember(selectedMember === m ? '' : m)}>
                {m}
              </button>
            ))}
          </div>
          {personalStats && (
            <>
              <div className="personal-avg-card">
                <div className="personal-avg-label">Average rating given</div>
                <div className="personal-avg-value">{personalStats.avg ?? '—'}</div>
              </div>
              {personalStats.top3.length > 0 && (
                <>
                  <div className="personal-section-label">Top {personalStats.top3.length} films</div>
                  <div className="personal-top3">
                    {personalStats.top3.map(({ movie, score }) => (
                      <div key={movie.id} className="personal-movie-card">
                        {movie.poster
                          ? <img src={movie.poster} alt={movie.title} />
                          : <div className="personal-movie-placeholder">🎬</div>
                        }
                        <div className="personal-movie-info">
                          <div className="personal-movie-title">{movie.title}</div>
                          <div className="personal-movie-score">{score}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BRACKET SETUP FORM ───────────────────────────────────────────────────────
function BracketSetupForm({ onDone, onCancel }) {
  const [movies, setMovies] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [byeIdx, setByeIdx] = useState(null);

  const needsBye = movies.length >= 3 && movies.length % 2 !== 0;
  const canStart = movies.length >= 2 && (!needsBye || byeIdx !== null);

  function handleBracketSelect(selected) {
    const title = selected.title + (selected.year ? ` (${selected.year})` : '');
    setMovies(prev => [...prev, { title, poster: selected.poster, desc: selected.description, tmdbId: selected.tmdbId, trailerUrl: selected.trailerUrl }]);
    setSearchQuery('');
    setByeIdx(null);
  }

  function removeMovie(i) {
    setMovies(prev => prev.filter((_, j) => j !== i));
    setByeIdx(prev => prev === i ? null : prev !== null && prev > i ? prev - 1 : prev);
  }

  function submit() {
    if (movies.length < 2) return;
    let list = [...movies];
    if (list.length % 2 !== 0 && byeIdx !== null) {
      const [bye] = list.splice(byeIdx, 1);
      list.push(bye);
    }
    const matchups = [];
    for (let i = 0; i < list.length; i += 2) {
      if (i + 1 < list.length) {
        matchups.push({ a: list[i].title, aPoster: list[i].poster, aDesc: list[i].desc||'', aTrailer: list[i].trailerUrl||null, b: list[i+1].title, bPoster: list[i+1].poster, bDesc: list[i+1].desc||'', bTrailer: list[i+1].trailerUrl||null, votes: {} });
      } else {
        matchups.push({ a: list[i].title, aPoster: list[i].poster, aDesc: list[i].desc||'', aTrailer: list[i].trailerUrl||null, b: 'BYE', bPoster: null, bDesc: '', bTrailer: null, votes: {} });
      }
    }
    onDone(matchups);
  }

  return (
    <div style={{marginTop:16,background:'white',border:'2px solid var(--blue)',borderRadius:8,padding:16,boxShadow:'3px 3px 0 var(--yellow)'}}>
      <div style={{fontWeight:700,marginBottom:12,fontSize:'1rem'}}>Set Up Bracket</div>

      {movies.length > 0 && (
        <div style={{marginBottom:12}}>
          {movies.map((m, i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid var(--cream)'}}>
              {m.poster
                ? <img src={m.poster} style={{width:26,height:39,objectFit:'cover',borderRadius:3,flexShrink:0}} alt="" />
                : <div style={{width:26,height:39,background:'var(--cream)',borderRadius:3,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.65rem'}}>🎬</div>}
              <span style={{flex:1,fontSize:'0.88rem',fontWeight:600}}>{m.title}</span>
              {needsBye && (
                <button
                  style={{fontSize:'0.7rem',background:byeIdx===i?'var(--yellow)':'none',border:`1px solid ${byeIdx===i?'var(--ink)':'#ddd'}`,borderRadius:4,padding:'2px 6px',cursor:'pointer',color:byeIdx===i?'var(--ink)':'#aaa',fontFamily:'inherit'}}
                  onClick={() => setByeIdx(byeIdx === i ? null : i)}>
                  bye
                </button>
              )}
              <button onClick={() => removeMovie(i)} style={{background:'none',border:'none',cursor:'pointer',color:'#bbb',fontSize:'1.1rem',lineHeight:1,padding:'0 2px'}}>×</button>
            </div>
          ))}
        </div>
      )}

      {needsBye && byeIdx === null && (
        <div style={{fontSize:'0.78rem',color:'var(--red)',marginBottom:8,fontFamily:"'Special Elite',monospace"}}>
          Odd number of movies — tap "bye" next to the one that should auto-advance this round.
        </div>
      )}

      <MovieSearch value={searchQuery} onChange={setSearchQuery} onSelect={handleBracketSelect} placeholder="Search for a movie to add…" />

      <div style={{display:'flex',gap:8,marginTop:8}}>
        <button className="home-save-btn" style={{flex:1,padding:'8px'}} disabled={!canStart} onClick={submit}>
          🏆 Start Bracket ({movies.length} movie{movies.length !== 1 ? 's' : ''})
        </button>
        <button className="home-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── BRACKET VOTE VIEW ───────────────────────────────────────────────────────
function BracketVoteView({ bracket, members, onVoteUpdate }) {
  const { currentUser } = React.useContext(UserContext);
  const selectedMember = currentUser?.id ? currentUser.name : '';
  const [viewingPrev, setViewingPrev] = useState(false);
  const [hoverKey, setHoverKey] = useState(null);
  const [mobileOpenIdx, setMobileOpenIdx] = useState(null);
  const [animatingIdx, setAnimatingIdx] = useState(null);
  const [landingIdx, setLandingIdx] = useState(null);
  const [isTouch, setIsTouch] = useState(false);
  const [descCache, setDescCache] = useState({});

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(hover: none)').matches);
  }, []);

  const currentRound = bracket.currentRound || 0;
  const round = bracket.rounds[currentRound];

  useEffect(() => {
    if (!round) return;
    const missing = [];
    for (const m of round) {
      if (!m.aDesc && m.a) missing.push(m.a);
      if (m.b !== 'BYE' && !m.bDesc && m.b) missing.push(m.b);
    }
    if (!missing.length) return;
    missing.forEach(async (rawTitle) => {
      if (descCache[rawTitle]) return;
      try {
        const title = rawTitle.replace(/\s*\(\d{4}\)\s*$/, '');
        const year = rawTitle.match(/\((\d{4})\)/)?.[1];
        let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=en-US&page=1`;
        if (year) url += `&year=${year}`;
        const r = await fetch(url);
        const d = await r.json();
        const overview = d.results?.[0]?.overview;
        if (overview) setDescCache(prev => ({ ...prev, [rawTitle]: overview }));
      } catch(e) {}
    });
  }, [currentRound, bracket]);

  const prevRound = currentRound > 0 ? bracket.rounds[currentRound - 1] : null;
  const isFinished = bracket.finished;
  const winner = bracket.winner;

  async function castVote(originalIdx, movieTitle) {
    if (!selectedMember || animatingIdx !== null) return;
    const updated = JSON.parse(JSON.stringify(bracket));
    const matchup = updated.rounds[currentRound][originalIdx];
    matchup.votes = matchup.votes || {};
    matchup.votes[selectedMember] = movieTitle;
    setAnimatingIdx(originalIdx);
    dbSaveBracket(updated).catch(e => console.error('Failed to save vote:', e));
    setTimeout(() => {
      setAnimatingIdx(null);
      setLandingIdx(originalIdx);
      onVoteUpdate(updated);
      setTimeout(() => setLandingIdx(null), 420);
    }, 740);
  }

  const sortedMatchups = round
    ? [...round.map((m, i) => ({ matchup: m, originalIdx: i }))].sort((x, y) => {
        const xv = selectedMember && !!(x.matchup.votes || {})[selectedMember];
        const yv = selectedMember && !!(y.matchup.votes || {})[selectedMember];
        if (xv === yv) return 0;
        return xv ? 1 : -1;
      })
    : [];

  return (
    <>
      <div className="poll-card" style={{marginBottom:16,cursor:'default'}}>
        <div className="poll-card-label">Bracket · Round {currentRound + 1}{isFinished?' — Final':''}</div>
        <div className="poll-card-question">
          {isFinished ? `Winner: ${winner}` : `🎬 Round ${currentRound + 1} — Vote now!`}
        </div>
      </div>
      {isFinished && winner && (
        <div className="bracket-winner">
          <div className="winner-label">🎬 This Month's Pick</div>
          <div className="winner-title">{winner}</div>
        </div>
      )}
      {!isFinished && (
        <>
          {prevRound && (
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
              <button onClick={() => setViewingPrev(v => !v)}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.78rem',color:'var(--blue-mid)',padding:0,fontFamily:'inherit'}}>
                {viewingPrev ? '← Back to voting' : `View Round ${currentRound} results →`}
              </button>
            </div>
          )}
          {(viewingPrev && prevRound) ? (
            <>
              <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'2px',color:'#aaa',marginBottom:10}}>
                Round {currentRound} Results
              </div>
              {prevRound.map((matchup, i) => {
                const isBye = matchup.b === 'BYE';
                const votes = matchup.votes || {};
                const aVotes = Object.values(votes).filter(v => v === matchup.a).length;
                const bVotes = Object.values(votes).filter(v => v === matchup.b).length;
                const rWinner = isBye ? matchup.a : (aVotes >= bVotes ? matchup.a : matchup.b);
                return (
                  <div key={i} className="matchup-card">
                    <div className="matchup-header">Matchup {i + 1}</div>
                    {isBye ? (
                      <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px 12px'}}>
                        {matchup.aPoster && <img src={matchup.aPoster} style={{width:34,height:51,objectFit:'cover',borderRadius:4,flexShrink:0}} alt="" />}
                        <span style={{fontWeight:700,fontSize:'0.9rem',flex:1}}>{matchup.a}</span>
                        <span style={{fontSize:'0.78rem',color:'var(--green)',fontWeight:700}}>Auto-advanced</span>
                      </div>
                    ) : (
                      <div className="matchup-options">
                        <div className={`vote-btn-h${rWinner===matchup.a?' voted':' lost'}`} style={{cursor:'default'}}>
                          {matchup.aPoster && <img src={matchup.aPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                          <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',wordBreak:'break-word'}}>{matchup.a}</span>
                          <span style={{fontSize:'0.7rem',color:rWinner===matchup.a?'inherit':'#aaa',marginTop:3}}>{aVotes} vote{aVotes!==1?'s':''}</span>
                        </div>
                        <div className="matchup-vs">VS</div>
                        <div className={`vote-btn-h${rWinner===matchup.b?' voted':' lost'}`} style={{cursor:'default'}}>
                          {matchup.bPoster && <img src={matchup.bPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                          <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',wordBreak:'break-word'}}>{matchup.b}</span>
                          <span style={{fontSize:'0.7rem',color:rWinner===matchup.b?'inherit':'#aaa',marginTop:3}}>{bVotes} vote{bVotes!==1?'s':''}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div style={{marginBottom:12}}>
                <ActingAs />
              </div>
              {!selectedMember && <div className="alert alert-error" style={{marginTop:8}}>👆 Pick your name to vote</div>}
              {sortedMatchups.map(({ matchup, originalIdx }) => {
                const isBye = matchup.b === 'BYE';
                const myVote = selectedMember ? (matchup.votes || {})[selectedMember] : null;
                return (
                  <div key={originalIdx} className={`matchup-card${animatingIdx===originalIdx?' matchup-card-flying':landingIdx===originalIdx?' matchup-card-landing':''}`}>
                    <div className="matchup-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span>Matchup {originalIdx + 1}</span>
                      {isBye && <span style={{fontWeight:400,fontSize:'0.68rem',color:'#888',textTransform:'none',letterSpacing:0}}>Auto-advancing</span>}
                    </div>
                    {isBye ? (
                      <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px 12px'}}>
                        {matchup.aPoster && <img src={matchup.aPoster} style={{width:34,height:51,objectFit:'cover',borderRadius:4,flexShrink:0}} alt="" />}
                        <span style={{fontWeight:700,fontSize:'0.9rem',flex:1}}>{matchup.a}</span>
                        <span style={{fontSize:'0.78rem',color:'var(--green)',fontWeight:700,whiteSpace:'nowrap'}}>→ Next round</span>
                      </div>
                    ) : (
                      <>
                        <div className="matchup-options">
                          <button className={`vote-btn-h${myVote===matchup.a?' voted':''}`}
                            onClick={() => { if (isTouch) { setMobileOpenIdx(originalIdx); } else { castVote(originalIdx, matchup.a); } }}
                            onMouseEnter={() => { if (!isTouch) setHoverKey(`${originalIdx}-a`); }}
                            onMouseLeave={() => setHoverKey(null)}
                            disabled={!selectedMember}>
                            {matchup.aPoster && <img src={matchup.aPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                            <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',fontWeight:myVote===matchup.a?700:500,wordBreak:'break-word'}}>{matchup.a}</span>
                            {myVote===matchup.a && <span style={{fontSize:'0.7rem',marginTop:3}}>✓ Voted</span>}
                            {hoverKey===`${originalIdx}-a` && (matchup.aDesc||descCache[matchup.a]) && (
                              <span style={{fontSize:'0.72rem',lineHeight:1.45,color:myVote===matchup.a?'rgba(255,255,255,0.85)':'#666',marginTop:6,textAlign:'left',display:'block',fontWeight:400}}>
                                {((matchup.aDesc||descCache[matchup.a]||'')).length>160?((matchup.aDesc||descCache[matchup.a]||'')).slice(0,160)+'…':(matchup.aDesc||descCache[matchup.a]||'')}
                              </span>
                            )}
                          </button>
                          <div className="matchup-vs">VS</div>
                          <button className={`vote-btn-h${myVote===matchup.b?' voted':''}`}
                            onClick={() => { if (isTouch) { setMobileOpenIdx(originalIdx); } else { castVote(originalIdx, matchup.b); } }}
                            onMouseEnter={() => { if (!isTouch) setHoverKey(`${originalIdx}-b`); }}
                            onMouseLeave={() => setHoverKey(null)}
                            disabled={!selectedMember}>
                            {matchup.bPoster && <img src={matchup.bPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                            <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',fontWeight:myVote===matchup.b?700:500,wordBreak:'break-word'}}>{matchup.b}</span>
                            {myVote===matchup.b && <span style={{fontSize:'0.7rem',marginTop:3}}>✓ Voted</span>}
                            {hoverKey===`${originalIdx}-b` && (matchup.bDesc||descCache[matchup.b]) && (
                              <span style={{fontSize:'0.72rem',lineHeight:1.45,color:myVote===matchup.b?'rgba(255,255,255,0.85)':'#666',marginTop:6,textAlign:'left',display:'block',fontWeight:400}}>
                                {((matchup.bDesc||descCache[matchup.b]||'')).length>160?((matchup.bDesc||descCache[matchup.b]||'')).slice(0,160)+'…':(matchup.bDesc||descCache[matchup.b]||'')}
                              </span>
                            )}
                          </button>
                        </div>
                        {(matchup.aTrailer || matchup.bTrailer) && (
                          <div style={{display:'flex',gap:8,padding:'0 12px 10px',justifyContent:'center'}}>
                            {matchup.aTrailer && (
                              <TrailerButton trailerUrl={matchup.aTrailer} title={matchup.a} color="var(--blue-mid)" />
                            )}
                            {matchup.bTrailer && (
                              <TrailerButton trailerUrl={matchup.bTrailer} title={matchup.b} color="var(--blue-mid)" />
                            )}
                          </div>
                        )}
                        {isTouch && mobileOpenIdx===originalIdx && (
                          <div style={{borderTop:'1px solid var(--cream)',padding:'10px 12px 12px',background:'#fafaf8'}}>
                            {[{title:matchup.a,desc:matchup.aDesc||descCache[matchup.a]||'',trailer:matchup.aTrailer||null,voted:myVote===matchup.a},{title:matchup.b,desc:matchup.bDesc||descCache[matchup.b]||'',trailer:matchup.bTrailer||null,voted:myVote===matchup.b}].map(({title,desc,trailer,voted})=>(
                              <div key={title} style={{marginBottom:10}}>
                                <div style={{fontWeight:700,fontSize:'0.85rem',marginBottom:desc?4:0}}>{title}</div>
                                {desc && <div style={{fontSize:'0.78rem',color:'#666',lineHeight:1.5,marginBottom:6}}>{desc.length>200?desc.slice(0,200)+'…':desc}</div>}
                                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                  <button disabled={!selectedMember}
                                    onClick={() => { castVote(originalIdx, title); setMobileOpenIdx(null); }}
                                    style={{background:voted?'var(--green)':selectedMember?'var(--ink)':'#ccc',color:'white',border:'none',borderRadius:6,padding:'6px 16px',fontSize:'0.82rem',fontWeight:700,cursor:selectedMember?'pointer':'default',fontFamily:'inherit'}}>
                                    {voted?'✓ Voted':'Vote →'}
                                  </button>
                                  {trailer && <TrailerButton trailerUrl={trailer} title={title} />}
                                </div>
                              </div>
                            ))}
                            <button onClick={()=>setMobileOpenIdx(null)}
                              style={{background:'none',border:'none',fontSize:'0.75rem',color:'#aaa',cursor:'pointer',padding:0,fontFamily:'inherit',marginTop:2}}>
                              ✕ Close
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </>
  );
}

// ─── POLL VOTE VIEW ───────────────────────────────────────────────────────────
function PollVoteView({ poll, members, onUpdate, adminAuthed, onDelete }) {
  const { currentUser } = React.useContext(UserContext);
  const selectedMember = currentUser?.id ? currentUser.name : '';
  const [localPoll, setLocalPoll] = useState(poll);
  const [showAddAnswer, setShowAddAnswer] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [newAnswerText, setNewAnswerText] = useState('');
  const [newAnswerImage, setNewAnswerImage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [editingQuestion, setEditingQuestion] = useState(false);
  const [editedQuestion, setEditedQuestion] = useState(localPoll.question);
  const [editingOptionId, setEditingOptionId] = useState(null);
  const [editedOptionText, setEditedOptionText] = useState('');

  const [pollTick, setPollTick] = useState(0);
  const expiresAt = localPoll.created_at ? new Date(localPoll.created_at).getTime() + 24 * 60 * 60 * 1000 : null;
  const msLeft = expiresAt != null ? Math.max(0, expiresAt - Date.now()) : null;
  const cdHours = msLeft != null ? Math.floor(msLeft / 3600000) : 0;
  const cdMins  = msLeft != null ? Math.floor((msLeft % 3600000) / 60000) : 0;
  const alreadyExpired = useRef(msLeft === 0);

  useEffect(() => {
    if (msLeft == null) return;
    if (msLeft === 0) {
      if (!alreadyExpired.current) {
        dbClosePoll(localPoll.id)
          .then(() => { if (onUpdate) onUpdate({ ...localPoll, is_active: false, closed_at: new Date().toISOString() }); })
          .catch(console.error);
      }
      return;
    }
    const t = setTimeout(() => setPollTick(n => n + 1), Math.min(msLeft, 60000));
    return () => clearTimeout(t);
  }, [pollTick]);

  useEffect(() => { setLocalPoll(poll); setEditedQuestion(poll.question); }, [poll]);

  const myVote = (localPoll.votes || []).find(v => v.member_name === selectedMember);
  const myOptionId = myVote ? myVote.option_id : null;
  const totalVotes = (localPoll.votes || []).length;
  const optionsWithCounts = (localPoll.options || []).map(opt => ({
    ...opt,
    voteCount: (localPoll.votes || []).filter(v => v.option_id === opt.id).length
  })).sort((a, b) => b.voteCount - a.voteCount);

  const isCreator = selectedMember && selectedMember === localPoll.created_by;

  async function handleVoteForOption(optionId) {
    const member = selectedMember;
    if (!member || submitting || editingOptionId) return;
    setSubmitting(true);
    try {
      await dbVoteForOption(localPoll.id, optionId, member);
      const newVotes = (localPoll.votes || []).filter(v => v.member_name !== member);
      newVotes.push({ poll_id: localPoll.id, option_id: optionId, member_name: member });
      const updated = { ...localPoll, votes: newVotes };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setSubmitting(false);
  }

  async function handleSaveQuestion() {
    if (!editedQuestion.trim() || editedQuestion === localPoll.question) { setEditingQuestion(false); return; }
    try {
      await dbUpdatePollQuestion(localPoll.id, editedQuestion.trim());
      const updated = { ...localPoll, question: editedQuestion.trim() };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setEditingQuestion(false);
  }

  async function handleSaveOption() {
    if (!editedOptionText.trim()) { setEditingOptionId(null); return; }
    try {
      await dbUpdatePollOption(editingOptionId, editedOptionText.trim());
      const updated = { ...localPoll, options: localPoll.options.map(o => o.id === editingOptionId ? { ...o, text: editedOptionText.trim() } : o) };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setEditingOptionId(null);
  }

  async function handleAddAnswer() {
    if (!selectedMember || !newAnswerText.trim() || submitting) return;
    const inputNorm = newAnswerText.trim().toLowerCase();
    const existing = (localPoll.options || []).find(o => o.text.trim().toLowerCase() === inputNorm);
    if (existing) {
      await handleVoteForOption(existing.id);
      setNewAnswerText(''); setNewAnswerImage(''); setShowAddAnswer(false);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const { updatedPoll } = await dbAddOptionAndVote(localPoll.id, newAnswerText.trim(), selectedMember, localPoll, newAnswerImage);
      setLocalPoll(updatedPoll);
      if (onUpdate) onUpdate(updatedPoll);
      setNewAnswerText('');
      setNewAnswerImage('');
      setShowAddAnswer(false);
    } catch(e) { console.error(e); setSubmitError(e.message || 'Something went wrong'); }
    setSubmitting(false);
  }

  function handlePollSearchSelect(selected) {
    setNewAnswerText(selected.title + (selected.year ? ` (${selected.year})` : ''));
    setNewAnswerImage(selected.poster || '');
  }

  return (
    <div className="poll-card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:14}}>
        {editingQuestion ? (
          <div style={{flex:1}}>
            <input className="form-input" style={{marginBottom:6}} value={editedQuestion}
              onChange={e=>setEditedQuestion(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handleSaveQuestion(); if(e.key==='Escape') setEditingQuestion(false); }}
              autoFocus />
            <div style={{display:'flex',gap:6}}>
              <button className="home-save-btn" style={{padding:'5px 14px'}} onClick={handleSaveQuestion}>Save</button>
              <button className="home-cancel-btn" onClick={()=>{setEditingQuestion(false);setEditedQuestion(localPoll.question);}}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{flex:1}}>
            <div className="poll-question" style={{margin:0}}>{localPoll.question}</div>
            {isCreator && (
              <button onClick={()=>setEditingQuestion(true)}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.75rem',color:'var(--blue-mid)',padding:'2px 0',marginTop:2}}>
                ✏️ Edit question
              </button>
            )}
          </div>
        )}
        {!editingQuestion && (
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2,flexShrink:0}}>
            {localPoll.created_by && <span className="poll-asked-by">{localPoll.created_by}</span>}
            {msLeft != null && msLeft > 0 && (
              <span style={{fontSize:'0.7rem',color:'#e8a87c',fontWeight:600,whiteSpace:'nowrap'}}>
                {cdHours > 0 ? `${cdHours}h ${cdMins}m` : `${cdMins}m`}
              </span>
            )}
          </div>
        )}
      </div>

      {(revealed || myOptionId) ? (
        <>
          {optionsWithCounts.length > 0 && (
            <div style={{marginBottom:12}}>
              {optionsWithCounts.map(opt => {
                const pct = totalVotes ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
                const isMyVote = opt.id === myOptionId;
                const isEditingThis = editingOptionId === opt.id;
                return (
                  <div key={opt.id}>
                    {isEditingThis ? (
                      <div style={{marginBottom:8}}>
                        <input className="form-input" style={{marginBottom:6}} value={editedOptionText}
                          onChange={e=>setEditedOptionText(e.target.value)}
                          onKeyDown={e=>{ if(e.key==='Enter') handleSaveOption(); if(e.key==='Escape') setEditingOptionId(null); }}
                          autoFocus />
                        <div style={{display:'flex',gap:6}}>
                          <button className="home-save-btn" style={{padding:'5px 14px'}} onClick={handleSaveOption}>Save</button>
                          <button className="home-cancel-btn" onClick={()=>setEditingOptionId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={`poll-option-btn${isMyVote?' poll-option-selected':''}`}
                          style={{cursor:!submitting?'pointer':'default',marginBottom:8}}
                          onClick={() => { if(submitting||editingOptionId) return; if(selectedMember) handleVoteForOption(opt.id); }}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:5}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                              {opt.image_url && <img src={opt.image_url} style={{width:28,height:42,objectFit:'cover',borderRadius:3,flexShrink:0}} alt="" />}
                              <span style={{fontWeight:isMyVote?700:400,fontSize:'0.95rem'}}>{opt.text}</span>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                              {isMyVote && selectedMember && (
                                <button onClick={e=>{e.stopPropagation();setEditingOptionId(opt.id);setEditedOptionText(opt.text);}}
                                  style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.72rem',color:'var(--blue-mid)',padding:0,lineHeight:1}}>
                                  ✏️
                                </button>
                              )}
                              <span style={{fontSize:'0.78rem',color:'#888'}}>{opt.voteCount} {opt.voteCount===1?'vote':'votes'}</span>
                            </div>
                          </div>
                          <div className="progress-bar-wrap">
                            <div className="progress-bar" style={{width:`${pct}%`,background:isMyVote?'var(--green)':'var(--blue-mid)'}} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!myOptionId && !showAddAnswer && (
            <button className="home-add-btn" onClick={()=>setShowAddAnswer(true)}>+ Add your answer</button>
          )}
          {!myOptionId && showAddAnswer && (
            <div style={{marginTop:4}}>
              <MovieSearch multi value={newAnswerText} onChange={setNewAnswerText} onSelect={handlePollSearchSelect} placeholder="Type a movie, person, or anything…" />
              <ActingAs />
              {submitError && <div style={{fontSize:'0.78rem',color:'var(--red)',marginBottom:5}}>{submitError}</div>}
              <div style={{display:'flex',gap:8}}>
                <button className="home-save-btn" style={{flex:1,padding:'7px'}} onClick={handleAddAnswer} disabled={!newAnswerText.trim()||!selectedMember||submitting}>{submitting?'…':'Submit Answer'}</button>
                <button className="home-cancel-btn" onClick={()=>{setShowAddAnswer(false);setNewAnswerText('');setNewAnswerImage('');setSubmitError('');}}>Cancel</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div>
          <MovieSearch multi value={newAnswerText} onChange={setNewAnswerText} onSelect={handlePollSearchSelect} placeholder="Type a movie, person, or anything…" />
          <ActingAs />
          {submitError && <div style={{fontSize:'0.78rem',color:'var(--red)',marginBottom:5}}>{submitError}</div>}
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="home-save-btn" style={{flex:1,padding:'7px'}} onClick={handleAddAnswer} disabled={!newAnswerText.trim()||!selectedMember||submitting}>{submitting?'…':'Submit Answer'}</button>
            <button onClick={()=>setRevealed(true)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.78rem',color:'#aaa',padding:'7px 2px',whiteSpace:'nowrap'}}>Reveal results →</button>
          </div>
        </div>
      )}

      {adminAuthed && (
        <div style={{borderTop:'1px dashed var(--cream)',marginTop:14,paddingTop:10,textAlign:'right'}}>
          <button onClick={onDelete}
            style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.8rem',color:'var(--red)',fontWeight:600}}>
            Delete poll
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PAST POLL CARD ───────────────────────────────────────────────────────────
function PastPollCard({ poll, members, onUpdate }) {
  const { currentUser } = React.useContext(UserContext);
  const selectedMember = currentUser?.id ? currentUser.name : '';
  const [localPoll, setLocalPoll] = useState(poll);
  const [expanded, setExpanded] = useState(false);
  const [showAddAnswer, setShowAddAnswer] = useState(false);
  const [newAnswerText, setNewAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [editedQuestion, setEditedQuestion] = useState(poll.question);
  const [editingOptionId, setEditingOptionId] = useState(null);
  const [editedOptionText, setEditedOptionText] = useState('');

  useEffect(() => { setLocalPoll(poll); setEditedQuestion(poll.question); }, [poll]);

  const isCreator = selectedMember && selectedMember === localPoll.created_by;

  async function handleSaveQuestion() {
    if (!editedQuestion.trim() || editedQuestion === localPoll.question) { setEditingQuestion(false); return; }
    try {
      await dbUpdatePollQuestion(localPoll.id, editedQuestion.trim());
      const updated = { ...localPoll, question: editedQuestion.trim() };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setEditingQuestion(false);
  }

  async function handleSaveOption() {
    if (!editedOptionText.trim()) { setEditingOptionId(null); return; }
    try {
      await dbUpdatePollOption(editingOptionId, editedOptionText.trim());
      const updated = { ...localPoll, options: localPoll.options.map(o => o.id === editingOptionId ? { ...o, text: editedOptionText.trim() } : o) };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setEditingOptionId(null);
  }

  const optionsWithCounts = (localPoll.options || []).map(opt => ({
    ...opt,
    voteCount: (localPoll.votes || []).filter(v => v.option_id === opt.id).length
  })).sort((a, b) => b.voteCount - a.voteCount);
  const totalVotes = (localPoll.votes || []).length;
  const myVote = selectedMember ? (localPoll.votes || []).find(v => v.member_name === selectedMember) : null;
  const myOptionId = myVote ? myVote.option_id : null;

  async function handleVote(optionId) {
    if (!selectedMember || submitting) return;
    setSubmitting(true);
    try {
      await dbVoteForOption(localPoll.id, optionId, selectedMember);
      const newVotes = (localPoll.votes || []).filter(v => v.member_name !== selectedMember);
      newVotes.push({ poll_id: localPoll.id, option_id: optionId, member_name: selectedMember });
      const updated = { ...localPoll, votes: newVotes };
      setLocalPoll(updated);
      if (onUpdate) onUpdate(updated);
    } catch(e) { console.error(e); }
    setSubmitting(false);
  }

  async function handleAddNew() {
    if (!selectedMember || !newAnswerText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { updatedPoll } = await dbAddOptionAndVote(localPoll.id, newAnswerText.trim(), selectedMember, localPoll);
      setLocalPoll(updatedPoll);
      if (onUpdate) onUpdate(updatedPoll);
      setNewAnswerText('');
      setShowAddAnswer(false);
    } catch(e) { console.error(e); }
    setSubmitting(false);
  }

  return (
    <div className="movie-rating-card" style={{marginBottom:20}}>
      <div className="rating-card-header" style={{cursor:'pointer'}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{flex:1}}>
          {editingQuestion ? (
            <div onClick={e=>e.stopPropagation()}>
              <input className="form-input" style={{marginBottom:4,fontSize:'0.95rem',padding:'6px 10px'}}
                value={editedQuestion} onChange={e=>setEditedQuestion(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') handleSaveQuestion(); if(e.key==='Escape') setEditingQuestion(false); }}
                autoFocus />
              <div style={{display:'flex',gap:6}}>
                <button className="home-save-btn" style={{padding:'4px 12px',fontSize:'0.82rem'}} onClick={handleSaveQuestion}>Save</button>
                <button className="home-cancel-btn" onClick={()=>{setEditingQuestion(false);setEditedQuestion(localPoll.question);}}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="rating-movie-title">{localPoll.question}</div>
              <div style={{fontSize:'0.72rem',color:'#aaa',marginTop:2}}>
                {totalVotes} vote{totalVotes!==1?'s':''}
                {localPoll.closed_at ? ` · Closed ${new Date(localPoll.closed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}
                {isCreator && (
                  <button onClick={e=>{e.stopPropagation();setEditingQuestion(true);}}
                    style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.72rem',color:'var(--blue-mid)',padding:'0 0 0 8px'}}>
                    ✏️ Edit
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {localPoll.created_by && !editingQuestion && <span className="poll-asked-by" style={{marginRight:6}}>{localPoll.created_by}</span>}
        <span style={{fontSize:'0.72rem',color:'#bbb',marginLeft:4}}>{expanded?'▲':'▼'}</span>
      </div>

      {expanded && (
        <div style={{padding:'10px 16px 14px'}}>
          {optionsWithCounts.map((opt, i) => {
            const pct = totalVotes ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
            const isMyVote = opt.id === myOptionId;
            const isEditingThis = editingOptionId === opt.id;
            return (
              <div key={opt.id}>
                {isEditingThis ? (
                  <div style={{marginBottom:8}}>
                    <input className="form-input" style={{marginBottom:4}} value={editedOptionText}
                      onChange={e=>setEditedOptionText(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter') handleSaveOption(); if(e.key==='Escape') setEditingOptionId(null); }}
                      autoFocus />
                    <div style={{display:'flex',gap:6}}>
                      <button className="home-save-btn" style={{padding:'5px 12px'}} onClick={handleSaveOption}>Save</button>
                      <button className="home-cancel-btn" onClick={()=>setEditingOptionId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className={`poll-option-btn${isMyVote?' poll-option-selected':''}`}
                    onClick={() => selectedMember && handleVote(opt.id)}
                    style={{cursor:selectedMember?'pointer':'default',marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                        {opt.image_url && <img src={opt.image_url} style={{width:28,height:42,objectFit:'cover',borderRadius:3,flexShrink:0}} alt="" />}
                        <span style={{fontWeight:i===0?700:400,fontSize:'0.9rem'}}>{opt.text}</span>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                        {isMyVote && selectedMember && (
                          <button onClick={e=>{e.stopPropagation();setEditingOptionId(opt.id);setEditedOptionText(opt.text);}}
                            style={{background:'none',border:'none',cursor:'pointer',fontSize:'0.7rem',color:'var(--blue-mid)',padding:0}}>
                            ✏️
                          </button>
                        )}
                        <span style={{fontSize:'0.75rem',color:'#888'}}>{pct}% · {opt.voteCount}</span>
                      </div>
                    </div>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar" style={{width:`${pct}%`,background:isMyVote?'var(--green)':i===0?'var(--blue-mid)':'#ccc'}} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{borderTop:'1px dashed var(--cream)',paddingTop:10,marginTop:4}}>
            <div style={{marginBottom:10}}>
              <ActingAs />
            </div>
            {selectedMember && !showAddAnswer && (
              <button className="home-add-btn" style={{fontSize:'0.82rem'}} onClick={()=>setShowAddAnswer(true)}>+ Add new answer</button>
            )}
            {showAddAnswer && (
              <div style={{marginTop:6}}>
                <input className="form-input" style={{marginBottom:4}} value={newAnswerText}
                  onChange={e=>setNewAnswerText(e.target.value)} placeholder="Type your answer…"
                  onKeyDown={e=>e.key==='Enter'&&handleAddNew()} />
                <div style={{display:'flex',gap:6}}>
                  <button className="home-save-btn" style={{flex:1,padding:'6px'}} onClick={handleAddNew}
                    disabled={!newAnswerText.trim()||submitting}>{submitting?'…':'Submit'}</button>
                  <button className="home-cancel-btn" onClick={()=>{setShowAddAnswer(false);setNewAnswerText('');}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAST BRACKET CARD ────────────────────────────────────────────────────────
function PastBracketCard({ bracket, finishedAt, onViewFull }) {
  const dateLabel = finishedAt
    ? new Date(finishedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;
  return (
    <div className="movie-rating-card" style={{marginBottom:20,cursor:'pointer'}} onClick={onViewFull}>
      <div className="rating-card-header">
        <div style={{flex:1}}>
          <div className="rating-movie-title">🏆 {bracket.winner}</div>
          <div style={{fontSize:'0.72rem',color:'#aaa',marginTop:2}}>
            {dateLabel ? `${dateLabel} · ` : ''}Tap to view bracket →
          </div>
        </div>
        <div className="avg-badge" style={{fontSize:'0.72rem',background:'var(--yellow)'}}>Bracket</div>
      </div>
    </div>
  );
}

// ─── BRACKET READ-ONLY PAGE ───────────────────────────────────────────────────
function BracketReadOnlyPage({ bracket, onBack }) {
  if (!bracket || !bracket.finished) {
    return (
      <div className="main">
        <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue-mid)',fontWeight:600,marginBottom:16,padding:0,fontSize:'0.9rem'}}>← Back to Poll</button>
        <div className="empty-state"><div className="empty-icon">🏆</div><div>No finished bracket to view.</div></div>
      </div>
    );
  }
  return (
    <div className="main">
      <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue-mid)',fontWeight:600,marginBottom:16,padding:0,fontSize:'0.9rem'}}>← Back to Poll</button>
      <div className="page-title">The Bracket</div>
      <div className="page-subtitle">Final results</div>
      <div className="bracket-winner">
        <div className="winner-label">🏆 Winner</div>
        <div className="winner-title">{bracket.winner}</div>
      </div>
      {bracket.rounds.map((round, rIdx) => (
        <div key={rIdx} style={{marginBottom:20}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'2px',color:'#aaa',marginBottom:10}}>
            Round {rIdx + 1}{rIdx === bracket.rounds.length - 1 ? ' (Final)' : ''}
          </div>
          {round.map((matchup, i) => {
            const isBye = matchup.b === 'BYE';
            const votes = matchup.votes || {};
            const aVotes = Object.values(votes).filter(v => v === matchup.a).length;
            const bVotes = Object.values(votes).filter(v => v === matchup.b).length;
            const roundWinner = isBye ? matchup.a : (aVotes >= bVotes ? matchup.a : matchup.b);
            return (
              <div key={i} className="matchup-card">
                <div className="matchup-header">Matchup {i + 1}</div>
                {isBye ? (
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px 12px'}}>
                    {matchup.aPoster && <img src={matchup.aPoster} style={{width:34,height:51,objectFit:'cover',borderRadius:4,flexShrink:0}} alt="" />}
                    <span style={{fontWeight:700,fontSize:'0.9rem',flex:1}}>{matchup.a}</span>
                    <span style={{fontSize:'0.78rem',color:'var(--green)',fontWeight:700}}>Auto-advanced</span>
                  </div>
                ) : (
                  <div className="matchup-options">
                    <div className={`vote-btn-h${roundWinner===matchup.a?' voted':' lost'}`} style={{cursor:'default'}}>
                      {matchup.aPoster && <img src={matchup.aPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                      <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',wordBreak:'break-word'}}>{matchup.a}</span>
                      <span style={{fontSize:'0.7rem',color:roundWinner===matchup.a?'inherit':'#aaa',marginTop:3}}>{aVotes} vote{aVotes!==1?'s':''}</span>
                    </div>
                    <div className="matchup-vs">VS</div>
                    <div className={`vote-btn-h${roundWinner===matchup.b?' voted':' lost'}`} style={{cursor:'default'}}>
                      {matchup.bPoster && <img src={matchup.bPoster} style={{width:44,height:66,objectFit:'cover',borderRadius:5,marginBottom:5,flexShrink:0}} alt="" />}
                      <span style={{fontSize:'0.82rem',lineHeight:1.3,textAlign:'center',wordBreak:'break-word'}}>{matchup.b}</span>
                      <span style={{fontSize:'0.7rem',color:roundWinner===matchup.b?'inherit':'#aaa',marginTop:3}}>{bVotes} vote{bVotes!==1?'s':''}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── POLL PAGE ────────────────────────────────────────────────────────────────
function PollPage({ polls, bracket, bracketHistory, members, onPollUpdate, onBracketUpdate, adminAuthed, onNavigate, onPollsAdd, onPollsRemove }) {
  const { currentUser } = React.useContext(UserContext);
  const newPollAsker = currentUser?.id ? currentUser.name : '';
  const [tab, setTab] = useState('live');
  const [showBracketSetup, setShowBracketSetup] = useState(false);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const activePoll = (polls || []).find(p => p.is_active);
  const pastPolls = (polls || []).filter(p => !p.is_active).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  const activeBracket = bracket && !bracket.finished ? bracket : null;

  async function handleCreatePoll() {
    if (!newPollAsker) { setCreateErr('Pick your identity first'); return; }
    if (!newQuestion.trim()) { setCreateErr('Enter a question first'); return; }
    setCreating(true); setCreateErr('');
    try {
      const newPoll = await dbCreatePoll(newQuestion.trim(), newPollAsker);
      if (onPollsAdd) onPollsAdd(newPoll);
      setNewQuestion('');
      setShowCreatePoll(false);
    } catch(e) { setCreateErr('Error: ' + e.message); }
    setCreating(false);
  }

  return (
    <div className="main">
      <div className="page-title">Poll</div>
      <div className="page-subtitle">Vote on what's next</div>

      <div className="ratings-tabs" style={{marginBottom:20}}>
        <button className={`ratings-tab ${tab==='live'?'active':''}`} onClick={()=>setTab('live')}>Live</button>
        <button className={`ratings-tab ${tab==='past'?'active':''}`} onClick={()=>setTab('past')}>Past</button>
      </div>

      {tab === 'live' && (
        <>
          {!activeBracket && !activePoll && !showCreatePoll && (
            <button className="setup-bracket-btn" style={{marginTop:0,padding:'14px 16px',fontSize:'1rem',marginBottom:16}}
              onClick={()=>setShowCreatePoll(true)}>
              + Ask a question
            </button>
          )}

          {!activeBracket && showCreatePoll && (
            <div style={{marginBottom:16,background:'white',border:'2px solid var(--blue)',borderRadius:8,padding:16,boxShadow:'3px 3px 0 var(--yellow)'}}>
              <div style={{fontWeight:700,marginBottom:12,fontSize:'1rem'}}>New Poll</div>
              <ActingAs />
              <label className="form-label">Your question</label>
              <input className="form-input" value={newQuestion} onChange={e=>setNewQuestion(e.target.value)}
                placeholder="Ask the group anything…"
                onKeyDown={e=>e.key==='Enter'&&handleCreatePoll()} />
              {createErr && <div style={{color:'var(--red)',fontSize:'0.8rem',marginBottom:8}}>{createErr}</div>}
              <div style={{display:'flex',gap:8}}>
                <button className="home-save-btn" style={{flex:1,padding:'8px'}} onClick={handleCreatePoll}
                  disabled={!newQuestion.trim()||!newPollAsker||creating}>
                  {creating ? '…' : 'Post Poll'}
                </button>
                <button className="home-cancel-btn" onClick={()=>{setShowCreatePoll(false);setNewQuestion('');setCreateErr('');}}>Cancel</button>
              </div>
            </div>
          )}

          {activeBracket ? (
            <BracketVoteView bracket={activeBracket} members={members} onVoteUpdate={onBracketUpdate} />
          ) : activePoll ? (
            <PollVoteView poll={activePoll} members={members} onUpdate={onPollUpdate}
              adminAuthed={adminAuthed}
              onDelete={async () => {
                try { await dbDeletePoll(activePoll.id); if (onPollsRemove) onPollsRemove(activePoll.id); } catch(e) { console.error(e); }
              }} />
          ) : (
            !showCreatePoll && <div className="empty-state"><div>No active poll yet.</div></div>
          )}

          {adminAuthed && !activeBracket && !showBracketSetup && (
            <button className="setup-bracket-btn" style={{marginTop:8}} onClick={()=>setShowBracketSetup(true)}>
              + Set Up Bracket
            </button>
          )}

          {adminAuthed && showBracketSetup && (
            <BracketSetupForm
              onDone={async (matchups) => {
                const newBracket = { rounds: [matchups], currentRound: 0, finished: false, winner: null };
                try {
                  await dbSaveBracket(newBracket);
                  onBracketUpdate(newBracket);
                  setShowBracketSetup(false);
                } catch(e) { console.error('Error creating bracket:', e); }
              }}
              onCancel={() => setShowBracketSetup(false)}
            />
          )}
        </>
      )}

      {tab === 'past' && (
        <>
          {(bracketHistory || []).map(record => (
            <PastBracketCard key={record.id} bracket={record.data} finishedAt={record.finished_at}
              onViewFull={() => onNavigate(`bracket/${record.id}`)} />
          ))}
          {pastPolls.length === 0 && (bracketHistory || []).length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div>No past polls yet.</div>
            </div>
          )}
          {pastPolls.map(poll => (
            <PastPollCard key={poll.id} poll={poll} members={members}
              onUpdate={updated => onPollUpdate(updated)} />
          ))}
        </>
      )}
    </div>
  );
}

// ─── WATCHLIST PAGE ───────────────────────────────────────────────────────────
function WatchListPage({ members, alltime, ratings, embedded }) {
  const { currentUser } = React.useContext(UserContext);
  const initSlug = useRef((() => {
    const parts = window.location.pathname.replace(/^\//, '').split('/');
    return parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : '';
  })());

  const [selectedMember, _setSelectedMember] = useState(() => {
    if (initSlug.current) return '';
    return currentUser?.id ? currentUser.name : '';
  });
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [watchedModal, setWatchedModal] = useState(null);
  const [listErr, setListErr] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [descs, setDescs] = useState({});
  const [providers, setProviders] = useState({});
  const [membersWithItems, setMembersWithItems] = useState(new Set());

  useEffect(() => {
    dbLoadWatchlist()
      .then(all => setMembersWithItems(new Set(all.filter(i => !i.watched).map(i => i.member_name))))
      .catch(() => {});
  }, []);

  async function fetchDesc(item) {
    if (descs[item.id] !== undefined) return;
    setDescs(prev => ({ ...prev, [item.id]: null }));
    setProviders(prev => ({ ...prev, [item.id]: null }));
    try {
      let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(item.title)}&language=en-US&page=1`;
      if (item.year) url += `&year=${item.year}`;
      const res = await fetch(url);
      const data = await res.json();
      const first = (data.results || [])[0];
      setDescs(prev => ({ ...prev, [item.id]: first?.overview || '' }));
      if (first?.id) {
        try {
          const wpRes = await fetch(`https://api.themoviedb.org/3/movie/${first.id}/watch/providers?api_key=${TMDB_KEY}`);
          const wpData = await wpRes.json();
          const us = wpData?.results?.US || {};
          const flat = (us.flatrate || []).map(p => p.provider_name);
          setProviders(prev => ({ ...prev, [item.id]: flat }));
        } catch(e) {
          setProviders(prev => ({ ...prev, [item.id]: [] }));
        }
      } else {
        setProviders(prev => ({ ...prev, [item.id]: [] }));
      }
    } catch(e) {
      setDescs(prev => ({ ...prev, [item.id]: '' }));
      setProviders(prev => ({ ...prev, [item.id]: [] }));
    }
  }

  function toggleExpand(item) {
    const next = expandedId === item.id ? null : item.id;
    setExpandedId(next);
    if (next !== null) fetchDesc(item);
  }

  useEffect(() => {
    if (!initSlug.current || selectedMember) return;
    const match = (members || []).find(m => m.toLowerCase() === initSlug.current);
    if (match) _setSelectedMember(match);
  }, [members]);

  useEffect(() => {
    function onPop() {
      const parts = window.location.pathname.replace(/^\//, '').split('/');
      const slug = parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : '';
      const match = slug ? (members || []).find(m => m.toLowerCase() === slug) || '' : '';
      _setSelectedMember(match);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [members]);

  function selectMember(name) {
    const next = selectedMember === name ? '' : name;
    _setSelectedMember(next);
    window.history.pushState(null, '', next ? `/watchlist/${next.toLowerCase()}` : '/watchlist');
    if (!next) setShowAddForm(false);
  }

  useEffect(() => {
    if (!selectedMember) { setList([]); return; }
    setLoadingList(true);
    setListErr('');
    dbLoadWatchlist()
      .then(all => setList(all.filter(i => i.member_name === selectedMember)))
      .catch(e => setListErr(e.message))
      .finally(() => setLoadingList(false));
  }, [selectedMember]);

  async function handleWatched(item) {
    setList(prev => prev.map(i => i.id === item.id ? { ...i, watched: true } : i));
    try { await dbMarkWatchlistWatched(item.id); } catch(e) { console.error(e); }
    setWatchedModal(item);
  }

  async function handleRemove(item) {
    const remaining = list.filter(i => i.id !== item.id && !i.watched);
    setList(prev => prev.filter(i => i.id !== item.id));
    if (remaining.length === 0) {
      setMembersWithItems(prev => { const s = new Set(prev); s.delete(selectedMember); return s; });
    }
    try { await dbRemoveFromWatchlist(item.id); } catch(e) { console.error(e); }
  }

  const sorted = [...list].sort((a, b) => {
    if (a.watched !== b.watched) return a.watched ? 1 : -1;
    if (a.urgency === b.urgency) return 0;
    return a.urgency === 'really' ? -1 : 1;
  });

  const watchlistContent = (
    <div className={embedded ? undefined : 'main'}>
      {!embedded && <div className="page-title">Watch List</div>}
      {!embedded && <div className="page-subtitle">What to watch next</div>}

      <div className="wl-member-grid">
        {(members || []).map(m => (
          <button key={m}
            className={`wl-member-btn ${selectedMember === m ? 'active' : membersWithItems.has(m) ? 'has-items' : ''}`}
            onClick={() => selectMember(m)}>
            {m}
          </button>
        ))}
      </div>

      {selectedMember && (
        <>
          {showAddForm
            ? <WatchListAddForm memberName={selectedMember}
                onAdd={item => { setList(prev => [...prev, item]); setShowAddForm(false); setMembersWithItems(prev => new Set([...prev, selectedMember])); }}
                onCancel={() => setShowAddForm(false)} />
            : <button className="wl-add-btn" onClick={() => setShowAddForm(true)}>＋ Add a movie</button>
          }

          {loadingList && <div style={{textAlign:'center',padding:20,color:'#aaa'}}>Loading…</div>}
          {listErr && <div className="alert alert-error">{listErr}</div>}

          {!loadingList && !listErr && sorted.length === 0 && (
            <div className="empty-state">
              <div>{selectedMember}'s watch list is empty.<br/>Add some movies above!</div>
            </div>
          )}

          {sorted.map(item => {
            const isReally   = item.urgency === 'really' && !item.watched;
            const isWatched  = item.watched;
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id}
                className={`wl-item${isReally?' wl-item-really':''}${isWatched?' wl-item-watched':''}`}
                style={{flexWrap:'wrap', cursor:'pointer'}}
                onClick={() => toggleExpand(item)}>
                {item.poster
                  ? <img src={item.poster} className="wl-poster" alt="" />
                  : <div className="wl-poster-placeholder">🎬</div>}
                <div className="wl-info">
                  <div className="wl-title">{item.title}</div>
                  {item.year && <div className="wl-year">{item.year}</div>}
                  <span className={`wl-urgency-tag ${isWatched?'wl-tag-watched':isReally?'wl-tag-really':'wl-tag-want'}`}>
                    {isWatched ? 'Watched' : isReally ? 'REALLY want' : 'Want to watch'}
                  </span>
                </div>
                <div className="wl-actions" onClick={e => e.stopPropagation()}>
                  {!isWatched && (
                    <button className="wl-btn wl-btn-watched" onClick={() => handleWatched(item)}>Mark as Watched</button>
                  )}
                  <button className="wl-btn wl-btn-remove" onClick={() => handleRemove(item)}>Remove</button>
                </div>
                {isExpanded && (
                  <div style={{flexBasis:'100%', padding:'8px 14px 12px', borderTop:'1px solid var(--cream)', fontSize:'0.83rem', color:'#555', lineHeight:1.55, position:'relative', zIndex:1}}>
                    {descs[item.id] === undefined || descs[item.id] === null
                      ? <span style={{color:'#bbb'}}>Loading…</span>
                      : descs[item.id] || <span style={{color:'#bbb'}}>No description available.</span>
                    }
                    {providers[item.id] != null && (
                      <div style={{marginTop:10}}>
                        <div className="where-label">Where to watch</div>
                        {providers[item.id].length > 0
                          ? <div className="streaming-chips">
                              {providers[item.id].map((p, i) => (
                                <span key={i} className="chip" style={{background:'rgba(232,168,124,0.15)', borderColor:'#e8a87c', color:'#c17a3a'}}>{p}</span>
                              ))}
                            </div>
                          : <span style={{color:'#bbb'}}>Not free on any subscription service — likely available to rent.</span>
                        }
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {watchedModal && (
        <WatchedModal item={watchedModal} alltime={alltime} ratings={ratings}
          onClose={() => setWatchedModal(null)} />
      )}
    </div>
  );
  return watchlistContent;
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
function AdminPanel({ onClose, movies, setMovies, members, setMembers, bracket, setBracket, alltime, setAlltime, ratings, setRatings, polls, setPolls, onBracketHistoryAdd, currentEvent, setCurrentEvent }) {
  const [section, setSection] = useState('movies');
  const [msg, setMsg] = useState(null);

  const [pollQuestion, setPollQuestion] = useState('');
  const activePollAdmin = (polls || []).find(p => p.is_active);

  async function adminCreatePoll() {
    if (!pollQuestion.trim()) { showMsg('Enter a question', 'error'); return; }
    try {
      const newPoll = await dbCreatePoll(pollQuestion.trim());
      if (setPolls) setPolls(prev => [newPoll, ...(prev || [])]);
      setPollQuestion('');
      showMsg('Poll created!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function adminClosePoll() {
    if (!activePollAdmin) return;
    try {
      await dbClosePoll(activePollAdmin.id);
      if (setPolls) setPolls(prev => (prev || []).map(p => p.id === activePollAdmin.id ? { ...p, is_active: false, closed_at: new Date().toISOString() } : p));
      showMsg('Poll closed!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function adminDeletePoll(pollId) {
    try {
      await dbDeletePoll(pollId);
      if (setPolls) setPolls(prev => (prev || []).filter(p => p.id !== pollId));
      showMsg('Poll deleted.');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  const [mnOverride,    setMnOverride]    = useState('');
  const [mnCurrent,     setMnCurrent]     = useState(null);
  const [mnJoinUrl,     setMnJoinUrl]     = useState('');
  const [mnJoinCurrent, setMnJoinCurrent] = useState('');
  const [mnLoading,     setMnLoading]     = useState(false);
  useEffect(() => {
    if (section === 'movienight') {
      dbLoadOverride().then(v => setMnCurrent(v));
      dbLoadJoinUrl().then(v => { setMnJoinCurrent(v||''); setMnJoinUrl(v||''); });
    }
  }, [section]);

  const [movie1Title, setMovie1Title] = useState(movies[0]?.title || '');
  const [movie1Year, setMovie1Year] = useState(movies[0]?.year || '');
  const [movie1Desc, setMovie1Desc] = useState(movies[0]?.description || '');
  const [movie1Stream, setMovie1Stream] = useState(movies[0]?.streaming?.join(', ') || '');
  const [movie1Scale, setMovie1Scale] = useState(movies[0]?.ratingScale || '');
  const [movie1Poster, setMovie1Poster] = useState(movies[0]?.poster || '');
  const [movie1TmdbId, setMovie1TmdbId] = useState(movies[0]?.tmdbId || null);
  const [movie1Trailer, setMovie1Trailer] = useState(movies[0]?.trailerUrl || '');
  const [movie2Title, setMovie2Title] = useState(movies[1]?.title || '');
  const [movie2Year, setMovie2Year] = useState(movies[1]?.year || '');
  const [movie2Desc, setMovie2Desc] = useState(movies[1]?.description || '');
  const [movie2Stream, setMovie2Stream] = useState(movies[1]?.streaming?.join(', ') || '');
  const [movie2Scale, setMovie2Scale] = useState(movies[1]?.ratingScale || '');
  const [movie2Poster, setMovie2Poster] = useState(movies[1]?.poster || '');
  const [movie2TmdbId, setMovie2TmdbId] = useState(movies[1]?.tmdbId || null);
  const [movie2Trailer, setMovie2Trailer] = useState(movies[1]?.trailerUrl || '');
  const [sessionThemeInput, setSessionThemeInput] = useState(movies[0]?.sessionTheme || '');

  const [newMember, setNewMember] = useState('');
  const [localMembers, setLocalMembers] = useState([...members]);

  const [showAdminBracketSetup, setShowAdminBracketSetup] = useState(false);
  const [editingRound1, setEditingRound1] = useState(false);
  const [round1Edits, setRound1Edits] = useState([]);

  const [editMovieId, setEditMovieId] = useState('');
  const [editMember, setEditMember] = useState('');
  const [editScore, setEditScore] = useState('');

  async function saveEditedRating() {
    if (!editMovieId || !editMember || !editScore) { showMsg('Fill in all fields', 'error'); return; }
    const mid = parseInt(editMovieId);
    const sc = parseFloat(editScore);
    if (isNaN(sc) || sc < 0 || sc > 10) { showMsg('Score must be a number 0–10', 'error'); return; }
    try {
      await dbSaveRating(mid, editMember, sc);
      if (setRatings) {
        if (sc === 0) {
          setRatings(prev => { const mr = { ...(prev[mid] || {}) }; delete mr[editMember]; return { ...prev, [mid]: mr }; });
        } else {
          setRatings(prev => ({ ...prev, [mid]: { ...(prev[mid] || {}), [editMember]: sc } }));
        }
      }
      const isArchived = alltime.some(m => m.id === mid);
      if (isArchived) {
        const newAvg = await dbRecalcAvg(mid);
        if (newAvg !== null && setAlltime) {
          setAlltime(prev => prev.map(m => m.id === mid ? { ...m, avgScore: newAvg } : m));
        }
      }
      showMsg(sc === 0 ? `Rating deleted: ${editMember} on movie #${mid}` : `Rating saved: ${editMember} → ${sc} on movie #${mid}`);
      setEditScore('');
    } catch(e) {
      showMsg('Error: ' + e.message, 'error');
    }
  }

  function showMsg(text, type='success') {
    setMsg({text, type});
    setTimeout(() => setMsg(null), 3000);
  }

  async function saveMovies() {
    const [t1, t2] = await Promise.all([
      movie1TmdbId ? fetchTrailerUrl(movie1TmdbId) : Promise.resolve(null),
      movie2TmdbId ? fetchTrailerUrl(movie2TmdbId) : Promise.resolve(null),
    ]);
    const newData = [
      {
        title: movie1Title, year: movie1Year, description: movie1Desc,
        streaming: movie1Stream.split(',').map(s=>s.trim()).filter(Boolean),
        ratingScale: movie1Scale, sessionTheme: sessionThemeInput,
        poster: movie1Poster || null, accent: ACCENT_COLORS[0],
        tmdbId: movie1TmdbId || null, trailerUrl: t1,
      },
      {
        title: movie2Title, year: movie2Year, description: movie2Desc,
        streaming: movie2Stream.split(',').map(s=>s.trim()).filter(Boolean),
        ratingScale: movie2Scale, sessionTheme: sessionThemeInput,
        poster: movie2Poster || null, accent: ACCENT_COLORS[1],
        tmdbId: movie2TmdbId || null, trailerUrl: t2,
      }
    ].filter(m => m.title);
    try {
      const saved = await dbSaveMovies(movies, newData);
      setMovies(saved);
      showMsg('Movies saved!');
    } catch(e) {
      showMsg('Error saving: ' + e.message, 'error');
    }
  }

  async function saveMembers() {
    try {
      await dbSaveMembers(localMembers);
      setMembers(localMembers);
      showMsg('Members saved!');
    } catch(e) {
      showMsg('Error saving: ' + e.message, 'error');
    }
  }

  function addMember() {
    if (!newMember.trim()) return;
    setLocalMembers(prev => [...prev, newMember.trim()]);
    setNewMember('');
  }

  function removeMember(name) {
    setLocalMembers(prev => prev.filter(m => m !== name));
  }

  async function advanceBracket() {
    if (!bracket || bracket.finished) return;
    const round = bracket.rounds[bracket.currentRound];

    const winnerObjs = round.map(matchup => {
      if (matchup.b === 'BYE') {
        return { title: matchup.a, poster: matchup.aPoster || null, desc: matchup.aDesc || '', trailerUrl: matchup.aTrailer || null, voteCount: 0 };
      }
      const votes = matchup.votes || {};
      const aVotes = Object.values(votes).filter(v => v === matchup.a).length;
      const bVotes = Object.values(votes).filter(v => v === matchup.b).length;
      const isA = aVotes >= bVotes;
      return { title: isA ? matchup.a : matchup.b, poster: isA ? (matchup.aPoster||null) : (matchup.bPoster||null), desc: isA ? (matchup.aDesc||'') : (matchup.bDesc||''), trailerUrl: isA ? (matchup.aTrailer||null) : (matchup.bTrailer||null), voteCount: isA ? aVotes : bVotes };
    });

    if (winnerObjs.length === 1) {
      const final = { ...bracket, finished: true, winner: winnerObjs[0].title };
      try {
        await dbSaveBracket(final);
        const record = await dbSaveBracketHistory(final);
        setBracket(final);
        if (onBracketHistoryAdd && record) onBracketHistoryAdd({ id: record.id, data: final, finished_at: record.finished_at });
        showMsg(`🏆 ${winnerObjs[0].title} wins!`);
      } catch(e) {
        showMsg('Error: ' + e.message, 'error');
      }
      return;
    }

    if (winnerObjs.length % 2 !== 0) {
      const maxVotes = Math.max(...winnerObjs.map(w => w.voteCount));
      const byeIdx = winnerObjs.findIndex(w => w.voteCount === maxVotes);
      const [byeWinner] = winnerObjs.splice(byeIdx, 1);
      winnerObjs.push(byeWinner);
    }

    const nextMatchups = [];
    for (let i = 0; i < winnerObjs.length; i += 2) {
      if (i + 1 < winnerObjs.length) {
        nextMatchups.push({ a: winnerObjs[i].title, aPoster: winnerObjs[i].poster, aDesc: winnerObjs[i].desc||'', aTrailer: winnerObjs[i].trailerUrl||null, b: winnerObjs[i+1].title, bPoster: winnerObjs[i+1].poster, bDesc: winnerObjs[i+1].desc||'', bTrailer: winnerObjs[i+1].trailerUrl||null, votes: {} });
      } else {
        nextMatchups.push({ a: winnerObjs[i].title, aPoster: winnerObjs[i].poster, aDesc: winnerObjs[i].desc||'', aTrailer: winnerObjs[i].trailerUrl||null, b: 'BYE', bPoster: null, bDesc: '', bTrailer: null, votes: {} });
      }
    }
    const updated = { ...bracket, rounds: [...bracket.rounds, nextMatchups], currentRound: bracket.currentRound + 1 };
    try {
      await dbSaveBracket(updated);
      setBracket(updated);
      showMsg('Advanced to next round!');
    } catch(e) {
      showMsg('Error: ' + e.message, 'error');
    }
  }

  async function saveRound1Edits() {
    const updated = JSON.parse(JSON.stringify(bracket));
    updated.rounds[0] = round1Edits.map((edit, i) => ({
      ...bracket.rounds[0][i],
      a: edit.a.trim() || bracket.rounds[0][i].a,
      b: edit.b === 'BYE' ? 'BYE' : (edit.b.trim() || bracket.rounds[0][i].b),
    }));
    try {
      await dbSaveBracket(updated);
      setBracket(updated);
      setEditingRound1(false);
      showMsg('Bracket updated!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function shuffleRound1() {
    const pool = [];
    for (const m of bracket.rounds[0]) {
      pool.push({ title: m.a, poster: m.aPoster || null, desc: m.aDesc || '' });
      if (m.b !== 'BYE') pool.push({ title: m.b, poster: m.bPoster || null, desc: m.bDesc || '' });
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const newMatchups = [];
    for (let i = 0; i < pool.length; i += 2) {
      if (i + 1 < pool.length) {
        newMatchups.push({ a: pool[i].title, aPoster: pool[i].poster, aDesc: pool[i].desc, b: pool[i+1].title, bPoster: pool[i+1].poster, bDesc: pool[i+1].desc, votes: {} });
      } else {
        newMatchups.push({ a: pool[i].title, aPoster: pool[i].poster, aDesc: pool[i].desc, b: 'BYE', bPoster: null, bDesc: '', votes: {} });
      }
    }
    const updated = { ...bracket, rounds: [newMatchups, ...bracket.rounds.slice(1)] };
    try {
      await dbSaveBracket(updated);
      setBracket(updated);
      showMsg('Bracket shuffled!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function archiveMovies() {
    try {
      const newArchived = await dbArchiveMovies(movies, ratings);
      if (!newArchived.length) { showMsg('No rated movies to archive', 'error'); return; }
      const updated = [...(alltime || []), ...newArchived];
      setAlltime(updated);
      setMovies(prev => prev.filter(m => !newArchived.find(a => a.id === m.id)));
      showMsg('Movies archived to All Time list!');
    } catch(e) {
      showMsg('Error archiving: ' + e.message, 'error');
    }
  }

  // ── This Month's Movies admin state ──
  const [tmmEvents, setTmmEvents] = useState([]);
  const [tmmLoaded, setTmmLoaded] = useState(false);
  const [tmmSelectedId, setTmmSelectedId] = useState('new');
  const [tmmMonth, setTmmMonth] = useState('');
  const [tmmTheme, setTmmTheme] = useState('');
  const [tmmMovie1Search, setTmmMovie1Search] = useState('');
  const [tmmMovie1Id, setTmmMovie1Id] = useState(null);
  const [tmmMovie2Search, setTmmMovie2Search] = useState('');
  const [tmmMovie2Id, setTmmMovie2Id] = useState(null);
  const [tmmMeetingDatetime, setTmmMeetingDatetime] = useState('');
  const [tmmDefaultMeetingLink, setTmmDefaultMeetingLink] = useState('');
  const [tmmMeetingLink, setTmmMeetingLink] = useState('');
  const [tmmTrivia, setTmmTrivia] = useState('');

  useEffect(() => {
    if (section === 'thismonth' && !tmmLoaded) {
      Promise.all([
        dbLoadMonthlyEvents(),
        dbLoadJoinUrl(),
      ]).then(([events, joinUrl]) => {
        const defaultLink = joinUrl || '';
        setTmmDefaultMeetingLink(defaultLink);
        setTmmEvents(events);
        setTmmLoaded(true);
        if (currentEvent) {
          setTmmSelectedId(String(currentEvent.id));
          loadTmmEvent(currentEvent, defaultLink);
        } else {
          setTmmMeetingLink(defaultLink);
        }
      }).catch(() => setTmmLoaded(true));
    }
  }, [section]);

  function loadTmmEvent(ev, defaultLink) {
    const fallback = defaultLink !== undefined ? defaultLink : tmmDefaultMeetingLink;
    setTmmMonth(ev.month || '');
    setTmmTheme(ev.theme || '');
    setTmmMovie1Id(ev.movie_id_1 || null);
    setTmmMovie2Id(ev.movie_id_2 || null);
    const allMovies = [...(movies || []), ...(alltime || [])];
    const m1 = allMovies.find(m => m.id === ev.movie_id_1);
    const m2 = allMovies.find(m => m.id === ev.movie_id_2);
    setTmmMovie1Search(m1 ? m1.title : '');
    setTmmMovie2Search(m2 ? m2.title : '');
    setTmmMeetingDatetime(ev.meeting_datetime ? isoToLocalDatetimeLocal(ev.meeting_datetime) : '');
    setTmmMeetingLink(ev.meeting_link || fallback);
    setTmmTrivia(ev.trivia || '');
  }

  function handleTmmSelect(idStr) {
    setTmmSelectedId(idStr);
    if (idStr === 'new') {
      setTmmMonth(''); setTmmTheme('');
      setTmmMovie1Id(null); setTmmMovie1Search('');
      setTmmMovie2Id(null); setTmmMovie2Search('');
      setTmmMeetingDatetime(''); setTmmMeetingLink(tmmDefaultMeetingLink); setTmmTrivia('');
    } else {
      const ev = tmmEvents.find(e => String(e.id) === idStr);
      if (ev) loadTmmEvent(ev);
    }
  }

  async function saveTmmEvent() {
    if (!tmmMonth) { showMsg('Month is required', 'error'); return; }
    try {
      const payload = {
        id: tmmSelectedId !== 'new' ? parseInt(tmmSelectedId) : undefined,
        month: tmmMonth,
        theme: tmmTheme || null,
        movieId1: tmmMovie1Id || null,
        movieId2: tmmMovie2Id || null,
        isCurrent: false,
        meetingDatetime: tmmMeetingDatetime ? new Date(tmmMeetingDatetime).toISOString() : null,
        meetingLink: tmmMeetingLink || null,
        trivia: tmmTrivia || null,
      };
      const saved = await dbSaveMonthlyEvent(payload);
      setTmmEvents(prev => {
        const exists = prev.find(e => e.id === saved.id);
        return exists ? prev.map(e => e.id === saved.id ? saved : e) : [saved, ...prev];
      });
      setTmmSelectedId(String(saved.id));
      if (saved.is_current && setCurrentEvent) setCurrentEvent(saved);
      showMsg('Event saved!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function setTmmCurrent() {
    if (tmmSelectedId === 'new') { showMsg('Save the event first', 'error'); return; }
    try {
      const updated = await dbSetCurrentMonthlyEvent(parseInt(tmmSelectedId));
      setTmmEvents(prev => prev.map(e => ({ ...e, is_current: e.id === updated.id })));
      if (setCurrentEvent) setCurrentEvent(updated);
      showMsg('Set as current month!');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  async function deleteTmmEvent() {
    if (tmmSelectedId === 'new') return;
    try {
      await dbDeleteMonthlyEvent(parseInt(tmmSelectedId));
      const deleted = tmmEvents.find(e => String(e.id) === tmmSelectedId);
      setTmmEvents(prev => prev.filter(e => String(e.id) !== tmmSelectedId));
      if (deleted && deleted.is_current && setCurrentEvent) setCurrentEvent(null);
      setTmmSelectedId('new');
      setTmmMonth(''); setTmmTheme('');
      setTmmMovie1Id(null); setTmmMovie1Search('');
      setTmmMovie2Id(null); setTmmMovie2Search('');
      setTmmMeetingDatetime(''); setTmmMeetingLink(''); setTmmTrivia('');
      showMsg('Event deleted.');
    } catch(e) { showMsg('Error: ' + e.message, 'error'); }
  }

  const [fetchingTrailers, setFetchingTrailers] = React.useState(false);
  async function fetchMissingTrailers() {
    const allMovies = [...(movies || []), ...(alltime || [])];
    const missing = allMovies.filter(m => !m.trailerUrl);
    if (!missing.length) { showMsg('All movies already have trailers!'); return; }
    setFetchingTrailers(true);
    let updated = 0, failed = 0;
    for (const m of missing) {
      try {
        let tmdbId = m.tmdbId;
        if (!tmdbId) {
          const q = encodeURIComponent(m.title.replace(/\s*\(\d{4}\)$/, ''));
          const yr = m.year || '';
          let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}&language=en-US&page=1`;
          if (yr) url += `&year=${yr}`;
          const r = await fetch(url);
          const d = await r.json();
          const first = (d.results || [])[0];
          if (!first) { failed++; continue; }
          tmdbId = first.id;
        }
        const trailerUrl = await fetchTrailerUrl(tmdbId);
        if (!trailerUrl) { failed++; continue; }
        await sb.from('movies').update({ tmdb_id: tmdbId, trailer_url: trailerUrl }).eq('id', m.id);
        if (movies.find(x => x.id === m.id)) {
          setMovies(prev => prev.map(x => x.id === m.id ? { ...x, tmdbId, trailerUrl } : x));
        }
        if ((alltime || []).find(x => x.id === m.id)) {
          setAlltime(prev => prev.map(x => x.id === m.id ? { ...x, tmdbId, trailerUrl } : x));
        }
        updated++;
      } catch(e) { failed++; }
    }
    setFetchingTrailers(false);
    showMsg(`Trailers fetched: ${updated} updated, ${failed} not found.`, failed > 0 ? 'error' : 'success');
  }

  return (
    <div className="admin-overlay" onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div className="admin-sheet">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4}}>
          <div>
            <div className="admin-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{color:'var(--blue-mid)',flexShrink:0}}>
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
              </svg>
              Admin Panel
            </div>
            <div className="admin-subtitle">Movie Club command center</div>
          </div>
          <button className="admin-close-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        <div className="admin-nav">
          {['movies','members','poll','bracket','ratings','movienight','thismonth'].map(s => (
            <button key={s} className={`admin-nav-btn ${section===s?'active':''}`} onClick={()=>setSection(s)}>
              {s === 'movies' ? 'Movies' : s === 'members' ? 'Members' : s === 'poll' ? 'Poll' : s === 'bracket' ? 'Bracket' : s === 'ratings' ? 'Ratings' : s === 'thismonth' ? '📅 This Month' : '🎬 Movie "Night"'}
            </button>
          ))}
        </div>

        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

        {section === 'movies' && (
          <>
            <div style={{fontFamily:"Calibri, Candara, 'Segoe UI', Optima, sans-serif", fontSize:'1.1rem', marginBottom:12, color:'var(--blue)'}}>Movie 1</div>
            <label className="form-label">Title</label>
            <MovieSearch value={movie1Title} onChange={setMovie1Title} placeholder="Search for a movie..."
              onSelect={d => { setMovie1Title(d.title); setMovie1Year(d.year); setMovie1Desc(d.description); setMovie1Poster(d.poster||''); setMovie1Stream(d.streaming.join(', ')); setMovie1TmdbId(d.tmdbId||null); setMovie1Trailer(d.trailerUrl||''); }} />
            <label className="form-label">Year</label>
            <input className="form-input" value={movie1Year} onChange={e=>setMovie1Year(e.target.value)} placeholder="1971" />
            <label className="form-label">Description</label>
            <textarea className="form-input" value={movie1Desc} onChange={e=>setMovie1Desc(e.target.value)} rows={3} placeholder="Short synopsis..." style={{resize:'vertical'}} />
            <label className="form-label">Where to Watch (comma separated)</label>
            <input className="form-input" value={movie1Stream} onChange={e=>setMovie1Stream(e.target.value)} placeholder="Max, Tubi, Netflix" />
            <label className="form-label">Poster URL (optional)</label>
            <input className="form-input" value={movie1Poster} onChange={e=>setMovie1Poster(e.target.value)} placeholder="https://..." />
            <label className="form-label">Rating Scale (e.g. Polaroids, Gold Stars, Screams)</label>
            <input className="form-input" value={movie1Scale} onChange={e=>setMovie1Scale(e.target.value)} placeholder="e.g. Polaroids, 1–5 Stars, Lighters..." />

            <hr className="section-divider" />

            <div style={{fontFamily:"Calibri, Candara, 'Segoe UI', Optima, sans-serif", fontSize:'1.1rem', marginBottom:12, color:'var(--orange)'}}>Movie 2</div>
            <label className="form-label">Title</label>
            <MovieSearch value={movie2Title} onChange={setMovie2Title} placeholder="Search for a movie..."
              onSelect={d => { setMovie2Title(d.title); setMovie2Year(d.year); setMovie2Desc(d.description); setMovie2Poster(d.poster||''); setMovie2Stream(d.streaming.join(', ')); setMovie2TmdbId(d.tmdbId||null); setMovie2Trailer(d.trailerUrl||''); }} />
            <label className="form-label">Year</label>
            <input className="form-input" value={movie2Year} onChange={e=>setMovie2Year(e.target.value)} placeholder="1964" />
            <label className="form-label">Description</label>
            <textarea className="form-input" value={movie2Desc} onChange={e=>setMovie2Desc(e.target.value)} rows={3} placeholder="Short synopsis..." style={{resize:'vertical'}} />
            <label className="form-label">Where to Watch (comma separated)</label>
            <input className="form-input" value={movie2Stream} onChange={e=>setMovie2Stream(e.target.value)} placeholder="Criterion Channel, Max" />
            <label className="form-label">Poster URL (optional)</label>
            <input className="form-input" value={movie2Poster} onChange={e=>setMovie2Poster(e.target.value)} placeholder="https://..." />
            <label className="form-label">Rating Scale (e.g. Polaroids, Gold Stars, Screams)</label>
            <input className="form-input" value={movie2Scale} onChange={e=>setMovie2Scale(e.target.value)} placeholder="e.g. Polaroids, 1–5 Stars, Lighters..." />

            <hr className="section-divider" />
            <div className="admin-section-title" style={{color:'var(--yellow)'}}>Session</div>
            <label className="form-label">Overarching Theme (applies to both films)</label>
            <input className="form-input" value={sessionThemeInput} onChange={e=>setSessionThemeInput(e.target.value)} placeholder="e.g. Oh the Horror, Dysfunctional Roadtrips..." />

            <button className="btn-primary" onClick={saveMovies}>💾 Save Movies</button>
            <button className="btn-secondary" onClick={archiveMovies}>📦 Archive to All Time List</button>
            <button className="btn-secondary" onClick={fetchMissingTrailers} disabled={fetchingTrailers} style={{marginTop:6}}>
              {fetchingTrailers ? '⏳ Fetching trailers…' : '🎬 Fetch Missing Trailers'}
            </button>
          </>
        )}

        {section === 'members' && (
          <>
            <div className="admin-section-title">Club Members</div>
            <div className="tag-list">
              {localMembers.map(m => (
                <div key={m} className="tag">
                  {m}
                  <button className="tag-remove" onClick={()=>removeMember(m)}>×</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              <input className="form-input" style={{marginBottom:0,flex:1}} value={newMember} onChange={e=>setNewMember(e.target.value)} placeholder="Add member name..." onKeyDown={e=>e.key==='Enter'&&addMember()} />
              <button onClick={addMember} style={{padding:'10px 16px',fontFamily:"'Permanent Marker',cursive",fontSize:'1.2rem',background:'var(--green)',color:'white',border:'3px solid var(--ink)',borderRadius:8,cursor:'pointer'}}>+</button>
            </div>
            <button className="btn-primary" onClick={saveMembers}>💾 Save Members</button>
          </>
        )}

        {section === 'ratings' && (
          <>
            <div className="admin-section-title">Edit a Rating</div>
            <div style={{fontFamily:"'Special Elite',monospace",fontSize:'0.8rem',color:'var(--text-on-dark)',marginBottom:14}}>
              Fix a mistake or add a missing score. Works for current and past movies.
            </div>

            <label className="form-label">Movie</label>
            <select className="form-input" value={editMovieId} onChange={e => setEditMovieId(e.target.value)} style={{marginBottom:12}}>
              <option value="">— Select movie —</option>
              {movies.length > 0 && (
                <optgroup label="This month">
                  {movies.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                </optgroup>
              )}
              {alltime.length > 0 && (
                <optgroup label="Past films (archived)">
                  {[...alltime].sort((a,b) => a.id - b.id).map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </optgroup>
              )}
            </select>

            <label className="form-label">Member</label>
            <select className="form-input" value={editMember} onChange={e => setEditMember(e.target.value)} style={{marginBottom:12}}>
              <option value="">— Select member —</option>
              {members.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {editMovieId && editMember && ratings[parseInt(editMovieId)]?.[editMember] !== undefined && (
              <div style={{fontFamily:"'Special Elite',monospace",fontSize:'0.8rem',color:'#aaa',marginBottom:8}}>
                Current score: <strong style={{color:'var(--yellow)'}}>{ratings[parseInt(editMovieId)][editMember]}</strong>
              </div>
            )}

            <label className="form-label">New Score (e.g. 4.5)</label>
            <input className="form-input" type="number" min="0" max="10" step="0.25"
              value={editScore} onChange={e => setEditScore(e.target.value)}
              placeholder="e.g. 4.5" style={{marginBottom:14}} />

            <button className="btn-primary" style={{background:'var(--blue)'}} onClick={saveEditedRating}>
              ✏️ Save Rating
            </button>
          </>
        )}

        {section === 'poll' && (
          <>
            <div className="admin-section-title">Create Poll</div>
            <label className="form-label">Poll Question</label>
            <input className="form-input" value={pollQuestion} onChange={e=>setPollQuestion(e.target.value)}
              placeholder="e.g. Who's your favourite Spielberg villain?"
              onKeyDown={e=>e.key==='Enter'&&adminCreatePoll()} />
            <button className="btn-primary" disabled={!pollQuestion.trim()} onClick={adminCreatePoll}>
              Create Poll
            </button>

            {activePollAdmin && (
              <>
                <hr className="section-divider" />
                <div className="admin-section-title">Active Poll</div>
                <div style={{fontWeight:600,marginBottom:6,fontSize:'0.95rem'}}>{activePollAdmin.question}</div>
                <div style={{fontSize:'0.82rem',color:'#7a6e58',marginBottom:12}}>
                  {(activePollAdmin.votes||[]).length} vote{(activePollAdmin.votes||[]).length!==1?'s':''}
                  {' · '}{(activePollAdmin.options||[]).length} option{(activePollAdmin.options||[]).length!==1?'s':''}
                </div>
                <button className="btn-primary" style={{background:'var(--red)',marginBottom:8}} onClick={adminClosePoll}>
                  Close Poll
                </button>
                <button className="btn-secondary" onClick={()=>adminDeletePoll(activePollAdmin.id)}>
                  Delete Poll
                </button>
              </>
            )}

            {(polls||[]).filter(p=>!p.is_active).length > 0 && (
              <>
                <hr className="section-divider" />
                <div className="admin-section-title">Past Polls</div>
                {(polls||[]).filter(p=>!p.is_active).map(poll => (
                  <div key={poll.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px dashed var(--cream)'}}>
                    <div>
                      <div style={{fontSize:'0.88rem',fontWeight:600}}>{poll.question}</div>
                      <div style={{fontSize:'0.72rem',color:'#aaa'}}>{(poll.votes||[]).length} vote{(poll.votes||[]).length!==1?'s':''}</div>
                    </div>
                    <button onClick={()=>adminDeletePoll(poll.id)}
                      style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:'0.82rem',fontWeight:600,padding:'4px 8px'}}>
                      Delete
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {section === 'bracket' && (
          <>
            <div className="admin-section-title">Bracket</div>
            {(!bracket || !bracket.rounds) ? (
              <>
                {!showAdminBracketSetup ? (
                  <button className="btn-primary" onClick={() => setShowAdminBracketSetup(true)}>
                    🏆 Create New Bracket
                  </button>
                ) : (
                  <BracketSetupForm
                    onDone={async (matchups) => {
                      const newBracket = { rounds: [matchups], currentRound: 0, finished: false, winner: null };
                      try {
                        await dbSaveBracket(newBracket);
                        setBracket(newBracket);
                        setShowAdminBracketSetup(false);
                        showMsg('Bracket created!');
                      } catch(e) { showMsg('Error: ' + e.message, 'error'); }
                    }}
                    onCancel={() => setShowAdminBracketSetup(false)}
                  />
                )}
              </>
            ) : (
              <>
                <div style={{fontFamily:"'Special Elite',monospace",fontSize:'0.85rem',color:'#666',marginBottom:12}}>
                  Round {(bracket.currentRound||0)+1} of {bracket.rounds.length} · {bracket.finished ? '✅ Finished' : '🔴 Active'}
                  {bracket.winner && ` · Winner: ${bracket.winner}`}
                </div>
                {!bracket.finished && (
                  <button className="btn-primary" style={{background:'var(--blue)'}} onClick={advanceBracket}>
                    ➡️ Advance to Next Round
                  </button>
                )}
                {!bracket.finished && bracket.currentRound === 0 && (
                  <>
                    <button className="btn-secondary" style={{marginTop:8}} onClick={() => {
                      setRound1Edits(bracket.rounds[0].map(m => ({ a: m.a, b: m.b })));
                      setEditingRound1(v => !v);
                    }}>
                      ✏️ {editingRound1 ? 'Cancel Edit' : 'Edit Movies'}
                    </button>
                    {editingRound1 && (
                      <div style={{marginTop:10,background:'#fafaf8',border:'1px solid var(--cream)',borderRadius:8,padding:12}}>
                        {round1Edits.map((edit, i) => (
                          <div key={i} style={{display:'flex',gap:6,alignItems:'center',marginBottom:8}}>
                            <input className="form-input" style={{flex:1,padding:'4px 8px',fontSize:'0.85rem'}}
                              value={edit.a}
                              onChange={e => setRound1Edits(prev => prev.map((x,j) => j===i ? {...x, a: e.target.value} : x))} />
                            <span style={{fontSize:'0.75rem',color:'#aaa',flexShrink:0}}>vs</span>
                            {edit.b === 'BYE'
                              ? <span style={{flex:1,fontSize:'0.8rem',color:'#aaa',padding:'4px 8px'}}>BYE</span>
                              : <input className="form-input" style={{flex:1,padding:'4px 8px',fontSize:'0.85rem'}}
                                  value={edit.b}
                                  onChange={e => setRound1Edits(prev => prev.map((x,j) => j===i ? {...x, b: e.target.value} : x))} />
                            }
                          </div>
                        ))}
                        <button className="btn-primary" style={{width:'100%',marginTop:4}} onClick={saveRound1Edits}>
                          Save Changes
                        </button>
                      </div>
                    )}
                    <button className="btn-secondary" style={{marginTop:8}} onClick={() => {
                      if (!window.confirm('Shuffle all matchups? This will clear any existing votes.')) return;
                      shuffleRound1();
                    }}>
                      🔀 Shuffle Matchups
                    </button>
                  </>
                )}
                <button className="btn-secondary" style={{marginTop:8}} onClick={async () => {
                  if (!window.confirm('Delete this bracket and start over?')) return;
                  await dbSaveBracket(null);
                  setBracket(null);
                  showMsg('Bracket deleted');
                }}>
                  🗑️ Delete Bracket
                </button>
              </>
            )}
          </>
        )}

        {section === 'movienight' && (
          <>
            <div className="admin-section-title">Movie "Night" Schedule</div>
            <div style={{fontSize:'0.88rem',color:'#7a6e58',marginBottom:14,lineHeight:1.5}}>
              Auto-schedule: <strong>4th Friday of each month, 9 AM PST</strong><br/>
              {mnCurrent
                ? <span>Override active: <strong>{new Date(mnCurrent).toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'})} PST</strong></span>
                : <span>No override set — using automatic schedule.</span>
              }
            </div>

            <label className="form-label">Override date &amp; time (local datetime)</label>
            <input className="form-input" type="datetime-local" value={mnOverride}
              onChange={e => setMnOverride(e.target.value)} style={{marginBottom:8}} />
            <div style={{fontSize:'0.75rem',color:'#aaa',marginBottom:14}}>
              Enter the date/time in your local timezone. Members will see this as the next movie night.
            </div>
            <button className="btn-primary" disabled={!mnOverride || mnLoading} onClick={async () => {
              setMnLoading(true);
              await dbSaveOverride(new Date(mnOverride).toISOString());
              setMnCurrent(new Date(mnOverride).toISOString());
              setMnOverride('');
              setMnLoading(false);
              showMsg('Movie night date updated!');
            }}>
              {mnLoading ? 'Saving…' : 'Save Override'}
            </button>

            {mnCurrent && (
              <>
                <hr className="section-divider" />
                <div className="admin-section-title">Clear Override</div>
                <div style={{fontSize:'0.85rem',color:'#7a6e58',marginBottom:12}}>
                  Removes the override and reverts to the automatic 4th-Sunday schedule.
                </div>
                <button className="btn-secondary" onClick={async () => {
                  await dbClearOverride();
                  setMnCurrent(null);
                  showMsg('Override cleared — back to auto schedule.');
                }}>
                  Clear Override
                </button>
              </>
            )}

            <hr className="section-divider" />
            <div className="admin-section-title">Join Link</div>
            <div style={{fontSize:'0.85rem',color:'#7a6e58',marginBottom:12}}>
              Shown as a "Join" button on event day. Leave blank to hide it.
              {mnJoinCurrent && <><br/><strong>Current:</strong> {mnJoinCurrent}</>}
            </div>
            <label className="form-label">Google Meet / Zoom URL</label>
            <input className="form-input" type="url" value={mnJoinUrl}
              onChange={e => setMnJoinUrl(e.target.value)}
              placeholder="https://meet.google.com/..." />
            <button className="btn-primary" disabled={mnLoading} onClick={async () => {
              setMnLoading(true);
              await dbSaveJoinUrl(mnJoinUrl);
              setMnJoinCurrent(mnJoinUrl);
              setMnLoading(false);
              showMsg('Join link saved!');
            }}>
              {mnLoading ? 'Saving…' : 'Save Join Link'}
            </button>
          </>
        )}

        {section === 'thismonth' && (
          <>
            <div className="admin-section-title">This Month's Movies</div>

            {!tmmLoaded ? (
              <div style={{textAlign:'center',padding:'20px 0',color:'#aaa'}}>Loading…</div>
            ) : (
              <>
                <label className="form-label">Event</label>
                <select className="form-input" value={tmmSelectedId} onChange={e => handleTmmSelect(e.target.value)} style={{marginBottom:14}}>
                  <option value="new">＋ New event</option>
                  {tmmEvents.map(ev => {
                    const label = ev.month
                      ? new Date(ev.month + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                      : `Event #${ev.id}`;
                    return (
                      <option key={ev.id} value={String(ev.id)}>
                        {label}{ev.theme ? ` — ${ev.theme}` : ''}{ev.is_current ? ' ✓' : ''}
                      </option>
                    );
                  })}
                </select>

                <label className="form-label">Month (first day of the club month)</label>
                <input className="form-input" type="date" value={tmmMonth}
                  onChange={e => setTmmMonth(e.target.value)} style={{marginBottom:14}} />

                <label className="form-label">Theme</label>
                <input className="form-input" value={tmmTheme}
                  onChange={e => setTmmTheme(e.target.value)}
                  placeholder="e.g. Difficult Moms, Heist Films…" style={{marginBottom:14}} />

                <hr className="section-divider" />

                {(() => {
                  const seen = new Set();
                  const allMoviesForPicker = [...(movies || []), ...(alltime || [])]
                    .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
                    .sort((a, b) => a.title.localeCompare(b.title));
                  function pickMovie(idStr, setId, setSearch) {
                    const id = idStr ? parseInt(idStr) : null;
                    setId(id);
                    const m = allMoviesForPicker.find(x => x.id === id);
                    setSearch(m ? m.title : '');
                  }
                  return (
                    <>
                      <div style={{fontFamily:"Calibri, Candara, 'Segoe UI', Optima, sans-serif", fontSize:'1rem', marginBottom:10, color:'var(--blue)'}}>Movie 1</div>
                      <label className="form-label">Select movie</label>
                      <select className="form-input" value={tmmMovie1Id || ''} onChange={e => pickMovie(e.target.value, setTmmMovie1Id, setTmmMovie1Search)} style={{marginBottom:14}}>
                        <option value="">— None —</option>
                        {allMoviesForPicker.map(m => <option key={m.id} value={m.id}>{m.title}{m.year ? ` (${m.year})` : ''}</option>)}
                      </select>

                      <div style={{fontFamily:"Calibri, Candara, 'Segoe UI', Optima, sans-serif", fontSize:'1rem', marginBottom:10, color:'var(--orange)'}}>Movie 2</div>
                      <label className="form-label">Select movie</label>
                      <select className="form-input" value={tmmMovie2Id || ''} onChange={e => pickMovie(e.target.value, setTmmMovie2Id, setTmmMovie2Search)} style={{marginBottom:14}}>
                        <option value="">— None —</option>
                        {allMoviesForPicker.map(m => <option key={m.id} value={m.id}>{m.title}{m.year ? ` (${m.year})` : ''}</option>)}
                      </select>
                    </>
                  );
                })()}

                <hr className="section-divider" />

                <label className="form-label">Meeting Date &amp; Time</label>
                <input className="form-input" type="datetime-local" value={tmmMeetingDatetime}
                  onChange={e => setTmmMeetingDatetime(e.target.value)} style={{marginBottom:14}} />

                <label className="form-label">Meeting Link (Google Meet, etc.)</label>
                <input className="form-input" value={tmmMeetingLink}
                  onChange={e => setTmmMeetingLink(e.target.value)}
                  placeholder="https://meet.google.com/…" style={{marginBottom:14}} />

                <label className="form-label">Trivia (freeform)</label>
                <textarea className="form-input" value={tmmTrivia}
                  onChange={e => setTmmTrivia(e.target.value)}
                  rows={4} placeholder="Fun facts, discussion prompts…"
                  style={{resize:'vertical', marginBottom:14}} />

                <button className="btn-primary" onClick={saveTmmEvent}>💾 Save Event</button>
                {tmmSelectedId !== 'new' && (
                  <>
                    <button className="btn-primary" style={{background:'var(--green)',marginTop:6}} onClick={setTmmCurrent}>
                      ✓ Set as Current Month
                    </button>
                    <button className="btn-secondary" style={{marginTop:6}} onClick={() => {
                      if (!window.confirm('Delete this event?')) return;
                      deleteTmmEvent();
                    }}>
                      🗑️ Delete Event
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin, onClose }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');

  function attempt() {
    if (user === 'foif' && pass === 'Moomoo92') {
      onLogin();
    } else {
      setErr('Wrong username or password.');
    }
  }

  return (
    <div className="login-wrap" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="login-card">
        <button className="login-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
        <div className="login-title">🎬 Admin</div>
        <div className="login-sub">Movie Club command center</div>
        {err && <div className="error-msg">{err}</div>}
        <label className="form-label">Username</label>
        <input className="form-input" value={user} onChange={e=>setUser(e.target.value)} autoComplete="username" />
        <label className="form-label">Password</label>
        <input className="form-input" type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&attempt()} autoComplete="current-password" />
        <button className="btn-primary" onClick={attempt}>Enter →</button>
      </div>
    </div>
  );
}
