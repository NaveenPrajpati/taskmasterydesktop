// `npm start` / `npm run dev`: starts Electron with this app. Clears
// ELECTRON_RUN_AS_NODE first: VS Code (and tools running inside it) set it,
// and with it Electron starts as plain Node, so `app` is undefined.
const {spawn} = require('node:child_process');
const electron = require('electron'); // the executable's path when required from Node

const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {stdio: 'inherit', env});
child.on('exit', code => process.exit(code ?? 0));
