// ─── ROUTING ─────────────────────────────────────────────────────────────────
function pageFromPath() {
  const p = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (p === 'ratings' || p.startsWith('ratings/') || p === 'watchlist' || p.startsWith('watchlist/')) return 'ratings';
  if (p === 'poll' || p.startsWith('poll/')) return 'poll';
  if (p === 'bracket' || p.startsWith('bracket/')) return 'bracket';
  return 'home';
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function App() {
  const [page, _setPage] = useState(pageFromPath);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const [scrolled, setScrolled] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);
  const footerRef = useRef(null);

  const [movies, setMovies] = useState([]);
  const [ratings, setRatings] = useState({});
  const [bracket, setBracket] = useState(null);
  const [bracketHistory, setBracketHistory] = useState([]);
  const [bracketViewId, setBracketViewId] = useState(() => {
    const match = window.location.pathname.match(/^\/bracket\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  });
  const [members, setMembers] = useState([]);
  const [memberObjects, setMemberObjects] = useState([]);
  const [alltime, setAlltime] = useState([]);
  const [polls, setPolls] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [currentUser, setCurrentUser] = useState(() => readUserCookie());
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [isInitialPick, setIsInitialPick] = useState(false);

  function openUserPicker() {
    setIsInitialPick(false);
    setShowUserPicker(true);
  }

  function updatePoll(updatedPoll) {
    setPolls(prev => (prev || []).map(p => p.id === updatedPoll.id ? updatedPoll : p));
  }

  function setPage(newPage) {
    const path = newPage === 'home' ? '/' : `/${newPage}`;
    window.history.pushState(null, '', path);
    _setPage(newPage.split('/')[0]);
    const bracketMatch = newPage.match(/^bracket\/(\d+)$/);
    setBracketViewId(bracketMatch ? parseInt(bracketMatch[1]) : null);
  }

  useEffect(() => {
    const onPop = () => {
      _setPage(pageFromPath());
      const match = window.location.pathname.match(/^\/bracket\/(\d+)/);
      setBracketViewId(match ? parseInt(match[1]) : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry.isIntersecting),
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loaded]);

  useEffect(() => {
    async function load() {
      try {
        const { currentMovies, ratingsData, bracketData, membersData, memberObjectsData, alltimeMovies, pollsData, bracketHistoryData } = await loadAll();
        if (currentMovies.length) setMovies(currentMovies);
        if (Object.keys(ratingsData).length) setRatings(ratingsData);
        if (bracketData) setBracket(bracketData);
        if (bracketHistoryData && bracketHistoryData.length) setBracketHistory(bracketHistoryData);
        if (membersData.length) setMembers(membersData);
        if (memberObjectsData.length) setMemberObjects(memberObjectsData);
        if (alltimeMovies.length) setAlltime(alltimeMovies);
        if (pollsData && pollsData.length) setPolls(pollsData);
      } catch(e) {
        console.error('Failed to load from Supabase:', e);
      }
      setLoaded(true);
    }
    load();
  }, []);

  useEffect(() => {
    if (loaded && readUserCookie() === null) {
      setIsInitialPick(true);
      setShowUserPicker(true);
    }
  }, [loaded]);

  function handleAdminClick() {
    if (adminAuthed) {
      setAdminOpen(true);
    } else {
      setShowLogin(true);
    }
  }

  if (showLogin && !adminAuthed) {
    return <LoginPage onLogin={() => { setAdminAuthed(true); setShowLogin(false); setAdminOpen(true); }} onClose={() => setShowLogin(false)} />;
  }

  if (!loaded) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh'}}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, openUserPicker }}>
      <header className={`site-header${scrolled ? ' header-scrolled' : ''}`}>
        <div className="mobile-identity-bar">
          <span>Hello, <strong>{currentUser?.name || 'there'}</strong></span>
          <button className="mobile-identity-change" onClick={openUserPicker}>(change)</button>
        </div>
        <div className={`logo${footerVisible ? ' logo-hidden' : ''}`} onClick={() => setPage('home')}>
          <div className="logo-circle">
            <img src="/movieclub.png" className="logo-img" alt="Movie Club logo" />
          </div>
        </div>
        <nav className="nav">
          <button className={`nav-btn ${page==='home'?'active':''}`} onClick={()=>setPage('home')}>
            <span className="nav-label">Current</span>
            <span className="nav-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg></span>
          </button>
          <button className={`nav-btn ${page==='ratings'?'active':''}`} onClick={()=>setPage('ratings')}>
            <span className="nav-label">Movies</span>
            <span className="nav-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></span>
          </button>
          <button className={`nav-btn ${page==='poll'||page==='bracket'?'active':''}`} onClick={()=>setPage('poll')}>
            <span className="nav-label">Poll</span>
            <span className="nav-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg></span>
          </button>
        </nav>
        <button className="user-chip" onClick={openUserPicker} title="Change identity">
          {currentUser?.id ? currentUser.name : '?'}
        </button>
      </header>

      {page === 'home' && <HomePage movies={movies} ratings={ratings} setRatings={setRatings} members={members}
        activePoll={(polls||[]).find(p=>p.is_active)} onPollClick={q=>setPage('poll/' + slugify(q))}
        bracket={bracket} onBracketClick={()=>setPage('poll')} />}
      {page === 'ratings' && <RatingsPage movies={movies} ratings={ratings} setRatings={setRatings} alltime={alltime} setAlltime={setAlltime} members={members} adminAuthed={adminAuthed} />}
      {page === 'poll' && <ErrorBoundary fallback={<div style={{padding:'2rem',textAlign:'center',color:'#888'}}><div style={{fontWeight:600,marginBottom:8}}>Polls couldn't load right now</div></div>}>
        <PollPage polls={polls} bracket={bracket} bracketHistory={bracketHistory} members={members}
          onPollUpdate={updatePoll}
          onPollsAdd={newPoll => setPolls(prev => [newPoll, ...(prev || [])])}
          onPollsRemove={pollId => setPolls(prev => (prev || []).filter(p => p.id !== pollId))}
          onBracketUpdate={setBracket} adminAuthed={adminAuthed} onNavigate={setPage} />
      </ErrorBoundary>}
      {page === 'bracket' && <BracketReadOnlyPage
        bracket={bracketViewId ? (bracketHistory.find(h => h.id === bracketViewId) || {}).data || null : bracket}
        onBack={() => { setBracketViewId(null); setPage('poll'); }} />}

      <div className="footer-logo-section" ref={footerRef}
        onClick={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
        <div className="footer-logo-circle">
          <img src="/movieclub.png" alt="Movie Club" />
        </div>
      </div>

      <div style={{textAlign:'center', paddingBottom:48}}>
        <button style={{background:'none',border:'none',cursor:'pointer',color:'#bbb',fontSize:'0.75rem',padding:'6px 16px',letterSpacing:'0.5px'}}
          onClick={handleAdminClick}>admin</button>
      </div>

      {adminOpen && adminAuthed && (
        <AdminPanel
          onClose={() => setAdminOpen(false)}
          movies={movies} setMovies={setMovies}
          members={members} setMembers={setMembers}
          bracket={bracket} setBracket={setBracket}
          alltime={alltime} setAlltime={setAlltime}
          ratings={ratings} setRatings={setRatings}
          polls={polls} setPolls={setPolls}
          onBracketHistoryAdd={record => setBracketHistory(prev => [record, ...prev])}
        />
      )}

      {showUserPicker && (
        <UserPickerModal
          memberObjects={memberObjects}
          canDismiss={!isInitialPick}
          onClose={() => setShowUserPicker(false)}
        />
      )}
    </UserContext.Provider>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
// Accepts an optional `fallback` prop for a custom crashed UI.
// Defaults to the full-screen branded error screen.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false, errorMsg: null }; }
  static getDerivedStateFromError(err) {
    const msg = (err && err.message) ? err.message : String(err);
    return { crashed: true, errorMsg: msg };
  }
  componentDidCatch(err) {
    const msg = (err && err.message) ? err.message : String(err);
    if (!this.state.errorMsg) this.setState({ errorMsg: msg });
  }
  render() {
    if (!this.state.crashed) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    const msg = this.state.errorMsg || 'Unknown error';
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',textAlign:'center',fontFamily:'sans-serif'}}>
        <div>
          <img src="/movieclub.png" style={{width:64,height:64,objectFit:'contain',marginBottom:16,borderRadius:'50%'}} onError={function(e){e.target.style.display='none';}} alt="" />
          <div style={{fontSize:'1.1rem',fontWeight:700,marginBottom:8}}>Sorry yall! Site's a lil sick.</div>
          <div style={{fontSize:'0.9rem',color:'#888',marginBottom:12}}>Let Ali know and check back soon</div>
          <details style={{fontSize:'0.75rem',color:'#aaa',maxWidth:400,textAlign:'left',cursor:'pointer'}}>
            <summary>Error details</summary>
            <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',marginTop:8}}>{msg}</pre>
          </details>
        </div>
      </div>
    );
  }
}

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
