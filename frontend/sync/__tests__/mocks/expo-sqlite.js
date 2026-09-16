const { DatabaseSync } = require('node:sqlite');

let db = null;

function currentDb() {
  if (!db) {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return db;
}

function toParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

module.exports = {
  async openDatabaseAsync() {
    return {
      async getAllAsync(sql, ...params) {
        return currentDb().prepare(sql).all(...toParams(params));
      },
      async getFirstAsync(sql, ...params) {
        return currentDb().prepare(sql).get(...toParams(params));
      },
      async runAsync(sql, ...params) {
        currentDb().prepare(sql).run(...toParams(params));
      },
      async execAsync(sql) {
        currentDb().exec(sql);
      },
      async closeAsync() {},
    };
  },
  __reset() {
    try { db && db.close(); } catch {}
    db = null;
  },
};