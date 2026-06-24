// ─── ACTING AS ───────────────────────────────────────────────────────────────
// Defined early because many components below reference <ActingAs />.
function ActingAs() {
  const { currentUser, openUserPicker } = React.useContext(UserContext);
  const display = currentUser?.name || 'Anonymous';
  return (
    <div className="acting-as">
      Acting as <strong>{display}</strong>.{' '}
      <button className="acting-as-change" onClick={openUserPicker}>change</button>
    </div>
  );
}

// ─── USER PICKER MODAL ───────────────────────────────────────────────────────
function UserPickerModal({ memberObjects, canDismiss, onClose }) {
  const { setCurrentUser } = React.useContext(UserContext);

  function select(userObj) {
    writeUserCookie(userObj);
    setCurrentUser(userObj);
    onClose();
  }

  return (
    <div className="confirm-overlay"
      onClick={e => { if (canDismiss && e.target === e.currentTarget) onClose(); }}>
      <div className="user-picker-card">
        <div className="user-picker-title">Who are you?</div>
        <div className="user-picker-subtitle">Pick your name — your choice carries across every page and reload.</div>
        <div className="user-picker-grid">
          {(memberObjects || []).map(u => (
            <button key={u.id} className="voter-btn" onClick={() => select(u)}>{u.name}</button>
          ))}
          <button className="voter-btn" style={{fontStyle:'italic',opacity:0.75}}
            onClick={() => select({ id: null, name: 'Anonymous' })}>
            A girl has no name
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MOVIE NIGHT COUNTDOWN ───────────────────────────────────────────────────
function getNearbyHoliday(date) {
  var y = date.getFullYear();
  var DAYS = 7;
  var near = function(h) { return Math.abs(date - h) / 864e5 <= DAYS; };
  var nthWeekday = function(yr, mo, wday, n) {
    var d = new Date(yr, mo, 1);
    var first = (wday - d.getDay() + 7) % 7;
    return new Date(yr, mo, 1 + first + (n - 1) * 7);
  };
  var lastMonday = function(yr, mo) {
    var last = new Date(yr, mo + 1, 0);
    return new Date(yr, mo, last.getDate() - (last.getDay() === 0 ? 6 : last.getDay() - 1));
  };

  var fixed = [
    [0,  1,  "New Year's Day",    "🎉"],
    [1,  14, "Valentine's Day",   "❤️"],
    [2,  17, "St. Patrick's Day", "☘️"],
    [6,  4,  "Independence Day",  "🎆"],
    [9,  31, "Halloween",         "🎃"],
    [11, 25, "Christmas",         "🎄"],
    [11, 31, "New Year's Eve",    "🥂"],
  ];
  for (var i = 0; i < fixed.length; i++) {
    if (near(new Date(y, fixed[i][0], fixed[i][1]))) return fixed[i][3] + ' Near ' + fixed[i][2];
  }
  if (near(nthWeekday(y, 4, 0, 2)))  return "💐 Near Mother's Day";    // 2nd Sun of May
  if (near(nthWeekday(y, 5, 0, 3)))  return "👨‍👧 Near Father's Day";   // 3rd Sun of Jun
  if (near(nthWeekday(y, 10, 4, 4))) return "🦃 Near Thanksgiving";    // 4th Thu of Nov
  if (near(lastMonday(y, 4)))         return "🎖️ Near Memorial Day";    // last Mon of May
  if (near(nthWeekday(y, 8, 1, 1)))  return "🌿 Near Labor Day";       // 1st Mon of Sep
  return null;
}

function MovieNightCountdown() {
  const [override, setOverride] = useState(null);
  const [tick,     setTick]     = useState(0);
  const [joinUrl,  setJoinUrl]  = useState('');

  const eventDate   = getNextMovieNight(override);
  const cd          = calcCountdown(eventDate);

  useEffect(() => {
    (async () => {
      const [ov, url] = await Promise.all([dbLoadOverride(), dbLoadJoinUrl()]);
      setOverride(ov);
      setJoinUrl(url || '');
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const pad = n => String(n).padStart(2, '0');

  return (
    <div className="mn-card">
      <div className="mn-eyebrow">🎬 Next Movie "Night"</div>
      <div className="mn-date">{fmtEventDate(eventDate)}</div>

      {cd.done ? (
        <div className="mn-happening">It's happening — enjoy! 🍿</div>
      ) : (
        <div className="mn-countdown">
          <div className="mn-unit"><span className="mn-val">{cd.days}</span><span className="mn-lbl">days</span></div>
          <span className="mn-sep">:</span>
          <div className="mn-unit"><span className="mn-val">{pad(cd.hours)}</span><span className="mn-lbl">hrs</span></div>
          <span className="mn-sep">:</span>
          <div className="mn-unit"><span className="mn-val">{pad(cd.minutes)}</span><span className="mn-lbl">min</span></div>
        </div>
      )}

      {(cd.days === 0 || cd.done) && joinUrl && (
        <a className="mn-join-btn" href={joinUrl} target="_blank" rel="noopener noreferrer">
          🎬 Join Movie "Night"
        </a>
      )}
    </div>
  );
}

// ─── HOME RATING AREA ────────────────────────────────────────────────────────
function HomeRatingArea({ movieId, movieRatings, onSave }) {
  const { currentUser } = React.useContext(UserContext);
  const member = currentUser?.id ? currentUser.name : '';
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const scoreValid = score !== '' && !isNaN(parseFloat(score)) && parseFloat(score) >= 0 && parseFloat(score) <= 10;

  async function handleSave() {
    if (!member || !scoreValid) return;
    setSaving(true);
    await onSave(member, parseFloat(score));
    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); setScore(''); }, 1500);
  }

  return (
    <div className="home-rating-box">
      {saved && (
        <div style={{fontSize:'0.85rem',color:'var(--green)',marginBottom:8}}>✓ Rating saved!</div>
      )}
      {!open && !saved && (
        <button className="home-add-btn" onClick={() => setOpen(true)}>+ Add Rating</button>
      )}
      {open && !saved && (
        <>
          <ActingAs />
          <div className="home-rating-form">
            <input
              type="number" className="form-select"
              style={{width:'68px'}}
              min="0" max="5" step="0.25"
              value={score} onChange={e => setScore(e.target.value)}
              placeholder="0–5"
            />
            <button className="home-save-btn" onClick={handleSave} disabled={saving || !member || !scoreValid}>
              {saving ? '...' : 'Save'}
            </button>
            <button className="home-cancel-btn" onClick={() => { setOpen(false); setScore(''); }}>✕</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── MOVIE CARD ──────────────────────────────────────────────────────────────
function TrailerModal({ url, title, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="trailer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="trailer-modal">
        <button className="trailer-close-btn" onClick={onClose} aria-label="Close trailer">✕</button>
        <iframe
          src={url}
          title={title ? `${title} — Trailer` : 'Trailer'}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function TrailerButton({ trailerUrl, title, color }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <TrailerModal url={trailerUrl} title={title} onClose={() => setOpen(false)} />}
      <button
        className="watch-trailer-btn"
        style={{ color: color || 'var(--blue-mid)' }}
        onClick={e => { e.stopPropagation(); setOpen(true); }}>
        ▶ Trailer
      </button>
    </>
  );
}

function MovieCard({ movie, index, movieRatings, members, onRate }) {
  const accent = movie.accent || ACCENT_COLORS[index % ACCENT_COLORS.length];
  const [showTrailer, setShowTrailer] = useState(false);
  return (
    <div className="movie-card">
      {showTrailer && <TrailerModal url={movie.trailerUrl} title={movie.title} onClose={() => setShowTrailer(false)} />}
      <div className="movie-card-accent" style={{color: accent}}>
        <span className="now-showing-bar" style={{background: accent}} />
        <span className="now-showing-text">Now Showing</span>
        <span className="now-showing-bar" style={{background: accent}} />
      </div>
      <div className="poster-frame">
        <span className="frame-corner fc-tl" />
        <span className="frame-corner fc-tr" />
        <span className="frame-corner fc-bl" />
        <span className="frame-corner fc-br" />
        <div className="movie-poster-wrap">
          {movie.poster
            ? <img src={movie.poster} alt={movie.title} />
            : <div className="poster-placeholder">🎬</div>
          }
          <div className="movie-number">{index + 1}</div>
        </div>
      </div>
      <div className="movie-info">
        <div className="movie-title">{movie.title}</div>
        {movie.year && <div className="movie-year">{movie.year}</div>}
        {movie.description && <div className="movie-desc">{movie.description}</div>}
        {movie.streaming && movie.streaming.length > 0 && (
          <>
            <div className="where-label">Where to watch</div>
            <div className="streaming-chips">
              {movie.streaming.map((s,i) => (
                <span key={i} className="chip" style={{background: accent + '22', borderColor: accent}}>{s}</span>
              ))}
            </div>
          </>
        )}
      </div>
      {movie.trailerUrl && (
        <div style={{padding:'0 16px 14px'}}>
          <button className="watch-trailer-btn" style={{color: accent}} onClick={() => setShowTrailer(true)}>
            ▶ Watch Trailer
          </button>
        </div>
      )}
      {onRate && (
        <HomeRatingArea
          movieId={movie.id}
          movieRatings={movieRatings || {}}
          onSave={onRate}
        />
      )}
    </div>
  );
}

// ─── TRIVIA BANNER ───────────────────────────────────────────────────────────
function TriviaOfTheWeek() {
  const { movie, fact } = getTriviaOfTheWeek();
  return (
    <div className="trivia-banner">
      <div className="trivia-label">📽 Trivia of the Week</div>
      <div className="trivia-movie">{movie}</div>
      <div className="trivia-fact">{fact}</div>
    </div>
  );
}

// ─── MOVIE SEARCH ────────────────────────────────────────────────────────────
function MovieSearch({ value, onChange, onSelect, placeholder }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const timer = useRef(null);
  const queryRef = useRef(value);

  useEffect(() => { queryRef.current = value; }, [value]);

  async function fetchResults(query, yr, pg, append) {
    if (query.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=en-US&page=${pg}`;
      if (yr && /^\d{4}$/.test(yr.trim())) url += `&year=${yr.trim()}`;
      const res = await fetch(url);
      const data = await res.json();
      const items = (data.results || []);
      setHasMore((data.total_pages || 0) > pg);
      setResults(prev => append ? [...prev, ...items] : items.slice(0, 10));
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  function handleInput(e) {
    const q = e.target.value;
    onChange(q);
    queryRef.current = q;
    setPage(1);
    clearTimeout(timer.current);
    if (q.length < 2) { setResults([]); setHasMore(false); return; }
    timer.current = setTimeout(() => fetchResults(q, year, 1, false), 400);
  }

  function handleYearChange(e) {
    const yr = e.target.value;
    setYear(yr);
    setPage(1);
    clearTimeout(timer.current);
    if (queryRef.current.length >= 2) {
      timer.current = setTimeout(() => fetchResults(queryRef.current, yr, 1, false), 400);
    }
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    fetchResults(queryRef.current, year, next, true);
  }

  async function selectMovie(movie) {
    setResults([]); setHasMore(false);
    onChange(movie.title);
    setLoading(true);
    try {
      const [provRes, trailerUrl] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/movie/${movie.id}/watch/providers?api_key=${TMDB_KEY}`),
        fetchTrailerUrl(movie.id),
      ]);
      const provData = await provRes.json();
      const flatrate = provData.results?.US?.flatrate || [];
      const streaming = flatrate.map(p => p.provider_name);
      const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null;
      const yr = movie.release_date ? movie.release_date.split('-')[0] : '';
      onSelect({ title: movie.title, year: yr, description: movie.overview || '', poster, streaming, tmdbId: movie.id, trailerUrl });
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  return (
    <div style={{position:'relative', marginBottom:14}}>
      <input className="form-input" style={{marginBottom:6}} value={value}
        onChange={handleInput} placeholder={placeholder || 'Search for a movie...'} />
      <input className="form-input" style={{marginBottom:0, fontSize:'0.88rem', padding:'6px 10px'}}
        value={year} onChange={handleYearChange} placeholder="Year (optional — helps narrow it down, e.g. 2010)" />
      {loading && (
        <div style={{padding:'6px 12px', fontSize:'0.8rem', color:'#999'}}>Searching...</div>
      )}
      {results.length > 0 && (
        <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'2px solid var(--ink)',borderTop:'none',borderRadius:'0 0 8px 8px',zIndex:300,boxShadow:'3px 3px 0 var(--ink)',maxHeight:420,overflowY:'auto'}}>
          {results.map(movie => (
            <div key={movie.id} onClick={() => selectMovie(movie)}
              style={{padding:'9px 12px',cursor:'pointer',borderBottom:'1px solid var(--cream)',display:'flex',alignItems:'center',gap:10}}
              onMouseEnter={e => e.currentTarget.style.background='var(--cream)'}
              onMouseLeave={e => e.currentTarget.style.background='white'}>
              {movie.poster_path
                ? <img src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`} style={{width:30,height:45,objectFit:'cover',borderRadius:3,flexShrink:0}} alt="" />
                : <div style={{width:30,height:45,background:'var(--cream)',borderRadius:3,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1rem'}}>🎬</div>
              }
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:'0.95rem',lineHeight:1.2}}>{movie.title}</div>
                {movie.release_date && <div style={{fontSize:'0.75rem',color:'#888'}}>{movie.release_date.split('-')[0]}</div>}
                {movie.overview && (
                  <div style={{fontSize:'0.72rem',color:'#aaa',marginTop:2,lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
                    {movie.overview}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div style={{padding:'8px 12px',textAlign:'center',borderTop:'1px solid var(--cream)'}}>
            {hasMore ? (
              <button onClick={loadMore} disabled={loading}
                style={{fontSize:'0.82rem',fontWeight:600,color:'var(--blue-mid)',background:'none',border:'none',cursor:'pointer',padding:'2px 0'}}>
                {loading ? 'Loading…' : '↓ Show more results'}
              </button>
            ) : (
              <span style={{fontSize:'0.75rem',color:'#ccc'}}>
                {results.length} result{results.length !== 1 ? 's' : ''} · try adding a year to narrow it down
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADD HISTORY MOVIE FORM ───────────────────────────────────────────────────
function AddHistoryMovieForm({ onAdd, onCancel }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [movieType, setMovieType] = useState('impromptu');
  const [sessionTheme, setSessionTheme] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit() {
    if (!selected) { setErr('Search for and select a movie first.'); return; }
    setSaving(true); setErr('');
    try {
      const row = await dbAddHistoryMovie({
        title: selected.title, year: selected.year,
        description: selected.description, poster: selected.poster,
        movieType, sessionTheme: movieType === 'official' ? sessionTheme : '',
        tmdbId: selected.tmdbId || null,
        trailerUrl: selected.trailerUrl || null,
      });
      onAdd({
        id: row.id, title: row.title, year: row.year,
        ratingScale: '', avgScore: null, poster: row.poster || null,
        theme: '', month: row.shownMonth || '',
        sessionTheme: movieType === 'official' ? sessionTheme : '', movieType,
        tmdbId: row.tmdb_id || null,
        trailerUrl: row.trailer_url || null,
      });
    } catch(e) { setErr('Failed to add: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="add-history-form">
      <div className="add-history-form-title">Add a Movie to History</div>
      <label className="form-label" style={{color:'var(--ink)'}}>Search</label>
      <MovieSearch value={search} onChange={setSearch}
        onSelect={d => { setSelected(d); setSearch(d.title); }}
        placeholder="Search TMDB..." />
      {selected && (
        <div className="add-movie-preview">
          {selected.poster
            ? <img src={selected.poster} className="mini-poster" alt="" />
            : <div className="mini-poster-placeholder">🎬</div>
          }
          <div>
            <div style={{fontWeight:700,fontSize:'0.95rem'}}>{selected.title}</div>
            {selected.year && <div style={{fontSize:'0.78rem',color:'#888'}}>{selected.year}</div>}
          </div>
        </div>
      )}
      <label className="form-label" style={{color:'var(--ink)',marginTop:8}}>Type</label>
      <div className="type-picker">
        <button className={`type-btn ${movieType==='official'?'type-official-active':''}`}
          onClick={() => setMovieType('official')}>🔵 Official</button>
        <button className={`type-btn ${movieType==='impromptu'?'type-impromptu-active':''}`}
          onClick={() => setMovieType('impromptu')}>🟡 Impromptu</button>
      </div>
      {movieType === 'official' && (
        <>
          <label className="form-label" style={{color:'var(--ink)',marginTop:10}}>Session Theme (optional)</label>
          <input className="form-input" style={{marginBottom:0,fontSize:'0.95rem',padding:'8px 10px'}}
            value={sessionTheme} onChange={e => setSessionTheme(e.target.value)}
            placeholder="e.g. Difficult Moms, Heist, Gaslighting…" />
        </>
      )}
      {err && <div style={{color:'var(--red)',fontSize:'0.8rem',marginTop:8}}>{err}</div>}
      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button className="home-save-btn" onClick={handleSubmit}
          disabled={!selected || saving} style={{flex:1,padding:'8px'}}>
          {saving ? '...' : '+ Add to History'}
        </button>
        <button className="home-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── EDIT HISTORY MOVIE FORM ─────────────────────────────────────────────────
function EditHistoryMovieForm({ movie, onSave, onCancel }) {
  const [search, setSearch] = useState(movie.title || '');
  const [poster, setPoster] = useState(movie.poster || '');
  const [title, setTitle] = useState(movie.title || '');
  const [year, setYear] = useState(movie.year || '');
  const [ratingScale, setRatingScale] = useState(movie.ratingScale || movie.theme || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await dbUpdateHistoryMovie(movie.id, { poster: poster || null, title, year: year || null, rating_scale: ratingScale || null });
      onSave({ poster: poster || null, title, year: year || null, ratingScale: ratingScale || '', theme: ratingScale || '' });
    } catch(e) { setErr('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="add-history-form">
      <div className="add-history-form-title">Edit — {movie.title}</div>
      <label className="form-label" style={{color:'var(--ink)'}}>Search TMDB for correct poster</label>
      <MovieSearch value={search} onChange={setSearch}
        onSelect={d => {
          setSearch(d.title);
          setTitle(d.title);
          if (d.year) setYear(d.year);
          if (d.poster) setPoster(d.poster);
        }}
        placeholder="Search for the movie..." />
      <label className="form-label" style={{color:'var(--ink)', marginTop:6}}>Poster URL</label>
      <input className="form-input" value={poster} onChange={e => setPoster(e.target.value)}
        placeholder="https://image.tmdb.org/t/p/w500/..." style={{marginBottom:8}} />
      {poster && (
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <img src={poster} className="mini-poster" alt="" style={{flexShrink:0}} />
          <span style={{fontSize:'0.75rem',color:'#888',wordBreak:'break-all'}}>{title} {year && `(${year})`}</span>
        </div>
      )}
      <label className="form-label" style={{color:'var(--ink)', marginTop:6}}>Theme label (e.g. "Eddie", "Pimp Suits")</label>
      <input className="form-input" value={ratingScale} onChange={e => setRatingScale(e.target.value)}
        placeholder="Optional theme label..." style={{marginBottom:8}} />
      {err && <div style={{color:'var(--red)',fontSize:'0.8rem',marginBottom:8}}>{err}</div>}
      <div style={{display:'flex',gap:8}}>
        <button className="home-save-btn" onClick={handleSave} disabled={saving} style={{flex:1,padding:'8px'}}>
          {saving ? '...' : 'Save Changes'}
        </button>
        <button className="home-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── WATCHLIST ADD FORM ───────────────────────────────────────────────────────
function WatchListAddForm({ memberName, onAdd, onCancel }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [urgency, setUrgency] = useState('want');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleAdd() {
    if (!selected) { setErr('Search for and select a movie first.'); return; }
    setSaving(true); setErr('');
    try {
      const item = await dbAddToWatchlist({ memberName, title: selected.title, year: selected.year, poster: selected.poster, urgency });
      onAdd(item);
    } catch(e) { setErr('Failed to add: ' + e.message); setSaving(false); }
  }

  return (
    <div className="wl-add-form">
      <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:12,color:'var(--ink)'}}>Add to Watch List</div>
      <MovieSearch value={search} onChange={setSearch}
        onSelect={d => { setSelected(d); setSearch(d.title); }}
        placeholder="Search for a movie..." />
      {selected && (
        <>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            {selected.poster
              ? <img src={selected.poster} className="mini-poster" alt="" />
              : <div className="mini-poster-placeholder">🎬</div>}
            <div>
              <div style={{fontWeight:700,fontSize:'0.95rem'}}>{selected.title}</div>
              {selected.year && <div style={{fontSize:'0.78rem',color:'#888'}}>{selected.year}</div>}
            </div>
          </div>
          <label className="form-label">How much do you want to watch this?</label>
          <div className="wl-urgency-picker">
            <button className={`wl-urgency-opt ${urgency==='want'?'wl-urgency-want-active':''}`}
              onClick={() => setUrgency('want')}>Want to watch</button>
            <button className={`wl-urgency-opt ${urgency==='really'?'wl-urgency-really-active':''}`}
              onClick={() => setUrgency('really')}>🔥 REALLY want</button>
          </div>
        </>
      )}
      {err && <div style={{color:'var(--red)',fontSize:'0.8rem',marginTop:8}}>{err}</div>}
      <div style={{display:'flex',gap:8,marginTop:14}}>
        <button className="home-save-btn" onClick={handleAdd} disabled={!selected||saving} style={{flex:1,padding:'9px'}}>
          {saving ? '...' : '+ Add to List'}
        </button>
        <button className="home-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── WATCHED MODAL ────────────────────────────────────────────────────────────
function WatchedModal({ item, alltime, ratings, onClose }) {
  const { currentUser } = React.useContext(UserContext);
  const ratingMember = currentUser?.id ? currentUser.name : '';
  const existingMovie = (alltime || []).find(m => m.title.toLowerCase() === item.title.toLowerCase());
  const [ratingScore, setRatingScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState('');

  const scoreValid = ratingScore !== '' && !isNaN(parseFloat(ratingScore)) && parseFloat(ratingScore) >= 0 && parseFloat(ratingScore) <= 10;

  async function handleRateSave() {
    if (!ratingMember || !scoreValid || saving) return;
    setSaving(true);
    try {
      const sc = parseFloat(ratingScore);
      await dbSaveRating(existingMovie.id, ratingMember, sc);
      setDone(sc === 0 ? '✓ Rating deleted!' : '✓ Rating saved!');
      setTimeout(onClose, 1400);
    } catch(e) { console.error(e); }
    setSaving(false);
  }

  async function handleAddToHistory() {
    setSaving(true);
    try {
      await dbAddHistoryMovie({ title: item.title, year: item.year, poster: item.poster, movieType: 'impromptu' });
      setDone('✓ Added to group history!');
      setTimeout(onClose, 1400);
    } catch(e) { console.error(e); }
    setSaving(false);
  }

  return (
    <div className="confirm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="confirm-card" style={{maxWidth:360}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
          {item.poster
            ? <img src={item.poster} className="mini-poster" alt="" />
            : <div className="mini-poster-placeholder" style={{width:40,height:60,fontSize:'1.2rem'}}>🎬</div>}
          <div>
            <div style={{fontWeight:700,fontSize:'1rem',lineHeight:1.2,color:'var(--ink)'}}>{item.title}</div>
            {item.year && <div style={{fontSize:'0.75rem',color:'#888'}}>{item.year}</div>}
          </div>
        </div>

        {done
          ? <div className="alert alert-success" style={{marginBottom:0}}>{done}</div>
          : existingMovie ? (
            <>
              <div className="confirm-card-title">Record a rating?</div>
              <div className="confirm-card-body">This movie is already in the group's history. Want to add your rating?</div>
              <ActingAs />
              <input type="number" className="form-select" style={{width:'100%',marginBottom:14}} min="0" max="10" step="0.25"
                value={ratingScore} onChange={e => setRatingScore(e.target.value)} placeholder="Score (0–10)" />
              <div className="confirm-actions">
                <button className="confirm-cancel-btn" onClick={onClose}>Skip</button>
                <button className="confirm-delete-btn" style={{background:'var(--blue-mid)',borderColor:'var(--blue-mid)'}}
                  onClick={handleRateSave} disabled={!ratingMember||!scoreValid||saving}>
                  {saving ? '...' : 'Save Rating'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="confirm-card-title">Add to group ratings?</div>
              <div className="confirm-card-body">Add <strong>"{item.title}"</strong> to the group's history so everyone can rate it?</div>
              <div className="confirm-actions">
                <button className="confirm-cancel-btn" onClick={onClose}>Skip</button>
                <button className="confirm-delete-btn" style={{background:'var(--blue-mid)',borderColor:'var(--blue-mid)'}}
                  onClick={handleAddToHistory} disabled={saving}>
                  {saving ? '...' : 'Add to History'}
                </button>
              </div>
            </>
          )
        }
      </div>
    </div>
  );
}
