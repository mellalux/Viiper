// npm run user -- <command> ...
//   list
//   add <name> [--role admin|editor] [--password <pw>]    (the password is asked for when left out; default role: editor)
//   passwd <name> [--password <pw>]
//   role <name> admin|editor
//   disable <name> | enable <name> | delete <name>
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { HttpError, ROLES, users, type Role } from '../auth/users.js';
import { audit, type AuditAction } from '../audit.js';

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i]!.startsWith('--')) flags.set(rest[i]!.slice(2), rest[++i] ?? '');
  else args.push(rest[i]!);
}

/** Ask for a password without echoing it. */
function askPassword(prompt: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

const password = async () => flags.get('password') ?? process.env.VIIPER_PASSWORD ?? (await askPassword('Parool: '));

async function main() {
  const db = openDb(loadConfig().dbPath);
  const accounts = users(db);
  const note = (action: AuditAction, target: string, detail?: unknown) => audit(db).log(null, action, target, detail, { name: 'CLI' });
  const need = (name: string | undefined) => {
    const user = name ? accounts.byName(name) : undefined;
    if (!user) throw new HttpError(404, `Sellist kasutajat pole: ${name ?? '(nimi puudub)'}`);
    return user;
  };
  const leavesNoAdmin = (name: string) => {
    const user = need(name);
    if (user.role === 'admin' && !user.disabled && accounts.activeAdmins() <= 1) throw new HttpError(409, 'See on viimane aktiivne administraator.');
    return user;
  };

  switch (command) {
    case 'list':
      for (const u of accounts.list()) console.log(`${String(u.id).padStart(3)}  ${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.disabled ? 'KEELATUD ' : ''}${u.lastLoginAt ? `viimati ${u.lastLoginAt}` : 'pole sisse loginud'}`);
      break;
    case 'add': {
      const role = (flags.get('role') ?? 'editor') as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Roll peab olema admin või editor.');
      const user = await accounts.create(args[0], await password(), role);
      note('user_create', user.username, { role: user.role });
      console.log(`Lisatud: ${user.username} (${user.role})`);
      break;
    }
    case 'passwd': {
      const user = need(args[0]);
      await accounts.setPassword(user.id, await password());
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      note('user_update', user.username, { password: 'uus parool' });
      console.log(`Parool vahetatud: ${user.username} (kõik tema sessioonid lõpetati)`);
      break;
    }
    case 'role': {
      const user = args[1] === 'admin' ? need(args[0]) : leavesNoAdmin(args[0]!);
      if (!ROLES.includes(args[1] as Role)) throw new HttpError(400, 'Roll peab olema admin või editor.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(args[1], user.id);
      note('user_update', user.username, { role: args[1] });
      console.log(`${user.username}: ${args[1]}`);
      break;
    }
    case 'disable': {
      const user = leavesNoAdmin(args[0]!);
      db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      note('user_update', user.username, { disabled: true });
      console.log(`Keelatud: ${user.username}`);
      break;
    }
    case 'enable': {
      const user = need(args[0]);
      db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(user.id);
      note('user_update', user.username, { disabled: false });
      console.log(`Lubatud: ${user.username}`);
      break;
    }
    case 'delete': {
      const user = leavesNoAdmin(args[0]!);
      note('user_delete', user.username);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      console.log(`Kustutatud: ${user.username}`);
      break;
    }
    default:
      console.log('Kasutus: npm run user -- list | add <nimi> [--role admin|editor] [--password ...] | passwd <nimi> | role <nimi> <roll> | disable|enable|delete <nimi>');
      process.exitCode = command ? 1 : 0;
  }
  db.close();
}

main().catch((err) => {
  console.error(err instanceof HttpError ? err.message : err);
  process.exit(1);
});
