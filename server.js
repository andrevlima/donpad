const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '::';
const DATA_DIR = path.join(__dirname, 'data');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

function sanitizePad(rawPad) {
  const segments = rawPad
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const seg of segments) {
    if (seg === '.' || seg === '..') return null;
    if (seg.length > 120) return null;
    if (/[\u0000-\u001f<>]/.test(seg)) return null;
  }
  if (segments.length === 0 || segments.length > 10) return null;
  return segments;
}

function padDir(segments) {
  const dir = path.join(DATA_DIR, ...segments);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(DATA_DIR))) return null;
  return resolved;
}

async function readPad(segments) {
  const dir = padDir(segments);
  if (!dir) return { content: '', mtime: 0 };
  const file = path.join(dir, 'content.txt');
  try {
    const [content, stat] = await Promise.all([
      fsp.readFile(file, 'utf8'),
      fsp.stat(file),
    ]);
    return { content, mtime: stat.mtimeMs };
  } catch (err) {
    return { content: '', mtime: 0 };
  }
}

async function writePad(segments, content) {
  const dir = padDir(segments);
  if (!dir) throw new Error('invalid pad');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'content.txt');
  await fsp.writeFile(file, content, 'utf8');
  const stat = await fsp.stat(file);
  return stat.mtimeMs;
}

function welcomePage() {
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DON PAD</title>
<style>
  ${cyberStyles()}
  .wrap { max-width: 640px; margin: 8vh auto; padding: 0 20px; }
  .card { border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 32px 28px; box-shadow: 0 0 40px rgba(0,230,160,.06), inset 0 0 60px rgba(0,230,160,.03); }
  h1 { font-size: 2.4rem; margin: 0; letter-spacing: .12em; text-shadow: 0 0 14px rgba(0,230,160,.55); }
  .sub { color: var(--dim); letter-spacing: .25em; font-size: .72rem; text-transform: uppercase; margin: 6px 0 22px; }
  p { color: var(--dim); line-height: 1.7; }
  p .prompt { color: var(--accent); }
  form { display: flex; gap: 8px; margin: 26px 0 14px; }
  input { flex: 1; font-family: inherit; font-size: 1rem; padding: 12px 14px; background: #04100b; color: var(--fg); border: 1px solid var(--border); border-radius: 6px; caret-color: var(--accent); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,230,160,.15); }
  input::placeholder { color: #3b6657; }
  button { font-family: inherit; font-size: .95rem; padding: 12px 20px; border: 1px solid var(--accent); border-radius: 6px; background: transparent; color: var(--accent); cursor: pointer; text-shadow: 0 0 8px rgba(0,230,160,.4); }
  button:hover { background: rgba(0,230,160,.1); }
  .hint { font-size: .8rem; color: #4a7465; margin-top: 18px; }
  code { color: var(--accent); background: rgba(0,230,160,.08); padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>♛ DON&nbsp;PAD</h1>
      <div class="sub">o don dos blocos de texto</div>
      <p><span class="prompt">&gt;</span> diga o nome do bloco e o Don providencia. Qualquer caminho vira um bloco novo — ex.: <code>/minha-nota</code>. Salva sozinho enquanto você escreve, e todo mundo com o link enxerga e edita.</p>
      <form id="f">
        <input id="pad" placeholder="nome-do-bloco" autofocus autocomplete="off" spellcheck="false">
        <button type="submit">entrar</button>
      </form>
      <p class="hint"><span class="prompt">$</span> <code>/&lt;nome&gt;/raw</code> → texto puro &nbsp;·&nbsp; <code>/&lt;nome&gt;/download</code> → baixar .txt</p>
    </div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('pad').value.trim();
      if (v) location.href = '/' + v.split('/').map(encodeURIComponent).join('/');
    });
  </script>
</body>
</html>`;
}

function cyberStyles() {
  return `
  :root {
    --bg: #050907;
    --panel: #0a1310;
    --border: #16352a;
    --fg: #d7fbe8;
    --dim: #6ea08c;
    --accent: #00e6a0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, 'SF Mono', 'Fira Code', Menlo, Consolas, monospace;
    background-image:
      radial-gradient(ellipse at top, rgba(0,230,160,.05), transparent 60%),
      repeating-linear-gradient(0deg, rgba(0,230,160,.02) 0px, rgba(0,230,160,.02) 1px, transparent 1px, transparent 3px);
  }
  a { color: var(--accent); }
  `;
}

function editorPage(padPath, content) {
  const safePad = JSON.stringify(padPath);
  const safeContent = JSON.stringify(content);
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(padPath)} · DON PAD</title>
<style>
  ${cyberStyles()}
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 18px; background: var(--panel); border-bottom: 1px solid var(--border); font-size: 13px; flex-wrap: wrap; }
  header .logo { color: var(--accent); text-shadow: 0 0 8px rgba(0,230,160,.5); letter-spacing: .08em; }
  header .pad-name { color: var(--fg); }
  header .pad-name::before { content: '/'; color: var(--dim); }
  header a { color: var(--dim); text-decoration: none; border: 1px solid var(--border); border-radius: 4px; padding: 3px 9px; }
  header a:hover { color: var(--accent); border-color: var(--accent); }
  #status { margin-left: auto; color: var(--dim); display: flex; align-items: center; gap: 6px; }
  #status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  #status.error .dot { background: #ff4d6a; box-shadow: 0 0 6px #ff4d6a; }
  textarea { flex: 1; width: 100%; border: none; outline: none; resize: none; padding: 20px; font-size: 16px; line-height: 1.6; font-family: inherit; box-sizing: border-box; background: var(--bg); color: var(--fg); caret-color: var(--accent); }
  textarea::placeholder { color: #3b6657; }
</style>
</head>
<body>
  <header>
    <span class="logo">♛ DON PAD</span>
    <strong class="pad-name">${escapeHtml(padPath)}</strong>
    <a href="/${encodeURI(padPath)}/raw" target="_blank">raw</a>
    <a href="/${encodeURI(padPath)}/download">download</a>
    <a href="/">novo bloco</a>
    <span id="status"><span class="dot"></span><span id="status-text">carregado</span></span>
  </header>
  <textarea id="editor" placeholder="Comece a digitar... o Don salva por você." autofocus spellcheck="false"></textarea>
<script>
(function() {
  const pad = ${safePad};
  const apiUrl = '/api/' + pad.split('/').map(encodeURIComponent).join('/');
  const editor = document.getElementById('editor');
  const status = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  editor.value = ${safeContent};

  let lastSaved = editor.value;
  let saveTimer = null;
  let dirty = false;

  function setStatus(text, isError) {
    statusText.textContent = text;
    status.classList.toggle('error', !!isError);
  }

  async function save() {
    const value = editor.value;
    setStatus('salvando...');
    try {
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      });
      if (!res.ok) throw new Error('falha ao salvar');
      lastSaved = value;
      dirty = false;
      setStatus('salvo');
    } catch (err) {
      setStatus('erro ao salvar — tentando de novo', true);
      saveTimer = setTimeout(save, 2000);
    }
  }

  editor.addEventListener('input', () => {
    dirty = true;
    setStatus('digitando...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  });

  // sincroniza com edições feitas em outra aba/dispositivo
  setInterval(async () => {
    if (dirty || document.activeElement === editor) return;
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) return;
      const data = await res.json();
      if (data.content !== lastSaved) {
        editor.value = data.content;
        lastSaved = data.content;
        setStatus('atualizado por outro dispositivo');
      }
    } catch (err) { /* ignora falha de sincronização */ }
  }, 2500);
})();
</script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
  res.type('html').send(welcomePage());
});

app.get(/^\/api\/(.+)$/, async (req, res) => {
  const segments = sanitizePad(decodeURIComponent(req.params[0]));
  if (!segments) return res.status(400).json({ error: 'nome de bloco inválido' });
  const { content, mtime } = await readPad(segments);
  res.json({ content, mtime });
});

app.put(/^\/api\/(.+)$/, async (req, res) => {
  const segments = sanitizePad(decodeURIComponent(req.params[0]));
  if (!segments) return res.status(400).json({ error: 'nome de bloco inválido' });
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (content.length > 5_000_000) return res.status(413).json({ error: 'conteúdo muito grande' });
  const mtime = await writePad(segments, content);
  res.json({ ok: true, mtime });
});

app.get(/^\/(.+)$/, async (req, res) => {
  let full = decodeURIComponent(req.params[0]);

  let mode = 'edit';
  if (full.endsWith('/raw')) {
    mode = 'raw';
    full = full.slice(0, -'/raw'.length);
  } else if (full.endsWith('/download')) {
    mode = 'download';
    full = full.slice(0, -'/download'.length);
  }

  const segments = sanitizePad(full);
  if (!segments) return res.status(400).send('Nome de bloco inválido.');
  const padPath = segments.join('/');
  const { content } = await readPad(segments);

  if (mode === 'raw') {
    return res.type('text/plain; charset=utf-8').send(content);
  }
  if (mode === 'download') {
    const filename = segments[segments.length - 1] + '.txt';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.type('text/plain; charset=utf-8').send(content);
  }
  res.type('html').send(editorPage(padPath, content));
});

fsp.mkdir(DATA_DIR, { recursive: true }).then(() => {
  app.listen(PORT, HOST, () => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);

    console.log(`donpad rodando em http://localhost:${PORT}`);
    for (const ip of ips) {
      console.log(`  disponível na rede local em http://${ip}:${PORT}`);
    }
  });
});
