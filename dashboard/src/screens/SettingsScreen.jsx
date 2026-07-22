import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, RefreshCw, Save, Shield } from 'lucide-react';
import { api, storeKey } from '../lib/api';
import Button from '../components/Button';
import Modal from '../components/Modal';
import TextField from '../components/TextField';
import { useAuth } from '../context/AuthContext';

function Section({ title, note, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-text">{title}</h2>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

const PASSWORD_RULES = [
  { id: 'length', label: 'At least 14 characters', test: (value) => value.length >= 14 },
  { id: 'lower', label: 'One lowercase letter', test: (value) => /[a-z]/.test(value) },
  { id: 'upper', label: 'One uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { id: 'number', label: 'One number', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'One special character', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

function PasswordRules({ value }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="mb-2 text-xs font-medium text-text">New key requirements</p>
      <div className="flex flex-col gap-1.5">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <div key={rule.id} className={`text-xs ${ok ? 'text-emerald-300' : 'text-muted'}`}>
              {ok ? '✓' : '•'} {rule.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RotateKeyModal({ onClose, onDone }) {
  const { refreshAuth } = useAuth();
  const [currentKey, setCurrentKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/rotate-key', { current_key: currentKey, length: 24 });
      storeKey(res.new_key);
      await refreshAuth();
      setGeneratedKey(res.new_key);
      onDone('Admin key rotated. Copy the new key before closing this modal.');
    } catch (err) {
      setError(err.message || 'Unable to rotate key.');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal title="Rotate admin key" onClose={onClose}>
      {!generatedKey ? (
        <>
          <p className="text-sm text-muted">Any connected app using the old key will lose access immediately.</p>
          <div className="mt-4">
            <TextField
              label="Current key"
              type="password"
              value={currentKey}
              onChange={(e) => setCurrentKey(e.target.value)}
              placeholder="Current admin key"
              autoFocus
            />
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" onClick={confirm} disabled={busy || !currentKey.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Rotate'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text">
              <KeyRound size={15} className="text-accent" />
              New admin key
            </div>
            <code className="block overflow-x-auto rounded-md bg-surface px-3 py-2 text-xs text-accent">{generatedKey}</code>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={copyKey}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy key'}
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ChangeKeyModal({ onClose, onDone }) {
  const { refreshAuth } = useAuth();
  const [currentKey, setCurrentKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const newKeyValid = PASSWORD_RULES.every((rule) => rule.test(newKey));

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/change-key', { current_key: currentKey, new_key: newKey });
      storeKey(newKey);
      await refreshAuth();
      onDone('Admin key updated. This session is now using the new key.');
      onClose();
    } catch (err) {
      setError(err.message || 'Unable to update key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change admin key" onClose={onClose}>
      <div className="space-y-3">
        <TextField
          label="Current key"
          type="password"
          value={currentKey}
          onChange={(e) => setCurrentKey(e.target.value)}
          placeholder="Current admin key"
          autoFocus
        />
        <TextField
          label="New key"
          type="password"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="New admin key"
        />
        <PasswordRules value={newKey} />
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={confirm} disabled={busy || !currentKey.trim() || !newKeyValid}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

export default function SettingsScreen() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  async function loadStatus() {
    const res = await api.get('/auth/settings');
    setStatus(res);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  function showSuccess(nextMessage) {
    setError('');
    setMessage(nextMessage);
    loadStatus();
  }

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-6 text-lg font-medium text-text">Settings</h1>

      {(message || error) && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
          {error || message}
        </div>
      )}

      <Section title="Access Keys" note="ToolGate-style key management, adapted for MemoryGate with current-key confirmation on every sensitive action.">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="w-24 flex-shrink-0 text-sm text-text">Admin Key</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
            {status === null
              ? 'Loading status...'
              : status.auth_enabled
                ? '••••••••••••••••'
                : 'No admin key set yet'}
          </span>
          <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => { setError(''); setMessage(''); setModal('change'); }}>
            <Save size={13} /> Change
          </Button>
          <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => { setError(''); setMessage(''); setModal('rotate'); }}>
            <RefreshCw size={13} /> Rotate
          </Button>
        </div>
      </Section>

      <Section title="Access status" note="Where the active admin key is coming from right now.">
        <div className="flex items-center gap-3 px-4 py-3">
          <Shield size={16} className="text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text">
              {status === null
                ? 'Loading admin key status...'
                : status.auth_enabled
                  ? 'Admin key protection is enabled.'
                  : 'No admin key is configured yet.'}
            </p>
            <p className="text-xs text-muted">
              {status === null
                ? 'Checking backend status...'
                : status.auth_enabled
                  ? `Source: ${status.key_source}`
                  : 'The first change or rotate action will create the managed admin key.'}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Session behavior" note="Same low-friction UX, still keeping the key out of persistent browser storage.">
        <div className="px-4 py-3 text-sm text-muted">
          The current browser session keeps the admin key in session storage only. Closing the session clears it.
        </div>
      </Section>

      <Section title="Security notes" note="What is protected now, and what still matters operationally.">
        <div className="px-4 py-3 text-sm text-muted">
          Admin keys are hashed with PBKDF2-SHA256 before being stored. Failed key checks are lock-limited to 5 tries with a 5-minute timeout per client.
        </div>
        <div className="border-t border-border px-4 py-3 text-sm text-muted">
          This makes brute force much harder, but the host machine still matters. Separating the agent machine from the services machine later is the right next step for stronger isolation.
        </div>
      </Section>

      {modal === 'change' && <ChangeKeyModal onClose={() => setModal(null)} onDone={showSuccess} />}
      {modal === 'rotate' && <RotateKeyModal onClose={() => setModal(null)} onDone={showSuccess} />}
    </div>
  );
}
