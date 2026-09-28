// BAB AL FKAMAH — application PC (Electron)
// Ouvre la page de connexion locale (launcher.html), qui redirige vers le serveur du restaurant
// (par défaut http://rest.babfkamah.com). Impression des tickets : fenêtre d'impression ou directe.
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
function lireConfig() { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; } }
function ecrireConfig(c) { const n = { ...lireConfig(), ...c }; fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(n, null, 2)); return n; }

let win;
const LAUNCHER = path.join(__dirname, 'launcher.html');

function ouvrirLauncher(hash) { win.loadFile(LAUNCHER, hash ? { hash } : undefined); }

function creerFenetre() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600,
    title: 'BAB AL FKAMAH', icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#f6f4f0', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' BabAlFkamahDesktop/4.0');

  // Liens externes (WhatsApp, Google Maps, téléphone) → navigateur / application du système
  const externe = (url) => /^(https?:\/\/(wa\.me|api\.whatsapp\.com|www\.google\.[a-z.]+\/maps|maps\.google\.|goo\.gl|maps\.app\.goo\.gl))|^(tel|mailto|whatsapp|geo):/i.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (externe(url)) { e.preventDefault(); shell.openExternal(url); } });

  // Serveur injoignable → retour à la page de connexion
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith('file:')) ouvrirLauncher('erreur');
  });

  ouvrirLauncher();
}

// ------------------------------------------------------------ pont avec la page (preload.js)
ipcMain.handle('config:get', () => lireConfig());
ipcMain.handle('config:set', (e, c) => ecrireConfig(c || {}));
ipcMain.on('reglages', () => ouvrirLauncher('reglages'));
ipcMain.on('imprimer', (e) => {
  const direct = !!lireConfig().impressionDirecte;
  e.sender.print({ silent: direct, printBackground: true, margins: { marginType: 'none' } }, (ok, err) => {
    if (!ok && err && err !== 'cancelled' && err !== 'Print job canceled') dialog.showErrorBox('Impression', String(err));
  });
});

// ------------------------------------------------------------ raccourcis clavier
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Application', submenu: [
      { label: 'Recharger', accelerator: 'F5', click: () => win.webContents.reload() },
      { label: 'Plein écran', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
      { label: 'Adresse du serveur', accelerator: 'Ctrl+Shift+S', click: () => ouvrirLauncher('reglages') },
      { label: 'Zoom +', accelerator: 'Ctrl+=', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5) },
      { label: 'Zoom -', accelerator: 'Ctrl+-', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5) },
      { label: 'Zoom 100 %', accelerator: 'Ctrl+0', click: () => win.webContents.setZoomLevel(0) },
      { label: 'Outils développeur', accelerator: 'Ctrl+Shift+I', click: () => win.webContents.toggleDevTools() },
      { type: 'separator' }, { label: 'Quitter', role: 'quit' }
    ]
  }]));
}

// Une seule instance
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { menu(); creerFenetre(); });
  app.on('window-all-closed', () => app.quit());
}
