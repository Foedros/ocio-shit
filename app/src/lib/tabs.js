// Multi-tab lifecycle (roadmap Sprint 2, the risk item).
//
// The OPFS-SAH-pool VFS is single-connection (tecnico.md §3.2.bis): two tabs opening the DB
// at once conflict. So exactly ONE tab — the LEADER — opens the DB; the others are FOLLOWERS
// (read-only) and proxy their reads to the leader over a BroadcastChannel.
//
// Leadership is a Web Lock held for the tab's whole lifetime. The browser releases the lock
// when the tab/process dies (even on a crash or hard kill), at which point a waiting
// follower's lock request resolves and it is promoted to leader automatically. We do NOT
// rely on Web Locks alone for write safety — the leader's writes are transactional and the
// durable export is only flushed after COMMIT, so a leader killed mid-write rolls back on
// the next leader's open (proven by the multi-tab test).
const LOCK_NAME = 'ocioshit-db-leader';
const CHANNEL = 'ocioshit-tabs';

export function createTabCoordinator({ onBecomeLeader, onBecomeFollower, runQuery, onChanged }) {
  const tabId = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).slice(0, 8);
  const channel = new BroadcastChannel(CHANNEL);
  let leader = false;
  let followerAnnounced = false;
  const pending = new Map(); // reqId -> { resolve, reject, timer }
  let seq = 0;

  // The leader only starts answering follower reads once its DB is ready.
  let dbReadyResolve;
  const dbReady = new Promise((r) => (dbReadyResolve = r));

  function becomeLeader() {
    if (leader) return;
    leader = true;
    onBecomeLeader?.();
  }
  function becomeFollower() {
    if (leader || followerAnnounced) return;
    followerAnnounced = true;
    onBecomeFollower?.();
  }

  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    let signalAcquired;
    const acquired = new Promise((r) => (signalAcquired = r));
    navigator.locks
      .request(LOCK_NAME, { mode: 'exclusive' }, () => {
        signalAcquired(true);
        becomeLeader();
        return new Promise(() => {}); // hold the lock until this tab dies
      })
      .catch(() => {});
    // If the lock isn't ours within a short window, another tab holds it -> we're a follower.
    Promise.race([acquired, new Promise((r) => setTimeout(() => r(false), 250))]).then((got) => {
      if (!got) becomeFollower();
    });
  } else {
    becomeLeader(); // no Web Locks support -> assume single tab (degraded)
  }

  channel.onmessage = async (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.t === 'req' && leader) {
      try {
        await dbReady;
        const result = await runQuery(m.method, m.args);
        channel.postMessage({ t: 'res', reqId: m.reqId, ok: true, result });
      } catch (err) {
        channel.postMessage({ t: 'res', reqId: m.reqId, ok: false, error: err?.message || String(err) });
      }
    } else if (m.t === 'res') {
      const p = pending.get(m.reqId);
      if (p) {
        pending.delete(m.reqId);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.result);
        else p.reject(new Error(m.error));
      }
    } else if (m.t === 'changed' && !leader) {
      onChanged?.(m.counts);
    }
  };

  /** Run a read. Leader: directly against the DB. Follower: proxied to the leader. */
  function query(method, args) {
    if (leader) return Promise.resolve(runQuery(method, args));
    return new Promise((resolve, reject) => {
      const reqId = `${tabId}-${++seq}`;
      const timer = setTimeout(() => {
        if (pending.has(reqId)) {
          pending.delete(reqId);
          reject(new Error('sin respuesta de la pestaña principal (timeout)'));
        }
      }, 8000);
      pending.set(reqId, { resolve, reject, timer });
      channel.postMessage({ t: 'req', reqId, from: tabId, method, args });
    });
  }

  return {
    tabId,
    isLeader: () => leader,
    query,
    /** Leader calls this after its DB is initialized so it can answer follower reads. */
    markDbReady: () => dbReadyResolve(),
    /** Leader broadcasts a data change so followers refresh. */
    broadcastChanged: (counts) => channel.postMessage({ t: 'changed', counts })
  };
}
