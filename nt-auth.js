// Next Tier — shared auth library
// Requires: supabase-js CDN, then config.js, then this file.

const NT = (() => {
  // flowType pinned to 'implicit' — reset-password.html parses recovery tokens from the
  // URL hash (#access_token&type=recovery); the PKCE flow (default in newer supabase-js)
  // would deliver a ?code= param instead and break that page.
  const _supabase = supabase.createClient(NT_SUPABASE_URL, NT_SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit' },
  });
  let _cachedUser  = null;
  let _cachedToken = null;

  // ── Helpers ────────────────────────────────────────────────────
  function _normalizeProfile(row) {
    if (!row) return null;
    return {
      id:        row.id,
      email:     row.email      || '',
      role:      row.role       || 'player',
      firstName: row.first_name || row.firstName || '',
      lastName:  row.last_name  || row.lastName  || '',
      status:    row.status     || 'active',
      teamId:    row.linked_player_id || row.teamId || null,
      parentPlayerId: row.parent_player_id || row.parentPlayerId || null,
    };
  }

  function _normalizeProduct(r) {
    return {
      id:           r.id,
      userId:       r.user_id,
      intakeId:     r.intake_id   || null,
      createdAt:    r.created_at  ? r.created_at.toString() : '',
      package:      r.package     || '',
      status:       r.status      || '',
      firstName:    r.first_name  || '',
      lastName:     r.last_name   || '',
      position:     r.position    || '',
      team:         r.team        || '',
      league:       r.league      || '',
      jerseyNumber: r.jersey_number || '',
      pdsScore:     r.pds_score   || '',
      reportUrl:    r.report_path || '',
    };
  }

  function _normalizeCoachNote(r) {
    return {
      id:               r.id,
      playerId:         r.player_id,
      coachId:          r.coach_id,
      coachName:        r.coach_name        || '',
      coachTitle:       r.coach_title       || '',
      team:             r.team              || '',
      entryDate:        r.entry_date || r.created_at || '',
      overallGrade:     r.overall_grade     || '',
      strengths:        r.strengths         || [],
      areasImprovement: r.areas_improvement || [],
      coachability:     r.coachability      || '',
      practiceVsGame:   r.practice_vs_game  || '',
      projectedRole:    r.projected_role    || '',
      generalComments:  r.general_comments  || '',
    };
  }

  // ── Public interface ───────────────────────────────────────────
  function getToken()  { return _cachedToken; }
  function getUser()   { return _cachedUser;  }
  function getSupabase() { return _supabase;  }

  function setSession(token, user) {
    _cachedToken = token;
    _cachedUser  = user;
  }

  async function clearSession() {
    _cachedUser  = null;
    _cachedToken = null;
    await _supabase.auth.signOut();
  }

  async function login(email, password) {
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return { status: 'error', message: error?.message || 'Login failed.' };
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (profile?.status === 'suspended') {
      await _supabase.auth.signOut();
      return { status: 'error', message: 'This account has been suspended.' };
    }
    const user = _normalizeProfile({ ...data.user, ...profile });
    _cachedUser  = user;
    _cachedToken = data.session.access_token;
    return { status: 'ok', token: _cachedToken, user };
  }

  async function register(email, password, role, firstName, lastName) {
    const { data, error } = await _supabase.auth.signUp({
      email, password,
      options: { data: { role, firstName, lastName } },
    });
    if (error) return { status: 'error', message: error.message };
    if (!data.session) return { status: 'error', message: 'Registration failed. Please try again.' };
    const user = { id: data.user.id, email: data.user.email, role, firstName, lastName: lastName || '' };
    _cachedUser  = user;
    _cachedToken = data.session.access_token;
    return { status: 'ok', token: _cachedToken, user };
  }

  async function logout() {
    await clearSession();
    window.location.href = '/login';
  }

  async function validate() {
    const { data: { user }, error } = await _supabase.auth.getUser();
    if (error || !user) { _cachedUser = null; _cachedToken = null; return null; }
    const { data: { session } } = await _supabase.auth.getSession();
    _cachedToken = session?.access_token || null;
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!profile || profile.status === 'suspended') {
      await _supabase.auth.signOut();
      _cachedUser = null; _cachedToken = null;
      return null;
    }
    _cachedUser = _normalizeProfile({ ...user, ...profile });
    return _cachedUser;
  }

  async function guard(allowedRoles) {
    const valid = await validate();
    if (!valid) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return null;
    }
    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(valid.role)) {
      window.location.href = '/unauthorized';
      return null;
    }
    return valid;
  }

  function renderUser() {
    const user = _cachedUser;
    if (!user) return;
    const initial  = (user.firstName || '?')[0].toUpperCase();
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const role     = user.role || '';
    document.querySelectorAll('[data-nt-initial]').forEach(el => { el.textContent = initial; });
    document.querySelectorAll('[data-nt-name]').forEach(el    => { el.textContent = fullName; });
    document.querySelectorAll('[data-nt-role]').forEach(el    => { el.textContent = role; });
    const avatarEl = document.getElementById('navAvatar');
    const nameEl   = document.getElementById('navName');
    const roleEl   = document.getElementById('navRole');
    if (avatarEl) avatarEl.textContent = initial;
    if (nameEl)   nameEl.textContent   = fullName;
    if (roleEl)   roleEl.textContent   = role;
  }

  async function api(payload) {
    const type = payload.type;

    // ── Direct Supabase client calls ───────────────────────────
    if (type === 'getProducts') {
      const { data, error } = await _supabase.from('products').select('*').order('created_at', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', products: (data || []).map(_normalizeProduct) };
    }

    if (type === 'getProduct') {
      const { data: { user } } = await _supabase.auth.getUser();
      if (!user) return { status: 'error', message: 'Not authenticated.' };
      const { data, error } = await _supabase.from('products').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', product: data ? _normalizeProduct(data) : null };
    }

    if (type === 'listProducts') {
      const { data, error } = await _supabase.from('products').select('*').order('created_at', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', products: (data || []).map(_normalizeProduct) };
    }

    if (type === 'getUsers') {
      const { data, error } = await _supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', users: (data || []).map(_normalizeProfile) };
    }

    if (type === 'updateUser') {
      const update = {};
      if (payload.role)   update.role   = payload.role;
      if (payload.status) update.status = payload.status;
      const { error } = await _supabase.from('profiles').update(update).eq('id', payload.userId);
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok' };
    }

    if (type === 'getTeamMembers') {
      const { data: { user } } = await _supabase.auth.getUser();
      if (!user) return { status: 'error', message: 'Not authenticated.' };
      const { data, error } = await _supabase.from('profiles')
        .select('*').eq('linked_player_id', user.id).order('created_at', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', members: (data || []).map(_normalizeProfile) };
    }

    if (type === 'getTeamProducts') {
      const { data: { user } } = await _supabase.auth.getUser();
      if (!user) return { status: 'error', message: 'Not authenticated.' };
      const { data: members, error: mErr } = await _supabase.from('profiles')
        .select('id').eq('linked_player_id', user.id);
      if (mErr) return { status: 'error', message: mErr.message };
      if (!members?.length) return { status: 'ok', products: [] };
      const ids = members.map(m => m.id);
      const { data, error } = await _supabase.from('products')
        .select('*').in('user_id', ids).order('created_at', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', products: (data || []).map(_normalizeProduct) };
    }

    if (type === 'getProductForPlayer') {
      const { data, error } = await _supabase.from('products').select('*').eq('user_id', payload.playerId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', product: data ? _normalizeProduct(data) : null };
    }

    if (type === 'getCardJobs') {
      const { data, error } = await _supabase.from('card_jobs_latest').select('*');
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', jobs: data || [] };
    }

    if (type === 'getCoachNotes') {
      const { data, error } = await _supabase.from('coach_notes').select('*').eq('player_id', payload.playerId).order('entry_date', { ascending: false });
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', notes: (data || []).map(_normalizeCoachNote) };
    }

    if (type === 'addCoachNote') {
      const { data: { user } } = await _supabase.auth.getUser();
      if (!user) return { status: 'error', message: 'Not authenticated.' };
      const { data: profile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
      const coachName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || 'Coach';
      const row = {
        player_id:         payload.playerId,
        coach_id:          user.id,
        coach_name:        coachName,
        coach_title:       payload.coachTitle || '',
        team:              payload.team || '',
        overall_grade:     payload.overallGrade,
        strengths:         payload.strengths || [],
        areas_improvement: payload.areasImprovement || [],
        coachability:      payload.coachability || '',
        practice_vs_game:  payload.practiceVsGame || '',
        projected_role:    payload.projectedRole || '',
        general_comments:  payload.generalComments || '',
      };
      const { data, error } = await _supabase.from('coach_notes').insert(row).select().single();
      if (error) return { status: 'error', message: error.message };
      return { status: 'ok', note: _normalizeCoachNote(data) };
    }

    if (type === 'requestReset') {
      const redirectTo = (payload.resetUrlBase || (window.location.origin + '/reset-password?token=')).split('?')[0];
      await _supabase.auth.resetPasswordForEmail(payload.email, { redirectTo });
      return { status: 'ok' }; // always ok — prevent email enumeration
    }

    // ── Edge Function calls ────────────────────────────────────
    const edgeFnMap = {
      intake:            'intake',
      teamIntake:        'team-intake',
      contact:           'contact',
      uploadReport:      'upload-report',
      viewReport:        'view-report',
      deliverProduct:    'deliver-product',
      approveCard:       'approve-card',
      retryCardJob:      'retry-card-job',
      createTeamMember:  'create-team-member',
      createTeamAccount: 'create-team-account',
    };

    if (edgeFnMap[type]) {
      const { data: { session } } = await _supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session) headers['Authorization'] = 'Bearer ' + session.access_token;
      const res = await fetch(NT_EDGE_BASE + '/' + edgeFnMap[type], {
        method:  'POST',
        headers,
        body:    JSON.stringify(payload),
      });
      return res.json();
    }

    return { status: 'error', message: 'Unknown action: ' + type };
  }

  return { getToken, getUser, getSupabase, setSession, clearSession, api, login, register, logout, validate, guard, renderUser };
})();
