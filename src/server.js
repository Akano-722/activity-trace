import express from 'express';
import cors from 'cors';
import db from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  if (!API_KEY) return next();
  const key = req.query.key || req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (key !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function dayRange(dateText) {
  const d = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  d.setDate(d.getDate() + 1);
  return { start, end: d.getTime() };
}

function getToday(date) {
  const { start, end } = dayRange(date);
  const rows = db.prepare(`
    SELECT app, COUNT(*) AS close_count, COALESCE(SUM(duration_seconds),0) AS seconds
    FROM app_events
    WHERE event='close' AND ts>=? AND ts<?
    GROUP BY app ORDER BY seconds DESC
  `).all(start, end);
  return {
    ok: true,
    date: new Date(start).toLocaleDateString('sv-SE'),
    apps: rows.map(r => ({
      app: r.app,
      close_count: r.close_count,
      seconds: r.seconds,
      minutes: Math.round(r.seconds / 60)
    }))
  };
}

function getLogs(limit = 50) {
  const safeLimit = Math.min(Number(limit || 50), 500);
  const rows = db.prepare('SELECT app,event,ts,duration_seconds FROM app_events ORDER BY ts DESC LIMIT ?').all(safeLimit);
  return { ok: true, logs: rows.map(r => ({ ...r, time: new Date(r.ts).toISOString() })) };
}

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function mcpResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

app.get('/', (_, res) => res.json({ ok: true, name: 'phone-activity-tracker' }));
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/screentime/toggle/:appName', auth, (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM app_events WHERE ts < ?").run(cutoff);

  db.prepare("UPDATE app_state SET is_open = 0, opened_at = NULL WHERE opened_at < ?").run(cutoff);

  const appName = decodeURIComponent(req.params.appName).trim();
  if (!appName) return res.status(400).json({ error: 'missing app name' });

  const now = Date.now();
  const state = db.prepare('SELECT * FROM app_state WHERE app = ?').get(appName);

  if (!state || state.is_open === 0) {
    db.prepare('INSERT INTO app_state(app,is_open,opened_at) VALUES(?,?,?) ON CONFLICT(app) DO UPDATE SET is_open=1, opened_at=?')
      .run(appName, 1, now, now);
    db.prepare('INSERT INTO app_events(app,event,ts) VALUES(?,?,?)').run(appName, 'open', now);
    return res.json({ ok: true, app: appName, event: 'open', at: new Date(now).toISOString() });
  }

  const duration = Math.max(0, Math.floor((now - state.opened_at) / 1000));
  db.prepare('UPDATE app_state SET is_open=0, opened_at=NULL WHERE app=?').run(appName);
  db.prepare('INSERT INTO app_events(app,event,ts,duration_seconds) VALUES(?,?,?,?)').run(appName, 'close', now, duration);
  res.json({ ok: true, app: appName, event: 'close', duration_seconds: duration, at: new Date(now).toISOString() });
});

app.get('/api/screentime/today', auth, (req, res) => res.json(getToday(req.query.date)));
app.get('/api/screentime/logs', auth, (req, res) => res.json(getLogs(req.query.limit)));

// A tiny MCP-over-HTTP endpoint for Claude / MCP clients.
// Use: https://your-domain/mcp?key=YOUR_API_KEY
app.get('/mcp', auth, (_, res) => {
  res.json({ ok: true, name: 'phone-activity-tracker-mcp', endpoint: '/mcp', transport: 'http', methods: ['POST'] });
});

app.post('/mcp', auth, (req, res) => {
  const msg = req.body;
  const id = msg?.id;
  const method = msg?.method;

  if (!method) return res.status(400).json(mcpError(id, -32600, 'Invalid Request'));

  try {
    if (method === 'initialize') {
      return res.json(mcpResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'phone-activity-tracker', version: '1.0.0' }
      }));
    }

    if (method === 'notifications/initialized') {
      return res.status(202).end();
    }

    if (method === 'tools/list') {
      return res.json(mcpResult(id, {
        tools: [
          {
            name: 'get_screentime_today',
            description: '查询今天或指定日期的 App 使用时长统计。',
            inputSchema: {
              type: 'object',
              properties: { date: { type: 'string', description: '日期，格式 YYYY-MM-DD。留空表示今天。' } }
            }
          },
          {
            name: 'get_screentime_logs',
            description: '查询最近的 App 打开/关闭记录。',
            inputSchema: {
              type: 'object',
              properties: { limit: { type: 'number', description: '最多返回多少条，默认 50，最大 500。' } }
            }
          }
        ]
      }));
    }

    if (method === 'tools/call') {
      const { name, arguments: args = {} } = msg.params || {};
      if (name === 'get_screentime_today') return res.json(mcpResult(id, textResult(getToday(args.date))));
      if (name === 'get_screentime_logs') return res.json(mcpResult(id, textResult(getLogs(args.limit))));
      return res.json(mcpError(id, -32602, `Unknown tool: ${name}`));
    }

    return res.json(mcpError(id, -32601, `Method not found: ${method}`));
  } catch (err) {
    return res.status(500).json(mcpError(id, -32603, err?.message || 'Internal error'));
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));
