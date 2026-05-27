// Next Tier — Apps Script Backend
// ════════════════════════════════════════════════════════════════
// SETUP:
//   1. Extensions → Apps Script → paste this file → Save
//   2. Run initSheets() once manually to create sheet tabs
//   3. Deploy → New deployment → Web app
//      Execute as: Me  |  Who has access: Anyone
//   4. Copy the Web App URL → paste into intake.html and contact.html
// ════════════════════════════════════════════════════════════════

const TABS = {
  intake:   'Intake',
  contact:  'Contact',
  users:    'Users',
  sessions: 'Sessions',
  products: 'Products'
};

const SESSION_TTL_HOURS = 24;

// ── CORS helper ───────────────────────────────────────────────────
// Returns a JSON response with CORS headers so the browser can read it.
// This is what allows us to drop no-cors and get real error feedback.
function jsonCors(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Apps Script does not support setting arbitrary headers via ContentService,
// but it DOES allow cross-origin reads when the web app is deployed as
// "Execute as: Me, Who has access: Anyone" — the response is readable
// as long as the request uses fetch() without no-cors.
// The doOptions handler below handles the CORS preflight.
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── Sheet bootstrap ───────────────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureTab(ss, TABS.intake, [
    'Submission Date','First Name','Last Name','Date of Birth','Position',
    'Height','Weight','Contact Name','Relationship','Email','Phone',
    'How Did You Hear','Team Name','League','Season','Jersey Number',
    'Package Selected','Consent - Data','Consent - Contact'
  ]);

  ensureTab(ss, TABS.contact, [
    'Submission Date','First Name','Last Name','Email','Phone','Topic','Message'
  ]);

  ensureTab(ss, TABS.users, [
    'ID','Created At','Email','Password Hash','Role',
    'First Name','Last Name','Status','Linked Player ID'
  ]);

  ensureTab(ss, TABS.sessions, [
    'Token','User ID','Email','Role','Created At','Expires At'
  ]);

  ensureTab(ss, TABS.products, [
    'ID','User ID','Created At','Package','Status',
    'First Name','Last Name','Position','Team','League','Jersey Number','PDS Score','Report URL'
  ]);
}

function ensureTab(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#08090C')
      .setFontColor('#1DBC7A');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Router ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonCors({ status: 'error', message: 'No data received.' });
    }

    let raw = e.postData.contents;

    // Handle application/x-www-form-urlencoded: data=<encoded JSON>
    if (raw.startsWith('data=')) {
      raw = decodeURIComponent(raw.substring(5));
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (parseErr) {
      return jsonCors({ status: 'error', message: 'JSON parse failed. Raw: ' + raw.substring(0, 200) });
    }

    const type = payload.type || 'intake';

    switch (type) {
      case 'intake':      return handleIntake(payload);
      case 'contact':     return handleContact(payload);
      case 'register':    return handleRegister(payload);
      case 'login':       return handleLogin(payload);
      case 'logout':      return handleLogout(payload);
      case 'validate':    return handleValidate(payload);
      case 'getUsers':    return handleGetUsers(payload);
      case 'updateUser':  return handleUpdateUser(payload);
      case 'getProduct':      return handleGetProduct(payload);
      case 'listProducts':    return handleListProducts(payload);
      case 'deliverProduct':  return handleDeliverProduct(payload);
      case 'uploadReport':    return handleUploadReport(payload);
      default:
        return jsonCors({ status: 'error', message: 'Unknown type: ' + type });
    }
  } catch (err) {
    return jsonCors({ status: 'error', message: 'doPost error: ' + err.message });
  }
}

function doGet(e) {
  // All requests arrive as GET with a ?payload= parameter to avoid CORS preflight.
  if (e && e.parameter && e.parameter.payload) {
    try {
      const payload = JSON.parse(e.parameter.payload);
      const type    = payload.type || 'intake';
      switch (type) {
        case 'intake':      return handleIntake(payload);
        case 'contact':     return handleContact(payload);
        case 'register':    return handleRegister(payload);
        case 'login':       return handleLogin(payload);
        case 'logout':      return handleLogout(payload);
        case 'validate':    return handleValidate(payload);
        case 'getUsers':    return handleGetUsers(payload);
        case 'updateUser':  return handleUpdateUser(payload);
        case 'getProduct':      return handleGetProduct(payload);
        case 'listProducts':    return handleListProducts(payload);
        case 'deliverProduct':  return handleDeliverProduct(payload);
        case 'uploadReport':    return handleUploadReport(payload);
        default:                return jsonCors({ status: 'error', message: 'Unknown type: ' + type });
      }
    } catch (err) {
      return jsonCors({ status: 'error', message: 'GET parse error: ' + err.message });
    }
  }
  // Health check
  return jsonCors({ status: 'ok', message: 'Next Tier API is live', time: new Date().toISOString() });
}

// ── Intake ────────────────────────────────────────────────────────
function handleIntake(payload) {
  if (!payload.row || !Array.isArray(payload.row)) {
    return jsonCors({ status: 'error', message: 'No row data in payload.' });
  }
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.intake);
  if (!sheet) {
    return jsonCors({ status: 'error', message: 'Intake sheet not found. Run initSheets() first.' });
  }
  sheet.appendRow(payload.row);

  // Link intake to a user account when userId is provided
  if (payload.userId) {
    const prodSheet = ss.getSheetByName(TABS.products);
    if (prodSheet) {
      const r   = payload.row;
      // row layout: [date, firstName, lastName, dob, position, height, weight,
      //              contactName, relationship, email, phone, howHeard,
      //              teamName, league, season, jerseyNumber, package, consentData, consentContact]
      const id  = Utilities.getUuid();
      const now = new Date().toISOString();
      prodSheet.appendRow([
        id, payload.userId, now,
        r[16] || '',  // Package Selected
        'pending',
        r[1]  || '',  // First Name
        r[2]  || '',  // Last Name
        r[4]  || '',  // Position
        r[12] || '',  // Team Name
        r[13] || '',  // League
        r[15] || '',  // Jersey Number
        ''            // PDS Score (admin fills later)
      ]);
    }
  }

  return jsonCors({ status: 'ok', message: 'Row written to Intake tab.' });
}

// ── Contact ───────────────────────────────────────────────────────
function handleContact(payload) {
  if (!payload.row || !Array.isArray(payload.row)) {
    return jsonCors({ status: 'error', message: 'No row data in payload.' });
  }
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.contact);
  if (!sheet) {
    return jsonCors({ status: 'error', message: 'Contact sheet not found. Run initSheets() first.' });
  }
  sheet.appendRow(payload.row);
  return jsonCors({ status: 'ok', message: 'Row written to Contact tab.' });
}

// ── Register ──────────────────────────────────────────────────────
function handleRegister(payload) {
  const { email, password, role, firstName, lastName, linkedPlayerId } = payload;
  if (!email || !password || !role || !firstName)
    return jsonCors({ status: 'error', message: 'Missing required fields.' });
  if (!['player','parent','scout','admin'].includes(role))
    return jsonCors({ status: 'error', message: 'Invalid role.' });

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.users);
  if (!sheet) return jsonCors({ status: 'error', message: 'Users sheet not found. Run initSheets().' });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().toLowerCase() === email.toLowerCase())
      return jsonCors({ status: 'error', message: 'An account with this email already exists.' });
  }

  const id   = Utilities.getUuid();
  const hash = hashPassword(password);
  const now  = new Date().toISOString();

  sheet.appendRow([id, now, email.toLowerCase(), hash, role, firstName, lastName || '', 'active', linkedPlayerId || '']);

  const token = createSession(id, email, role);
  return jsonCors({ status: 'ok', token, user: { id, email, role, firstName, lastName: lastName || '' } });
}

// ── Login ─────────────────────────────────────────────────────────
function handleLogin(payload) {
  const { email, password } = payload;
  if (!email || !password)
    return jsonCors({ status: 'error', message: 'Email and password required.' });

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.users);
  if (!sheet) return jsonCors({ status: 'error', message: 'Users sheet not found.' });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[2].toString().toLowerCase() === email.toLowerCase()) {
      if (row[7] === 'suspended')
        return jsonCors({ status: 'error', message: 'This account has been suspended.' });
      if (verifyPassword(password, row[3])) {
        const token = createSession(row[0], row[2], row[4]);
        return jsonCors({ status: 'ok', token, user: { id: row[0], email: row[2], role: row[4], firstName: row[5], lastName: row[6] } });
      }
      return jsonCors({ status: 'error', message: 'Incorrect password.' });
    }
  }
  return jsonCors({ status: 'error', message: 'No account found with that email.' });
}

// ── Logout ────────────────────────────────────────────────────────
function handleLogout(payload) {
  const { token } = payload;
  if (!token) return jsonCors({ status: 'ok' });
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.sessions);
  if (!sheet) return jsonCors({ status: 'ok' });
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) { sheet.deleteRow(i + 1); break; }
  }
  return jsonCors({ status: 'ok' });
}

// ── Validate ──────────────────────────────────────────────────────
function handleValidate(payload) {
  const { token } = payload;
  if (!token) return jsonCors({ status: 'error', message: 'No token.' });
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.sessions);
  if (!sheet) return jsonCors({ status: 'error', message: 'Sessions sheet not found.' });
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] === token) {
      if (new Date() > new Date(row[5])) {
        sheet.deleteRow(i + 1);
        return jsonCors({ status: 'error', message: 'Session expired.' });
      }
      return jsonCors({ status: 'ok', user: { id: row[1], email: row[2], role: row[3] } });
    }
  }
  return jsonCors({ status: 'error', message: 'Invalid session.' });
}

// ── Admin: list users ─────────────────────────────────────────────
function handleGetUsers(payload) {
  const auth = requireRole(payload.token, ['admin']);
  if (auth.status === 'error') return jsonCors(auth);
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.users);
  const data  = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    users.push({ id: r[0], createdAt: r[1], email: r[2], role: r[4], firstName: r[5], lastName: r[6], status: r[7], linkedPlayerId: r[8] });
  }
  return jsonCors({ status: 'ok', users });
}

// ── Admin: update user ────────────────────────────────────────────
function handleUpdateUser(payload) {
  const auth = requireRole(payload.token, ['admin']);
  if (auth.status === 'error') return jsonCors(auth);
  const { userId, role, status } = payload;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.users);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      if (role)   sheet.getRange(i + 1, 5).setValue(role);
      if (status) sheet.getRange(i + 1, 8).setValue(status);
      return jsonCors({ status: 'ok' });
    }
  }
  return jsonCors({ status: 'error', message: 'User not found.' });
}

// ── Get Product ───────────────────────────────────────────────────
function handleGetProduct(payload) {
  const auth = requireRole(payload.token, ['player','parent','scout','admin']);
  if (auth.status === 'error') return jsonCors(auth);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.products);
  if (!sheet) return jsonCors({ status: 'ok', product: null });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[1] === auth.userId) {
      return jsonCors({
        status: 'ok',
        product: {
          id:          r[0],
          userId:      r[1],
          createdAt:   r[2],
          package:     r[3],
          status:      r[4],
          firstName:   r[5],
          lastName:    r[6],
          position:    r[7],
          team:        r[8],
          league:      r[9],
          jerseyNumber: r[10],
          pdsScore:    r[11],
          reportUrl:   r[12] || ''
        }
      });
    }
  }
  return jsonCors({ status: 'ok', product: null });
}

function handleListProducts(payload) {
  const auth = requireRole(payload.token, ['admin']);
  if (auth.status === 'error') return jsonCors(auth);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.products);
  if (!sheet) return jsonCors({ status: 'ok', products: [] });

  const data = sheet.getDataRange().getValues();
  const products = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    products.push({
      id:          r[0],
      userId:      r[1],
      createdAt:   r[2] ? r[2].toString() : '',
      package:     r[3],
      status:      r[4],
      firstName:   r[5],
      lastName:    r[6],
      position:    r[7],
      team:        r[8],
      league:      r[9],
      jerseyNumber: r[10],
      pdsScore:    r[11],
      reportUrl:   r[12] || ''
    });
  }
  return jsonCors({ status: 'ok', products });
}

function handleUploadReport(payload) {
  const auth = requireRole(payload.token, ['admin']);
  if (auth.status === 'error') return jsonCors(auth);

  const { productId, fileName, fileData, mimeType } = payload;
  if (!productId || !fileData) return jsonCors({ status: 'error', message: 'productId and fileData required' });

  try {
    const decoded = Utilities.base64Decode(fileData);
    const blob    = Utilities.newBlob(decoded, mimeType || 'application/pdf', fileName || 'report.pdf');

    const folders = DriveApp.getFoldersByName('NT Reports');
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder('NT Reports');

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const reportUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(TABS.products);
    if (!sheet) return jsonCors({ status: 'error', message: 'Products sheet not found' });

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === productId) {
        sheet.getRange(i + 1, 5).setValue('active');
        sheet.getRange(i + 1, 13).setValue(reportUrl);
        return jsonCors({ status: 'ok', reportUrl });
      }
    }
    return jsonCors({ status: 'error', message: 'Product not found' });
  } catch (err) {
    return jsonCors({ status: 'error', message: 'Upload failed: ' + err.message });
  }
}

function handleDeliverProduct(payload) {
  const auth = requireRole(payload.token, ['admin']);
  if (auth.status === 'error') return jsonCors(auth);

  const { productId, pdsScore } = payload;
  if (!productId) return jsonCors({ status: 'error', message: 'productId required' });

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.products);
  if (!sheet) return jsonCors({ status: 'error', message: 'Products sheet not found' });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === productId) {
      sheet.getRange(i + 1, 5).setValue('active');        // Status → active
      sheet.getRange(i + 1, 12).setValue(pdsScore || ''); // PDS Score
      return jsonCors({ status: 'ok', message: 'Product delivered' });
    }
  }
  return jsonCors({ status: 'error', message: 'Product not found' });
}

// ── Helpers ───────────────────────────────────────────────────────
function createSession(userId, email, role) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(TABS.sessions);
  const token   = Utilities.getUuid();
  const now     = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  sheet.appendRow([token, userId, email, role, now.toISOString(), expires.toISOString()]);
  return token;
}

function requireRole(token, allowedRoles) {
  if (!token) return { status: 'error', message: 'Not authenticated.' };
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.sessions);
  if (!sheet) return { status: 'error', message: 'Sessions sheet missing.' };
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] === token) {
      if (new Date() > new Date(row[5])) return { status: 'error', message: 'Session expired.' };
      if (!allowedRoles.includes(row[3])) return { status: 'error', message: 'Insufficient permissions.' };
      return { status: 'ok', userId: row[1], role: row[3] };
    }
  }
  return { status: 'error', message: 'Invalid session.' };
}

function hashPassword(pw) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw + 'nt_nexttier_salt_2025');
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function verifyPassword(pw, hash) {
  return hashPassword(pw) === hash;
}
