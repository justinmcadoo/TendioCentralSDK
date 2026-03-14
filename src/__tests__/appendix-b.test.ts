import express from 'express';
import { TendioAuth } from '../express/index.js';
import type { UsersBulkSyncedData } from '../index.js';

declare function session(opts: { secret: string; resave: boolean; saveUninitialized: boolean }): express.RequestHandler;

declare const db: {
  users: {
    upsert: (opts: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<void>;
    update: (opts: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<void>;
    findUnique: (opts: { where: Record<string, unknown> }) => Promise<unknown>;
  };
};

declare function destroyUserSessions(userId: string): Promise<void>;

async function main() {
  const app = express();

  app.use(session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
  }));

  const auth = await TendioAuth.fromConfig({
    clientSecret: process.env.TENDIOCENTRAL_CLIENT_SECRET!,
    redirectUri: 'https://myapp.com/auth/callback',
    webhookSecret: process.env.TENDIOCENTRAL_WEBHOOK_SECRET,
    onUserAuthenticated: async (user) => {
      await db.users.upsert({
        where: { tendiocentral_id: user.sub },
        create: {
          tendiocentral_id: user.sub,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          tenant_id: user.tenant_id,
          locations: user.locations,
          is_active: true,
        },
        update: {
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          locations: user.locations,
          last_login: new Date(),
        },
      });
    },
  });

  app.get('/auth/sso/auto-login', auth.initiateLogin());
  app.get('/auth/callback', auth.handleCallback(), (req, res) => {
    res.redirect('/dashboard');
  });
  app.get('/dashboard', auth.requireAuth(), auth.requireRole('admin', 'supervisor'), (req, res) => {
    res.json({ user: req.tendioUser });
  });
  app.post('/api/auth/logout', auth.logout());

  app.post('/api/webhooks/tendiocentral',
    express.raw({ type: 'application/json' }),
    auth.verifyWebhook(),
    async (req, res) => {
      const { event, event_id, data } = req.webhookEvent!;
      switch (event) {
        case 'user.deactivated':
          await db.users.update({
            where: { tendiocentral_id: (data as { user_id: string }).user_id },
            data: { is_active: false },
          });
          break;
        case 'session.revoked_all':
          await destroyUserSessions((data as { user_id: string }).user_id);
          break;
        case 'users.bulk_synced':
          const syncData = data as unknown as UsersBulkSyncedData;
          for (const user of syncData.all_users) {
            await db.users.upsert({
              where: { tendiocentral_id: user.id },
              create: { ...user, tendiocentral_id: user.id },
              update: { email: user.email, first_name: user.first_name, last_name: user.last_name, is_active: user.is_active },
            });
          }
          break;
      }
      res.json({ status: 'processed', event_id });
    }
  );

  app.post('/api/admin/sync-users', auth.requireAuth(), auth.requireRole('admin'), async (req, res) => {
    const allUsers = await auth.fetchAllUsers();
    let created = 0, updated = 0;
    for (const user of allUsers) {
      const existing = await db.users.findUnique({ where: { tendiocentral_id: user.id } });
      if (existing) { updated++; } else { created++; }
      await db.users.upsert({
        where: { tendiocentral_id: user.id },
        create: { ...user, tendiocentral_id: user.id },
        update: { email: user.email, first_name: user.first_name, last_name: user.last_name, is_active: user.is_active },
      });
    }
    res.json({ total: allUsers.length, created, updated });
  });

  app.listen(3000);
}
