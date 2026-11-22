const { spawn } = require('child_process');
const electronBin = require('electron');
const path = require('path');

// Guarantee that ELECTRON_RUN_AS_NODE is completely unset so Electron runs as a Desktop GUI app
delete process.env.ELECTRON_RUN_AS_NODE;

const projectRoot = path.join(__dirname, '..');
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, ['.'], {
  cwd: projectRoot,
  env: cleanEnv,
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
