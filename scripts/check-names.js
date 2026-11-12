// Finds names that are used but never defined or imported (e.g. a constant left behind when code moved
// to another module). Uses the TypeScript checker on the plain JavaScript, reporting only those errors.
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const tsc = require.resolve('typescript/bin/tsc');
const files = (pattern) => execFileSync('git', ['ls-files', ...pattern], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const NAME_ERRORS = /error TS(2304|2552|2448|2305|2724|2307):/; // cannot find name / module, used before declaration
const NODE_GLOBALS = /'(require|module|exports|process|__dirname|__filename|Buffer|setImmediate)'/;

function run(label, args, list) {
  let out = '';
  try { execFileSync(process.execPath, [tsc, '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck', '--target', 'es2022', ...args, ...list], { cwd: root, encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); }
  const bad = out.split('\n').filter((l) => NAME_ERRORS.test(l) && !NODE_GLOBALS.test(l));
  console.log(`${label}: ${bad.length ? bad.length + ' problem(s)' : 'ok'}`);
  for (const l of bad) console.log('  ' + l);
  return bad.length;
}

const n = run('renderer', ['--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2023,dom,dom.iterable'], files(['src/renderer/*.js']))
  + run('main', ['--module', 'commonjs', '--lib', 'es2023'], files(['src/main/*.js', 'src/preload.js']));
process.exit(n ? 1 : 0);
