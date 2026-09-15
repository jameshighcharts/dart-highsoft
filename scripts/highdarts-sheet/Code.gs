/** @OnlyCurrentDoc */

const HIGHDARTS_SOURCE = 'https://hsdart.vercel.app/api/highdarts/sheet';
const HIGHDARTS_SHEET_ID = '1gIbV9OM3RsItTwQQPgwQjAxwOfPsfaPLRA08RXqsp_c';
const HIGHDARTS_LAYOUT = [
  { office: 'bergen', start: 3, count: 30, table: 5, players: 12 },
  { office: 'sogndal', start: 34, count: 13, table: 21, players: 5 },
  { office: 'vik', start: 48, count: 33, table: 30, players: 13 },
];
const HIGHDARTS_FINALS = [
  { stage: 'playoff', start: 13, count: 4 },
  { stage: 'quarterfinal', start: 20, count: 4 },
  { stage: 'semifinal', start: 27, count: 2 },
  { stage: 'final', start: 32, count: 1 },
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Highdarts')
    .addItem('Oppdater frå appen', 'refreshHighdarts')
    .addItem('Aktiver oppdatering kvart 5. minutt', 'installHighdartsSync')
    .addToUi();
}

function installHighdartsSync() {
  refreshHighdarts();
  const installed = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshHighdarts');
  if (!installed) ScriptApp.newTrigger('refreshHighdarts').timeBased().everyMinutes(5).create();
}

function refreshHighdarts() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet.getId() !== HIGHDARTS_SHEET_ID) throw new Error('Wrong tournament spreadsheet');
    const response = UrlFetchApp.fetch(HIGHDARTS_SOURCE, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('App export unavailable: HTTP ' + response.getResponseCode());
    const data = JSON.parse(response.getContentText());
    const schedule = spreadsheet.getSheetByName('Kampoppsett');
    const table = spreadsheet.getSheetByName('Tabell');
    const finals = spreadsheet.getSheetByName('Sluttspilltre');
    if (!schedule || !table || !finals) throw new Error('Tournament tabs are missing');
    const writes = planHighdartsWrites(data, schedule.getRange('A1:N80').getValues());
    const sheets = { Kampoppsett: schedule, Tabell: table, Sluttspilltre: finals };
    for (const write of writes) {
      sheets[write.sheet].getRange(write.row, write.column, write.values.length, write.values[0].length)
        .setValues(write.values.map(row => row.map(value => typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value)));
    }
    SpreadsheetApp.flush();
    const stamp = Utilities.formatDate(new Date(data.generatedAt), 'Europe/Oslo', 'yyyy-MM-dd HH:mm:ss');
    finals.getRange('B2').setValue(stamp);
    console.log('Highdarts updated: ' + data.fixtures.length + ' fixtures, ' + stamp);
  } finally {
    lock.releaseLock();
  }
}

function planHighdartsWrites(data, schedule) {
  if (data.version !== 1 || !Number.isFinite(Date.parse(data.generatedAt)) || !Array.isArray(data.fixtures) || data.fixtures.length !== 76 || !Array.isArray(data.standings) || data.standings.length !== 3 || !Array.isArray(data.byes) || data.byes.length !== 4 || !Array.isArray(data.finals)) {
    throw new Error('Incomplete tournament export. Existing sheet preserved.');
  }
  const headers = ['Kontor', 'Kampnr', 'Spelar A', 'Spelar B', 'Legs A', 'Legs B', 'Snitt A', 'Snitt B', 'Vinnar', 'Tel for A', 'Tel for B'];
  if (headers.some((v, i) => schedule[1][i] !== v)) throw new Error('Kampoppsett columns changed');
  const writes = [];
  const write = (sheet, row, column, values, width) => {
    if (!values.length || values.some(r => !Array.isArray(r) || r.length !== width || r.some(v => typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))))) throw new Error('Invalid tournament values');
    writes.push({ sheet, row, column, values });
  };
  for (const layout of HIGHDARTS_LAYOUT) {
    const fixtures = data.fixtures.filter(f => f.office === layout.office).sort((a, b) => a.number - b.number);
    if (fixtures.length !== layout.count) throw new Error('Incomplete office schedule');
    for (let i = 0; i < fixtures.length; i++) {
      const row = schedule[layout.start - 1 + i];
      if (fixtures[i].number !== i + 1 || String(row[0]).toLowerCase() !== layout.office || Number(row[1]) !== i + 1) throw new Error('Fixture rows changed');
      if (!fixtures[i].counts.every(v => v === 0 || v === 1)) throw new Error('Invalid counting choice');
    }
    write('Kampoppsett', layout.start, 3, fixtures.map(f => f.players), 2);
    write('Kampoppsett', layout.start, 5, fixtures.map(f => f.result), 4);
    write('Kampoppsett', layout.start, 10, fixtures.map(f => f.counts), 2);
    const officeTables = data.standings.filter(o => o.office === layout.office);
    if (officeTables.length !== 1 || officeTables[0].rows.length !== layout.players) throw new Error('Incomplete office standings');
    write('Tabell', layout.table, 1, officeTables[0].rows, 5);
  }
  write('Sluttspilltre', 6, 2, data.byes.map(n => [n]), 1);
  if (data.finals.length !== 0 && data.finals.length !== 11) throw new Error('Incomplete finals draw');
  for (const layout of HIGHDARTS_FINALS) {
    const fixtures = data.finals.filter(f => f.stage === layout.stage).sort((a, b) => a.number - b.number);
    if (data.finals.length && (fixtures.length !== layout.count || fixtures.some((f, i) => f.number !== i + 1))) throw new Error('Invalid finals draw');
    write('Sluttspilltre', layout.start, 2, Array.from({ length: layout.count }, (_, i) => fixtures[i]?.values ?? ['', '', '']), 3);
  }
  write('Kampoppsett', 1, 1, [['Resultat, kampsnitt og Tel for A/B vert oppdaterte frå dart-appen kvart 5. minutt. Endre resultat og val av teljande kampar i appen.']], 1);
  write('Tabell', 1, 1, [['Tabellen vert oppdatert frå dart-appen. Snitt er vekta etter talet på kasta piler i teljande kampar. Rangering og omkampar følgjer appen.']], 1);
  write('Sluttspilltre', 1, 1, [['Sluttspel og vinnarar vert oppdaterte frå dart-appen etter at trekninga er låst. Tomme felt er ikkje avgjorde enno.']], 1);
  return writes;
}
