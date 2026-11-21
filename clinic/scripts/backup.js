'use strict';
// Manual backup: npm run backup
require('../src/config');
const { runBackup } = require('../src/backup');
const f = runBackup({ force: true });
console.log(f ? `Đã sao lưu: ${f}` : 'Không có gì để sao lưu.');
