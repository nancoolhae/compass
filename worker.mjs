const files = /* FILES */ null;
const embeddedImages = /* IMAGES */ null;
const palette = /* PALETTE */ null;
const pages = new Set(['/', '/compass', '/draw', '/forest']);
const recordFields = 'sequence, name, emotion, strokes';
const pageSize = 36;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function decode(row) {
  return { ...row, strokes: JSON.parse(row.strokes) };
}

function validSubmission({ id, name, emotion, strokes } = {}) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return false;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(name)) return false;
  if (!Number.isInteger(emotion) || !palette[emotion]) return false;
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 200) return false;
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length || (points += stroke.length) > 4000) return false;
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2) return false;
      const [x, y] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 350 || y < 0 || y > 331) return false;
    }
  }
  return true;
}

async function readSubmission(request) {
  const maxBytes = 80000;
  if (Number(request.headers.get('Content-Length')) > maxBytes || !request.body) return null;
  const stream = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const { done, value } = await stream.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await stream.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); } catch { return null; }
}

async function api(request, url, db) {
  if (request.method === 'GET') {
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    const cursor = before ?? after;
    const cursorNumber = Number(cursor);
    if ((before !== null && after !== null) || (cursor !== null && (!Number.isSafeInteger(cursorNumber) || cursorNumber < 0))) {
      return json({ error: 'Invalid cursor' }, 400);
    }
    const emotion = url.searchParams.get('emotion');
    if (emotion !== null && (!/^\d+$/.test(emotion) || !palette[Number(emotion)])) {
      return json({ error: 'Invalid emotion' }, 400);
    }
    const filters = [];
    const params = [];
    if (emotion !== null) {
      filters.push('emotion = ?');
      params.push(Number(emotion));
    }
    if (cursor !== null) {
      filters.push(before !== null ? 'sequence < ?' : 'sequence > ?');
      params.push(cursorNumber);
    }
    const filter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const order = after !== null ? 'ASC' : 'DESC';
    const { results } = await db.prepare(
      `SELECT ${recordFields} FROM fireflies ${filter} ORDER BY sequence ${order} LIMIT ?`
    ).bind(...params, pageSize + 1).all();
    return json({ entries: results.slice(0, pageSize).map(decode), hasMore: results.length > pageSize });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Invalid origin' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Unsupported content type' }, 415);
  const submission = await readSubmission(request);
  if (!submission || !validSubmission(submission)) return json({ error: 'Invalid firefly' }, 400);
  const { id, name, emotion, strokes } = submission;
  const [, selected] = await db.batch([
    db.prepare('INSERT INTO fireflies (id, name, emotion, strokes) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, name.trim(), emotion, JSON.stringify(strokes)),
    db.prepare(`SELECT ${recordFields} FROM fireflies WHERE id = ?`).bind(id),
  ]);
  return json(decode(selected.results[0]), 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/fireflies') {
      try {
        return await api(request, url, env.DB);
      } catch (error) {
        console.error('Firefly storage error', error);
        return json({ error: 'Firefly storage unavailable' }, 503);
      }
    }
    const file = files[pages.has(url.pathname) ? '/' : url.pathname];
    if (!Array.isArray(file) || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    const content = url.pathname.startsWith('/art/')
      ? file[1].replace(/__EMBEDDED_IMAGE_(\d+)__/g, (_, index) => embeddedImages[index])
      : file[1];
    return new Response(request.method === 'HEAD' ? null : content, {
      headers: {
        'Content-Type': file[0],
        'Cache-Control': url.pathname.startsWith('/art/') ? 'public, max-age=3600' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'",
      },
    });
  },
};
