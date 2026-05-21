import Database from 'better-sqlite3';

export const db = new Database('ffxi_alliance_bot.sqlite');
db.pragma('journal_mode = WAL');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS template_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      alliance_number INTEGER NOT NULL,
      party_number INTEGER NOT NULL,
      slot_number INTEGER NOT NULL,
      job TEXT NOT NULL,
      note TEXT DEFAULT '',
      FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      event_time TEXT DEFAULT '',
      channel_id TEXT NOT NULL,
      message_id TEXT,
      locked INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(template_id) REFERENCES templates(id)
    );

    CREATE TABLE IF NOT EXISTS event_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      alliance_number INTEGER NOT NULL,
      party_number INTEGER NOT NULL,
      slot_number INTEGER NOT NULL,
      job TEXT NOT NULL,
      note TEXT DEFAULT '',
      user_id TEXT,
      display_name TEXT,
      signed_at TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present',
      note TEXT DEFAULT '',
      marked_by TEXT NOT NULL,
      marked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, display_name),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_jobs (
      user_id TEXT NOT NULL,
      job TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, job),
      FOREIGN KEY(user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
    );
  `);
}

export function seedDefaultTemplates() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM templates').get().c;
  if (count > 0) return;

  const insertTemplate = db.prepare('INSERT INTO templates (name, description) VALUES (?, ?)');
  const insertSlot = db.prepare(`
    INSERT INTO template_slots (template_id, alliance_number, party_number, slot_number, job, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const templates = [
    {
      name: 'Dynamis-D',
      description: 'Default FFXI Dynamis-D alliance layout',
      parties: [
        ['RUN', 'WHM', 'BRD', 'COR', 'GEO', 'DD'],
        ['PLD', 'WHM', 'BRD', 'COR', 'GEO', 'DD'],
        ['SCH', 'RDM', 'BLM', 'BLM', 'COR', 'GEO']
      ]
    },
    {
      name: 'Sortie',
      description: 'Default Sortie layout',
      parties: [
        ['RUN', 'WHM', 'BRD', 'COR', 'GEO', 'DD'],
        ['SCH', 'RDM', 'BLM', 'BLM', 'GEO', 'COR'],
        ['WAR', 'SAM', 'DRK', 'BRD', 'COR', 'WHM']
      ]
    },
    {
      name: 'Omen',
      description: 'Default Omen layout',
      parties: [
        ['Tank', 'WHM', 'BRD', 'COR', 'GEO', 'DD'],
        ['Tank', 'WHM', 'BRD', 'COR', 'GEO', 'DD'],
        ['DD', 'DD', 'DD', 'Support', 'Support', 'Healer']
      ]
    }
  ];

  const tx = db.transaction(() => {
    for (const t of templates) {
      const templateId = insertTemplate.run(t.name, t.description).lastInsertRowid;
      t.parties.forEach((party, pIndex) => {
        party.forEach((job, sIndex) => insertSlot.run(templateId, 1, pIndex + 1, sIndex + 1, job, ''));
      });
    }
  });
  tx();
}
