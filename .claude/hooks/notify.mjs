// Notification: systémové upozornění, když Claude Code čeká na uživatele.
import { readInput, notify } from './lib.mjs';

const input = readInput();
const message = input.message || 'Claude Code čeká na tvou odpověď.';
notify('Claude Code – Materiálový optimalizátor', message);
process.exit(0);
