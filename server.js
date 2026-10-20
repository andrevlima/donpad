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
<title>donpad local</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 10vh auto; padding: 0 20px; color: #222; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #111; } input { background: #222; color: #eee; border-color: #444; } }
  h1 { font-size: 1.4rem; }
  p { color: #666; line-height: 1.5; }
  form { display: flex; gap: 8px; margin-top: 24px; }
  input { flex: 1; font-size: 1rem; padding: 10px 12px; border: 1px solid #ccc; border-radius: 6px; }
  button { font-size: 1rem; padding: 10px 16px; border: none; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  code { background: rgba(127,127,127,.15); padding: 2px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>donpad (versão local)</h1>
  <p>Digite qualquer nome na barra de endereço depois da barra, por exemplo
  <code>${baseUrlHint()}/minha-nota</code>, e um bloco de texto será criado automaticamente.
  Ele é salvo sozinho enquanto você digita, e qualquer pessoa na mesma rede com o link pode ver ou editar.</p>
  <form id="f">
    <input id="pad" placeholder="nome-do-bloco" autofocus>
    <button type="submit">Abrir</button>
  </form>
  <p>Acesse <code>/&lt;nome&gt;/raw</code> para ver só o texto puro, ou <code>/&lt;nome&gt;/download</code> para baixar como .txt.</p>
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

function baseUrlHint() {
  return '';
}

function editorPage(padPath, content) {
  const safePad = JSON.stringify(padPath);
  const safeContent = JSON.stringify(content);
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(padPath)} · donpad</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; flex-direction: column; background: #fff; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } textarea { background: #111; color: #eee; } header { background: #1a1a1a !important; border-color: #333 !important; } a { color: #8ab4ff; } }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: #f5f5f5; border-bottom: 1px solid #ddd; font-size: 13px; flex-wrap: wrap; }
  header a { color: #2563eb; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  #status { margin-left: auto; color: #888; }
  textarea { flex: 1; width: 100%; border: none; outline: none; resize: none; padding: 18px; font-size: 16px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; box-sizing: border-box; }
</style>
</head>
<body>
  <header>
    <strong>/${escapeHtml(padPath)}</strong>
    <a href="/${encodeURI(padPath)}/raw" target="_blank">raw</a>
    <a href="/${encodeURI(padPath)}/download">download</a>
    <a href="/">novo bloco</a>
    <span id="status">carregado</span>
  </header>
  <textarea id="editor" placeholder="Comece a digitar... é salvo automaticamente."></textarea>
<script>
(function() {
  const pad = ${safePad};
  const apiUrl = '/api/' + pad.split('/').map(encodeURIComponent).join('/');
  const editor = document.getElementById('editor');
  const status = document.getElementById('status');
  editor.value = ${safeContent};

  let lastSaved = editor.value;
  let saveTimer = null;
  let dirty = false;

  function setStatus(text) { status.textContent = text; }

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
      setStatus('erro ao salvar — tentando de novo');
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
