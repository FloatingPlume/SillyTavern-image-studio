import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['index.js', 'src', 'scripts', 'tests'];
const files = [];

function walk(target) {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile() && (target.endsWith('.js') || target.endsWith('.mjs'))) {
        files.push(target);
        return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(target)) {
        walk(path.join(target, entry));
    }
}

for (const root of roots) walk(root);

let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        console.error(`Syntax check failed: ${file}`);
        console.error(result.stderr || result.stdout);
    }
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
