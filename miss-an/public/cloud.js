import {empty, saveEdit} from './core.js';

export async function connect(config) {
  const base = 'https://www.gstatic.com/firebasejs/12.0.0/';
  const [app, authApi, dbApi] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js')
  ]);
  const client = app.initializeApp(config);
  const auth = authApi.getAuth(client);
  await authApi.setPersistence(auth, authApi.browserSessionPersistence);
  const db = dbApi.getFirestore(client);
  return {
    watch: listener => authApi.onAuthStateChanged(auth, listener),
    login: (email, password) => authApi.signInWithEmailAndPassword(auth, email, password),
    logout: () => authApi.signOut(auth),
    async authorize(uid) {
      await dbApi.getDocFromServer(dbApi.doc(db, 'users', uid, 'core', 'access'));
    },
    store(uid) {
      const ref = dbApi.doc(db, 'users', uid, 'core', 'locations');
      return {
        async read() {
          return (await dbApi.getDocFromServer(ref)).data() ?? empty();
        },
        async save(expected, change) {
          const operationId = crypto.randomUUID();
          const time = new Date().toISOString();
          return dbApi.runTransaction(db, async transaction => {
            const current = (await transaction.get(ref)).data() ?? empty();
            const next = saveEdit(current, expected, change, operationId, time);
            if (next !== current) transaction.set(ref, next);
            return next;
          });
        }
      };
    }
  };
}
