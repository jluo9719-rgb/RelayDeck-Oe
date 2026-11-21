import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRunner, detectHostCapabilities } from './src/server/agentRunner.ts';
import { BridgeStore } from './src/server/bridgeStore.ts';
import { timingSafeSecretEquals, validateSyncPayload } from './src/server/configSyncLogic.ts';
import { applyConfigSync, type SyncApplyReceipt } from './src/server/configSyncWriter.ts';
import { validateWorkspaceInput } from './src/utils/bridgeLogic.ts';
import type { AgentKind, PermissionPolicy } from './src/types/bridge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const store = new BridgeStore();
  const runner = new AgentRunner(store);

  // Dual-layer authentication guard for Windows + Cloudflare Access production deployments.
  // In local development / preview when BRIDGE_AUTH_TOKEN and CF_ACCESS_ALLOWED_EMAIL are unset, requests pass through.
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = process.env.BRIDGE_AUTH_TOKEN?.trim();
    const allowedEmail = process.env.CF_ACCESS_ALLOWED_EMAIL?.trim().toLowerCase();

    if (allowedEmail) {
      const cfEmail = req.header('Cf-Access-Authenticated-User-Email')?.trim().toLowerCase();
      if (cfEmail !== allowedEmail) {
        res.status(403).json({ error: 'Cloudflare Access 身份验证未通过，当前邮箱不在允许列表中。' });
        return;
      }
    }

    if (requiredToken) {
      const authHeader = req.header('Authorization') || '';
      const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;
      if (provided !== requiredToken) {
        res.status(401).json({ error: '缺少或无效的 Bridge 访问令牌。' });
        return;
      }
    }

    next();
  };

  // Dedicated fail-closed authentication guard for Windows CC Switch -> Cloud sync.
  // Mounted before general /api authMiddleware so Cloudflare Access Service Token calls
  // (which do not carry Cf-Access-Authenticated-User-Email) are verified strictly via BRIDGE_SYNC_SECRET.
  let lastSyncReceipt: SyncApplyReceipt | null = null;

  const syncAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const expectedSecret = process.env.BRIDGE_SYNC_SECRET?.trim() ?? '';
    if (!expectedSecret) {
      res.status(503).json({
        error: '云端尚未配置 BRIDGE_SYNC_SECRET，配置同步接口处于安全关闭状态。',
      });
      return;
    }

    const headerSecret = req.header('X-RelayDeck-Sync-Secret')?.trim() ?? '';
    const authHeader = req.header('Authorization') || '';
    const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const provided = headerSecret || bearerSecret;

    if (!timingSafeSecretEquals(provided, expectedSecret)) {
      res.status(401).json({ error: '同步密钥无效，已拒绝访问。' });
      return;
    }

    next();
  };

  app.get('/api/sync-config/status', syncAuthMiddleware, (_req, res) => {
    res.json({ ok: true, configured: true, lastSync: lastSyncReceipt });
  });

  app.post('/api/sync-config', syncAuthMiddleware, (req, res) => {
    const validation = validateSyncPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    try {
      const receipt = applyConfigSync(validation.payload);
      lastSyncReceipt = receipt;
      console.log(
        `[RelayDeck] Config synced from ${receipt.sourceHost ?? 'unknown-host'}: ${receipt.updatedFiles.join(', ')}`
      );
      res.json({ ok: true, receipt });
    } catch (err) {
      console.error('[RelayDeck] Failed to apply config sync:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: '写入云端配置文件失败，请检查服务器目录权限。' });
    }
  });

  app.use('/api', authMiddleware);

  app.get('/api/health', (req, res) => {
    const cfEmail = req.header('Cf-Access-Authenticated-User-Email') || undefined;
    res.json(detectHostCapabilities(cfEmail));
  });

  app.get('/api/state', (_req, res) => {
    res.json(store.getState());
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    const onBridgeEvent = (evt: { type: string; payload: unknown }) => {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.payload)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 20_000);

    runner.on('bridge', onBridgeEvent);

    req.on('close', () => {
      clearInterval(heartbeat);
      runner.off('bridge', onBridgeEvent);
    });
  });

  app.post('/api/workspaces', (req, res) => {
    const { name, path: rawPath, branch, defaultAgent, policy } = req.body as {
      name?: string;
      path?: string;
      branch?: string;
      defaultAgent?: AgentKind;
      policy?: PermissionPolicy;
    };

    const validation = validateWorkspaceInput(name ?? '', rawPath ?? '');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const ws = store.addWorkspace({
      name: validation.normalizedName,
      path: validation.normalizedPath,
      branch: branch || 'main',
      defaultAgent: defaultAgent === 'codex' ? 'codex' : 'claude',
      policy:
        policy === 'read-only-auto' || policy === 'high-risk-only' ? policy : 'confirm-writes',
    });

    res.status(201).json({ workspace: ws, state: store.getState() });
  });

  app.patch('/api/workspaces/:id', (req, res) => {
    const { defaultAgent, policy, branch } = req.body as {
      defaultAgent?: AgentKind;
      policy?: PermissionPolicy;
      branch?: string;
    };
    const updated = store.updateWorkspace(req.params.id, { defaultAgent, policy, branch });
    if (!updated) {
      res.status(404).json({ error: '未找到指定的工作区。' });
      return;
    }
    res.json({ workspace: updated, state: store.getState() });
  });

  app.delete('/api/workspaces/:id', (req, res) => {
    const removed = store.deleteWorkspace(req.params.id);
    if (!removed) {
      res.status(404).json({ error: '未找到指定的工作区。' });
      return;
    }
    res.json({ ok: true, state: store.getState() });
  });

  app.post('/api/sessions', (req, res) => {
    const { workspaceId, agent, title, initialPrompt } = req.body as {
      workspaceId?: string;
      agent?: AgentKind;
      title?: string;
      initialPrompt?: string;
    };

    if (!workspaceId) {
      res.status(400).json({ error: '请选择目标工作区。' });
      return;
    }

    const session = store.createSession({
      workspaceId,
      agent: agent === 'codex' ? 'codex' : 'claude',
      title,
    });

    if (!session) {
      res.status(404).json({ error: '目标工作区不存在。' });
      return;
    }

    if (initialPrompt && initialPrompt.trim()) {
      runner.dispatchPrompt(session.id, initialPrompt.trim());
    }

    res.status(201).json({ session: store.getSession(session.id), state: store.getState() });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    runner.stopSession(req.params.id);
    const removed = store.deleteSession(req.params.id);
    if (!removed) {
      res.status(404).json({ error: '会话不存在。' });
      return;
    }
    res.json({ ok: true, state: store.getState() });
  });

  app.post('/api/sessions/:id/messages', (req, res) => {
    const { prompt } = req.body as { prompt?: string };
    const cleanPrompt = (prompt ?? '').trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: '请输入要下发给智能体的任务指令。' });
      return;
    }

    const session = runner.dispatchPrompt(req.params.id, cleanPrompt);
    if (!session) {
      res.status(404).json({ error: '会话不存在或工作区已移除。' });
      return;
    }

    res.json({ session, state: store.getState() });
  });

  app.post('/api/sessions/:id/stop', (req, res) => {
    const stopped = runner.stopSession(req.params.id);
    if (!stopped) {
      res.status(404).json({ error: '会话不存在。' });
      return;
    }
    res.json({ ok: true, state: store.getState() });
  });

  app.post('/api/approvals/:id/resolve', (req, res) => {
    const { decision, note } = req.body as { decision?: 'approved' | 'rejected'; note?: string };
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: '审批决定必须为 approved 或 rejected。' });
      return;
    }

    const resolved = runner.resolveApproval(req.params.id, decision, note?.trim());
    if (!resolved) {
      res.status(404).json({ error: '未找到该审批请求。' });
      return;
    }

    res.json({ approval: resolved, state: store.getState() });
  });

  app.patch('/api/tunnel-config', (req, res) => {
    const updated = store.updateTunnelConfig(req.body ?? {});
    res.json({ tunnelConfig: updated, state: store.getState() });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RelayDeck] Bridge server running on http://localhost:${PORT} (bound to 0.0.0.0:${PORT})`);
  });
}

startServer().catch((err) => {
  console.error('[RelayDeck] Failed to start server:', err);
  process.exit(1);
});
